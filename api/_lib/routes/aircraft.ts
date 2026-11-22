// Hangar CRUD: /aircraft, /aircraft/:id. The session pilot's own aircraft and those shared with them
// (access.ts): viewers read, editors also write, only the owner deletes. Writes keep the owner's pilot_id.
// Creation and every save go into the aircraft's edit log (../aircraftLog.ts): /aircraft/:id/log.
// Its revisions (every entry but sharing, with the aircraft as it left it) are the version history:
// /aircraft/:id/revisions[/:rev[/restore]].
import type {
  AircraftRestoreRequest,
  AircraftRestoreResult,
  AircraftRevisionDetail,
  AircraftSnapshot,
} from '../../../src/shared/sharing.js';
import { blankAircraft } from '../../../src/shared/templates.js';
import type { AircraftInput } from '../../../src/shared/types.js';
import { aircraftFor, listAircraft, toHangarAircraft } from '../access.js';
import {
  diffSnapshots,
  getRevision,
  headRevision,
  listLog,
  listRevisions,
  logEdit,
  logEvent,
  snapshotOf,
} from '../aircraftLog.js';
import type { Db, Queryable } from '../db.js';
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, newId, notFound, reply } from '../http.js';
import { checkCount } from '../limits.js';
import { operatorFor } from '../operators.js';
import { isUniqueViolation } from '../pgErrors.js';
import { aircraftInput, toAircraft } from '../rows.js';
import { checkReports, deleteAttachments } from './attachments.js';

async function write(db: Queryable, pilotId: string, id: string, a: AircraftInput, insert: boolean) {
  const now = Date.now();
  const vals = [
    id,
    pilotId,
    a.registration,
    a.makeModel,
    a.icaoType,
    a.wake,
    a.serial,
    a.operator,
    a.homeBase,
    a.colours,
    a.cruiseTasKt,
    a.patternTasKt,
    a.climbTasKt,
    JSON.stringify(a.fuel),
    JSON.stringify(a.massBalance),
    JSON.stringify(a.performance),
    JSON.stringify(a.equipment),
    JSON.stringify(a.compassCards),
    a.notes,
    now,
    a.operatorId,
  ];
  try {
    const rows = insert
      ? await db.query(
          `INSERT INTO aircraft (id, pilot_id, registration, make_model, icao_type, wake, serial, operator, home_base, colours,
          cruise_tas_kt, pattern_tas_kt, climb_tas_kt, fuel, mass_balance, performance, equipment, compass_cards, notes, created, updated, operator_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$20,$21) RETURNING *`,
          vals,
        )
      : await db.query(
          `UPDATE aircraft SET registration=$3, make_model=$4, icao_type=$5, wake=$6, serial=$7, operator=$8, home_base=$9, colours=$10,
          cruise_tas_kt=$11, pattern_tas_kt=$12, climb_tas_kt=$13, fuel=$14::jsonb, mass_balance=$15::jsonb, performance=$16::jsonb,
          equipment=$17::jsonb, compass_cards=$18::jsonb, notes=$19, updated=$20, operator_id=$21 WHERE id=$1 AND pilot_id=$2 RETURNING *`,
          vals,
        );
    if (!rows.length) throw notFound('no such aircraft');
    return toAircraft(rows[0]);
  } catch (e) {
    // the only unique key a write can break is (pilot_id, registration)
    if (isUniqueViolation(e)) throw new HttpError(409, `${a.registration} is already in the hangar`);
    throw e;
  }
}

/**
 * Checks the aircraft's operator: assigning one needs edit access to it (assigning shares it, as a
 * viewer, with everyone who has the aircraft); keeping the current one needs nothing. The free-text
 * operator becomes the operator's name, so it stays a sensible fallback.
 */
async function checkOperator(db: Queryable, pilotId: string, a: AircraftInput, current: string | null): Promise<void> {
  if (!a.operatorId) {
    a.operatorId = null;
    return;
  }
  const op =
    a.operatorId === current
      ? await operatorFor(db, pilotId, a.operatorId).catch(() => null)
      : await operatorFor(db, pilotId, a.operatorId, 'edit');
  if (op) a.operator = op.name;
}

/** ?before=&limit= of a log or revisions listing. */
function paging(query: URLSearchParams): { before: number | null; limit: number } {
  const before = query.get('before');
  const limit = query.get('limit');
  const b = before ? Number(before) : null;
  const n = limit ? Number(limit) : 50;
  if (b !== null && !(Number.isInteger(b) && b > 0)) throw badRequest('before must be an entry id');
  if (!(Number.isInteger(n) && n >= 1 && n <= 100)) throw badRequest('limit must be 1–100');
  return { before: b, limit: n };
}

