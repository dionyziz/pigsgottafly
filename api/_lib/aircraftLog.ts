// The edit log of an aircraft (migration 056): every saved change, file, photo and sharing change,
// with who made it. Edits are stored as a compact diff computed here from the aircraft before and
// after the save, not as what the client sent: autosave sends the whole aircraft every time.
// Lists and tables (stations, envelopes, performance tables, compass cards) are summarized
// ('3 stations changed') rather than dumped, and long text only says that it changed.
import {
  AIRCRAFT_LOG_COALESCE_MS,
  type AircraftEditor,
  type AircraftLogChange,
  type AircraftLogEntry,
  type AircraftLogKind,
  type AircraftLogPage,
  type AircraftLogValue,
  type ShareRole,
} from '../../src/shared/sharing.js';
import { blankAircraft } from '../../src/shared/templates.js';
import type { AircraftInput } from '../../src/shared/types.js';
import type { Queryable, Row } from './db.js';

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep equality of JSON values, whatever the key order (jsonb reorders keys). */
export function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => k in b && sameJson(a[k], b[k]));
  }
  return false;
}

/** Text up to this long is shown as old → new; longer text only "changed". */
const MAX_TEXT = 80;
/** Not shown: the operator's name (operator) says the same. */
const SKIP = new Set(['operatorId']);

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** '2 stations changed, 1 added' for lists of records (by key, else by position). */
function listSummary(noun: string, a: Json, b: Json, key?: string): string {
  const xs = Array.isArray(a) ? a : [];
  const ys = Array.isArray(b) ? b : [];
  const keyOf = (v: Json, i: number) => (key && isObj(v) ? String(v[key]) : String(i));
  const before = new Map(xs.map((v, i) => [keyOf(v, i), v]));
  const after = new Map(ys.map((v, i) => [keyOf(v, i), v]));
  let changed = 0;
  let added = 0;
  let removed = 0;
  for (const [k, v] of after) {
    if (!before.has(k)) added++;
    else if (!sameJson(before.get(k), v)) changed++;
  }
  for (const k of before.keys()) if (!after.has(k)) removed++;
  const parts = [
    changed && `${plural(changed, noun)} changed`,
    added && `${plural(added, noun)} added`,
    removed && `${plural(removed, noun)} removed`,
  ].filter(Boolean);
  // same records, another order
  return parts.length ? parts.join(', ') : `${noun}s reordered`;
}

const optional = (noun: string) => (a: Json, b: Json) =>
  a == null ? `${noun} added` : b == null ? `${noun} removed` : `${noun} changed`;

/** Subtrees reported as one summary line. */
const SUMMARY: Record<string, (a: Json, b: Json) => string> = {
  'massBalance.stations': (a, b) => listSummary('station', a, b, 'id'),
  'massBalance.combinedLimits': (a, b) => listSummary('combined limit', a, b),
  'massBalance.envelopes.normal.polygon': () => 'normal CG envelope changed',
  'massBalance.envelopes.normal.momentPolygon': () => 'normal moment envelope changed',
  'massBalance.envelopes.utility.polygon': () => 'utility CG envelope changed',
  'massBalance.envelopes.utility.momentPolygon': () => 'utility moment envelope changed',
  'performance.takeoff.notes': () => 'take-off notes changed',
  'performance.landing.notes': () => 'landing notes changed',
  'performance.factors.notes': () => 'performance factor notes changed',
  'performance.factors.runwayCondition': () => 'runway condition factors changed',
  'performance.stallIasKt': () => 'stall speeds changed',
  compassCards: (a, b) => listSummary('compass card', a, b),
};
/** Present or absent records: a summary when one side is null, else field by field. */
const NULLABLE: Record<string, (a: Json, b: Json) => string> = {
  'massBalance.envelopes.utility': optional('utility envelope'),
  'equipment.dinghies': optional('dinghies'),
};
/** Fields that together are one table: one summary line for any of them. */
const GROUPS: Record<string, { path: string; summary: string }> = {
  'performance.takeoff.altitudesFt': { path: 'performance.takeoff.table', summary: 'take-off table changed' },
  'performance.takeoff.standardTempC': { path: 'performance.takeoff.table', summary: 'take-off table changed' },
  'performance.takeoff.rows': { path: 'performance.takeoff.table', summary: 'take-off table changed' },
  'performance.landing.altitudesFt': { path: 'performance.landing.table', summary: 'landing table changed' },
  'performance.landing.standardTempC': { path: 'performance.landing.table', summary: 'landing table changed' },
  'performance.landing.distances': { path: 'performance.landing.table', summary: 'landing table changed' },
};
/** Values shown as text. */
const AS_TEXT: Record<string, (v: Json) => string> = {
  'fuel.types': (v) => (Array.isArray(v) ? v.map((g) => (isObj(g) ? String(g.type) : String(g))).join(', ') : ''),
};

const isScalar = (v: Json): v is AircraftLogValue =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const shortText = (v: Json) => typeof v !== 'string' || (v.length <= MAX_TEXT && !v.includes('\n'));

/** Keys in the order of `tpl` (the record as the hangar lays it out), then the others by name. */
function orderedKeys(a: Record<string, Json>, b: Record<string, Json>, tpl: Json): string[] {
  const order = isObj(tpl) ? Object.keys(tpl) : [];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
}

// The stored records come back from jsonb, which reorders keys: changes are listed in this order.
const TEMPLATE: Json = blankAircraft();

function walk(path: string, a: Json, b: Json, out: AircraftLogChange[], tpl: Json): void {
  if (SKIP.has(path) || sameJson(a, b)) return;
  const group = GROUPS[path];
  if (group) {
    if (!out.some((c) => c.path === group.path)) out.push({ path: group.path, summary: group.summary });
    return;
  }
  if (SUMMARY[path]) {
    out.push({ path, summary: SUMMARY[path](a, b) });
    return;
  }
  if (NULLABLE[path] && (a == null || b == null)) {
    out.push({ path, summary: NULLABLE[path](a, b) });
    return;
  }
  if (AS_TEXT[path]) {
    out.push({ path, from: AS_TEXT[path](a), to: AS_TEXT[path](b) });
    return;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of orderedKeys(a, b, tpl))
      walk(path ? `${path}.${k}` : k, a[k], b[k], out, isObj(tpl) ? tpl[k] : undefined);
    return;
  }
  // an absent optional field is null
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (isScalar(x) && isScalar(y)) {
    if (x === y) return;
    out.push(shortText(x) && shortText(y) ? { path, from: x, to: y } : { path });
    return;
  }
  if (Array.isArray(x) && Array.isArray(y) && [...x, ...y].every((v) => isScalar(v))) {
    const [s, t] = [x.join(', '), y.join(', ')];
    out.push(s.length <= MAX_TEXT && t.length <= MAX_TEXT ? { path, from: s, to: t } : { path });
    return;
  }
  out.push({ path });
}

/** The changes from one version of an aircraft to another (empty when nothing changed). */
export function diffAircraft(before: Partial<AircraftInput>, after: Partial<AircraftInput>): AircraftLogChange[] {
  const out: AircraftLogChange[] = [];
  walk('', before, after, out, TEMPLATE);
  return out;
}

// ---------------------------------------------------------------- storage

/**
 * Records a save of the aircraft by `authorId`. A save right after the same pilot's previous one
 * (the newest entry, within AIRCRAFT_LOG_COALESCE_MS of its last save) extends that entry: its
 * changes become the diff from the aircraft before its first save, so fields changed back drop out
 * (and so does the entry, when nothing is left).
 */
export async function logEdit(
  q: Queryable,
  aircraftId: string,
  authorId: string,
  before: AircraftInput,
  after: AircraftInput,
  now = Date.now(),
): Promise<void> {
  const [last] = await q.query(
    'SELECT id, kind, author_id, at, before_doc FROM aircraft_log WHERE aircraft_id = $1 ORDER BY id DESC LIMIT 1',
    [aircraftId],
  );
  if (
    last &&
    last.kind === 'edit' &&
    last.author_id === authorId &&
    last.before_doc &&
    now - Number(last.at) < AIRCRAFT_LOG_COALESCE_MS
  ) {
    const changes = diffAircraft(last.before_doc as AircraftInput, after);
    if (changes.length)
      await q.query('UPDATE aircraft_log SET changes = $2::jsonb, at = $3 WHERE id = $1', [
        last.id,
        JSON.stringify(changes),
        now,
      ]);
    else await q.query('DELETE FROM aircraft_log WHERE id = $1', [last.id]);
    return;
  }
  const changes = diffAircraft(before, after);
  if (!changes.length) return;
  // only the newest entry can be extended: the older ones need their starting point no more
  await q.query('UPDATE aircraft_log SET before_doc = NULL WHERE aircraft_id = $1 AND before_doc IS NOT NULL', [
    aircraftId,
  ]);
  await q.query(
    `INSERT INTO aircraft_log (aircraft_id, author_id, kind, started, at, changes, before_doc)
     VALUES ($1, $2, 'edit', $3, $3, $4::jsonb, $5::jsonb)`,
    [aircraftId, authorId, now, JSON.stringify(changes), JSON.stringify(before)],
  );
}