async function revisionOf(db: Queryable, aircraftId: string, rev: string) {
  const n = Number(rev);
  const r = Number.isInteger(n) && n > 0 ? await getRevision(db, aircraftId, n) : null;
  if (!r) throw notFound('no such revision');
  return r;
}

/** Ids of the aircraft's photo and document files still stored (attached or detached). */
async function storedFiles(db: Queryable, aircraftId: string): Promise<Set<string>> {
  const rows = await db.query(
    "SELECT id FROM aircraft_attachments WHERE aircraft_id = $1 AND complete AND kind IN ('photo', 'document')",
    [aircraftId],
  );
  return new Set(rows.map((r) => r.id as string));
}

const quoted = (s: string) => `“${s}”`;

/**
 * Restores revision `rev` of the aircraft as a new revision. The record goes through the same
 * validation as a save. Files are references: those of the version still stored are attached again
 * (with their titles), the others the aircraft has now are detached, not deleted, so that undoing the
 * restore can bring them back; what is no longer stored is skipped and named in the result.
 */
async function restore(
  db: Db,
  pilotId: string,
  aircraftId: string,
  rev: string,
  req: AircraftRestoreRequest,
): Promise<AircraftRestoreResult> {
  const row = await aircraftFor(db, pilotId, aircraftId, 'edit');
  const ownerId: string = row.pilot_id;
  const head = await headRevision(db, aircraftId);
  if (req.head !== undefined && (req.head !== head?.id || (req.headAt !== undefined && req.headAt !== head?.at)))
    throw conflict('The aircraft has changed since: look at the version again', toHangarAircraft(row));
  const { revision, snapshot } = await revisionOf(db, aircraftId, rev);
  const skipped: string[] = [];
  const { id: _i, created: _c, updated: _u, ...cur } = toAircraft(row);

  const doc = structuredClone(snapshot.aircraft) as Partial<AircraftInput>;
  // swing reports are files too: one deleted since cannot come back
  const reports = new Set(
    (
      await db.query("SELECT id FROM aircraft_attachments WHERE aircraft_id = $1 AND kind = 'report'", [aircraftId])
    ).map((r) => r.id as string),
  );
  doc.compassCards = (doc.compassCards ?? []).map((c) => {
    if (!c.report || reports.has(c.report.id)) return c;
    skipped.push(`compass swing report ${quoted(c.report.name)}`);
    const { report: _r, ...rest } = c;
    return rest;
  });
  const a = aircraftInput(doc, cur);
  try {
    await checkOperator(db, pilotId, a, cur.operatorId);
  } catch (e) {
    if (!(e instanceof HttpError) || (e.status !== 403 && e.status !== 404)) throw e;
    // the operator is gone, or not ours to assign: the name stays as text
    skipped.push(`the link to the operator ${quoted(a.operator)}`);
    a.operatorId = null;
  }
  // reports the restored cards no longer reference stay: undoing the restore needs them
  a.compassCards = (await checkReports(db, ownerId, aircraftId, a.compassCards, [])).cards;

  const stored = await storedFiles(db, aircraftId);
  const entry = await db.transaction(async (tx) => {
    const before = await snapshotOf(tx, aircraftId);
    await write(tx, ownerId, aircraftId, a, false);
    const keep = new Set<string>();
    for (const f of snapshot.documents) {
      if (!stored.has(f.id)) {
        skipped.push(`document ${quoted(f.title || f.name)}`);
        continue;
      }
      keep.add(f.id);
      await tx.query('UPDATE aircraft_attachments SET detached = FALSE, title = $2 WHERE id = $1', [f.id, f.title]);
    }
    await tx.query(
      `UPDATE aircraft_attachments SET detached = TRUE
       WHERE aircraft_id = $1 AND kind = 'document' AND NOT detached AND NOT (id = ANY($2::text[]))`,
      [aircraftId, [...keep]],
    );
    const photo = snapshot.photo;
    if (photo && !stored.has(photo.id)) skipped.push('the photo');
    // a photo no longer stored leaves the current one in place
    else if (photo?.id !== before.photo?.id) {
      await tx.query(
        `UPDATE aircraft_attachments SET detached = (id IS DISTINCT FROM $2) WHERE aircraft_id = $1 AND kind = 'photo'`,
        [aircraftId, photo?.id ?? null],
      );
    }
    const after = await snapshotOf(tx, aircraftId);
    const id = await logEvent(tx, aircraftId, pilotId, {
      kind: 'restore',
      changes: diffSnapshots(before, after),
      from: { id: revision.id, at: revision.at },
      skipped,
    });
    return (await getRevision(tx, aircraftId, id))!.revision;
  });
  return {
    aircraft: toHangarAircraft(await aircraftFor(db, pilotId, aircraftId)),
    revision: entry,
    previous: head ?? { id: revision.id, at: revision.at },
  };
}

export const routes: Route[] = [
  { method: 'GET', path: '/aircraft', handler: async ({ db, pilot }) => listAircraft(db, pilot.id) },
  {
    method: 'POST',
    path: '/aircraft',
    async handler({ db, pilot, body }) {
      const a = aircraftInput(await body(), blankAircraft());
      // a new aircraft has no files yet: references copied from another aircraft are dropped
      a.compassCards = a.compassCards.map(({ report: _r, ...c }) => c);
      await checkOperator(db, pilot.id, a, null);
      await checkCount(db, pilot.id, 'aircraft');
      const id = await newId('ac');
      const created = await db.transaction(async (tx) => {
        const c = await write(tx, pilot.id, id, a, true);
        await logEvent(tx, c.id, pilot.id, { kind: 'create' });
        return c;
      });
      // A pilot without a default aircraft (an empty hangar, or the default was deleted) gets this one,
      // so new flights open with an aircraft. An existing default is never replaced.
      await db.query('UPDATE pilots SET default_aircraft_id = $1 WHERE id = $2 AND default_aircraft_id IS NULL', [
        created.id,
        pilot.id,
      ]);
      return reply(201, toHangarAircraft(await aircraftFor(db, pilot.id, created.id)));
    },
  },
  {
    method: 'GET',
    path: '/aircraft/:id',
    handler: async ({ db, pilot, params }) => toHangarAircraft(await aircraftFor(db, pilot.id, params.id)),
  },
  {
    method: 'PUT',
    path: '/aircraft/:id',
    async handler({ db, pilot, params, body }) {
      const row = await aircraftFor(db, pilot.id, params.id, 'edit');
      const ownerId: string = row.pilot_id;
      const { id: _i, created: _c, updated: _u, ...cur } = toAircraft(row);
      const a = aircraftInput(await body(), cur);
      await checkOperator(db, pilot.id, a, cur.operatorId);
      const { cards, unused } = await checkReports(db, ownerId, params.id, a.compassCards, cur.compassCards);
      a.compassCards = cards;
      await db.transaction(async (tx) => {
        const { id: _i2, created: _c2, updated: _u2, ...after } = await write(tx, ownerId, params.id, a, false);
        // the operator's name as the next read shows it (write returns the stored free text)
        await logEdit(tx, params.id, pilot.id, cur, { ...after, operator: a.operator });
      });
      // swing reports no card refers to any more (replaced, removed, or uploaded and never saved)
      await deleteAttachments(db, ownerId, unused);
      return toHangarAircraft(await aircraftFor(db, pilot.id, params.id));
    },
  },
  {
    method: 'GET',
    path: '/aircraft/:id/log',
    async handler({ db, pilot, params, query }) {
      await aircraftFor(db, pilot.id, params.id);
      const { before, limit } = paging(query);
      return listLog(db, params.id, before, limit);
    },
  },
  {
    method: 'GET',
    path: '/aircraft/:id/revisions',
    async handler({ db, pilot, params, query }) {
      await aircraftFor(db, pilot.id, params.id);
      const { before, limit } = paging(query);
      return listRevisions(db, params.id, before, limit);
    },
  },
  {
    method: 'GET',
    path: '/aircraft/:id/revisions/:rev',
    async handler({ db, pilot, params }): Promise<AircraftRevisionDetail> {
      await aircraftFor(db, pilot.id, params.id);
      const { revision, snapshot } = await revisionOf(db, params.id, params.rev);
      const now: AircraftSnapshot = await snapshotOf(db, params.id);
      const head = (await headRevision(db, params.id)) ?? { id: revision.id, at: revision.at };
      return { revision, snapshot, changes: diffSnapshots(now, snapshot, await storedFiles(db, params.id)), head };
    },
  },
  {
    method: 'POST',
    path: '/aircraft/:id/revisions/:rev/restore',
    async handler({ db, pilot, params, body }) {
      const v = ((await body()) ?? {}) as Record<string, unknown>;
      const int = (x: unknown, name: string) => {
        if (x === undefined || x === null) return undefined;
        if (typeof x !== 'number' || !Number.isInteger(x)) throw badRequest(`${name} must be an integer`);
        return x;
      };
      return restore(db, pilot.id, params.id, params.rev, {
        head: int(v.head, 'head'),
        headAt: int(v.headAt, 'headAt'),
      });
    },
  },
  {
    method: 'DELETE',
    path: '/aircraft/:id',
    async handler({ db, pilot, params }) {
      await aircraftFor(db, pilot.id, params.id, 'owner');
      const r = await db.query('DELETE FROM aircraft WHERE id = $1 AND pilot_id = $2 RETURNING id', [
        params.id,
        pilot.id,
      ]);
      if (!r.length) throw notFound('no such aircraft');
      return undefined;
    },
  },
];