export interface LogEvent {
  kind: Exclude<AircraftLogKind, 'edit'>;
  changes?: AircraftLogChange[];
  file?: string;
  role?: ShareRole;
  /** share-*: the person's account, else the invited address. */
  subjectId?: string | null;
  subjectEmail?: string | null;
}

/** Records anything but an edit: creation, a file, the photo, a sharing change. */
export async function logEvent(
  q: Queryable,
  aircraftId: string,
  authorId: string,
  e: LogEvent,
  now = Date.now(),
): Promise<void> {
  const detail: Record<string, string> = {};
  if (e.file !== undefined) detail.file = e.file;
  if (e.role) detail.role = e.role;
  await q.query(
    `INSERT INTO aircraft_log (aircraft_id, author_id, kind, started, at, changes, detail, subject_id, subject_email)
     VALUES ($1, $2, $3, $4, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      aircraftId,
      authorId,
      e.kind,
      now,
      JSON.stringify(e.changes ?? []),
      JSON.stringify(detail),
      e.subjectId ?? null,
      e.subjectEmail?.toLowerCase() ?? null,
    ],
  );
}

// (access.ts has the same rule; importing it would make the two modules import each other)
const personName = (fullName: unknown, name: unknown) => String(fullName || '') || String(name || '');

export const editorOf = (id: unknown, fullName: unknown, name: unknown, email: unknown): AircraftEditor =>
  id ? { pilotId: String(id), name: personName(fullName, name) || String(email || '') } : { pilotId: null, name: '' };

/** The aircraft's log, newest first: `limit` entries before entry `before` (from the start without). */
export async function listLog(
  q: Queryable,
  aircraftId: string,
  before: number | null,
  limit: number,
): Promise<AircraftLogPage> {
  const rows = await q.query(
    `SELECT l.id, l.kind, l.at, l.changes, l.detail, l.author_id, l.subject_id, l.subject_email,
       a.full_name AS a_full_name, a.name AS a_name, a.email AS a_email,
       s.full_name AS s_full_name, s.name AS s_name, s.email AS s_email
     FROM aircraft_log l LEFT JOIN pilots a ON a.id = l.author_id LEFT JOIN pilots s ON s.id = l.subject_id
     WHERE l.aircraft_id = $1 AND ($2::bigint IS NULL OR l.id < $2)
     ORDER BY l.id DESC LIMIT $3`,
    [aircraftId, before, limit + 1],
  );
  const entries = rows.slice(0, limit).map((r: Row): AircraftLogEntry => {
    const e: AircraftLogEntry = {
      id: Number(r.id),
      at: Number(r.at),
      kind: r.kind,
      by: editorOf(r.author_id, r.a_full_name, r.a_name, r.a_email),
      changes: r.changes ?? [],
    };
    const d = (r.detail ?? {}) as { file?: string; role?: ShareRole };
    if (d.file !== undefined) e.file = d.file;
    if (d.role) e.role = d.role;
    if (String(r.kind).startsWith('share-')) {
      e.personId = r.subject_id ?? null;
      e.person = r.subject_id
        ? editorOf(r.subject_id, r.s_full_name, r.s_name, r.s_email).name
        : (r.subject_email ?? '');
    }
    return e;
  });
  return { entries, next: rows.length > limit ? entries[entries.length - 1].id : null };
}

/**
 * SQL joins for an aircraft query with alias `a`: the newest log entry other than sharing (lg_at,
 * lg_author) and its author (lg_full_name, lg_name, lg_email).
 */
export const LAST_EDIT_JOIN = `LEFT JOIN LATERAL (SELECT l.at, l.author_id FROM aircraft_log l
    WHERE l.aircraft_id = a.id AND l.kind NOT LIKE 'share-%' ORDER BY l.id DESC LIMIT 1) lg ON TRUE
  LEFT JOIN pilots lgp ON lgp.id = lg.author_id`;
export const LAST_EDIT_COLUMNS = `lg.at AS lg_at, lg.author_id AS lg_author, lgp.full_name AS lg_full_name,
  lgp.name AS lg_name, lgp.email AS lg_email`;

/** updatedAt / updatedBy of an aircraft row queried with LAST_EDIT_JOIN. */
export function lastEdit(r: Row): { updatedAt: number; updatedBy: AircraftEditor | null } {
  if (r.lg_at == null) return { updatedAt: Number(r.updated), updatedBy: null };
  return {
    updatedAt: Number(r.lg_at),
    updatedBy: editorOf(r.lg_author, r.lg_full_name, r.lg_name, r.lg_email),
  };
}
