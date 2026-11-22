// Version history of an aircraft (api/_lib/aircraftLog.ts, routes/aircraft.ts, migration 060): one
// revision per editing session with the aircraft as it left it, the preview against the current
// aircraft, restoring as a new revision (and undoing that), who may do what, the optimistic check,
// and files: attached again, detached rather than deleted, skipped when no longer stored.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { Db } from '../../api/_lib/db';
import type {
  AircraftFiles,
  AircraftRestoreResult,
  AircraftRevisionDetail,
  AircraftRevisionPage,
  HangarAircraft,
} from '../../src/shared';
import { AIRCRAFT_LOG_COALESCE_MS } from '../../src/shared';
import { blankAircraft } from '../../src/shared/templates';
import { type Client, client, startApi } from './helpers';

let api: Awaited<ReturnType<typeof startApi>>;
let db: Db;
let owner: Client, editor: Client, viewer: Client, stranger: Client;
const ids: Record<string, string> = {};

beforeAll(async () => {
  api = await startApi();
  db = (await api.server.ready).db;
  owner = client(api.base);
  editor = client(api.base);
  viewer = client(api.base);
  stranger = client(api.base);
  for (const [c, sub, email] of [
    [owner, 'o', 'olga@example.com'],
    [editor, 'e', 'eddie@example.com'],
    [viewer, 'v', 'vera@example.com'],
    [stranger, 's', 'stan@example.com'],
  ] as const) {
    expect((await c.login(`rev-${sub}`, email)).status).toBe(200);
    ids[sub] = (await c.call('GET', 'me')).body.id;
  }
  await owner.call('PUT', 'me', { fullName: 'Olga Owner' });
  await editor.call('PUT', 'me', { fullName: 'Eddie Editor' });
});
afterAll(() => api.close());

async function newAircraft(reg: string): Promise<HangarAircraft> {
  const ac = blankAircraft();
  ac.registration = reg;
  ac.cruiseTasKt = 95;
  ac.patternTasKt = 80;
  const r = await owner.call<HangarAircraft>('POST', 'aircraft', ac);
  expect(r.status).toBe(201);
  await owner.call('POST', `aircraft/${r.body.id}/shares`, { email: 'eddie@example.com', role: 'edit' });
  await owner.call('POST', `aircraft/${r.body.id}/shares`, { email: 'vera@example.com', role: 'view' });
  return r.body;
}
const put = async (c: Client, ac: HangarAircraft, patch: Partial<HangarAircraft>) => {
  const r = await c.call<HangarAircraft>('PUT', `aircraft/${ac.id}`, { ...ac, ...patch });
  expect(r.status).toBe(200);
  return r.body;
};
/** Ends the newest editing session (moves it back past the coalescing window). */
const age = (id: string) =>
  db.query(
    `UPDATE aircraft_log SET at = at - $2 WHERE id = (SELECT max(id) FROM aircraft_log WHERE aircraft_id = $1)`,
    [id, AIRCRAFT_LOG_COALESCE_MS + 1000],
  );
const revisions = async (c: Client, id: string, q = '') =>
  (await c.call<AircraftRevisionPage>('GET', `aircraft/${id}/revisions${q}`)).body;
const detail = async (c: Client, id: string, rev: number) => {
  const r = await c.call<AircraftRevisionDetail>('GET', `aircraft/${id}/revisions/${rev}`);
  expect(r.status).toBe(200);
  return r.body;
};
const restore = (c: Client, id: string, rev: number, body: object = {}) =>
  c.call<AircraftRestoreResult>('POST', `aircraft/${id}/revisions/${rev}/restore`, body);
const get = async (id: string) => (await owner.call<HangarAircraft>('GET', `aircraft/${id}`)).body;
const files = async (id: string) => (await owner.call<AircraftFiles>('GET', `aircraft/${id}/files`)).body;

const PDF = Buffer.from('%PDF-1.4 x').toString('base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
async function upload(c: Client, id: string, kind: 'photo' | 'document', title = '') {
  const data = kind === 'photo' ? JPEG : PDF;
  const f = (
    await c.call('POST', `aircraft/${id}/files`, {
      kind,
      name: kind === 'photo' ? 'p.jpg' : 'poh.pdf',
      title,
      mime: kind === 'photo' ? 'image/jpeg' : 'application/pdf',
      size: Buffer.from(data, 'base64').length,
    })
  ).body;
  expect((await c.call('PUT', `aircraft/${id}/files/${f.id}/chunks/0`, { data })).status).toBe(204);
  expect((await c.call('POST', `aircraft/${id}/files/${f.id}/complete`)).status).toBe(200);
  return f.id as string;
}

describe('revisions', () => {
  let ac: HangarAircraft;
  beforeAll(async () => {
    ac = await newAircraft('SX-REV');
  });

  test('one revision per editing session, newest first; sharing is none', async () => {
    ac = await put(owner, ac, { cruiseTasKt: 100 });
    ac = await put(owner, ac, { cruiseTasKt: 105, colours: 'WHITE' });
    await age(ac.id);
    ac = await put(editor, ac, { serial: '17262' });
    const { revisions: rs, next } = await revisions(viewer, ac.id);
    expect(next).toBeNull();
    expect(rs.map((r) => [r.kind, r.by.name])).toEqual([
      ['edit', 'Eddie Editor'],
      ['edit', 'Olga Owner'],
      ['create', 'Olga Owner'],
    ]);
    expect(rs[1].summary).toBe(
      'Olga Owner changed 2 fields: Colours and markings: — → WHITE; Cruise TAS: 95 kt → 105 kt',
    );
    expect(rs[2].summary).toBe('Olga Owner added the aircraft');
  });

  test('each keeps the aircraft as it left it', async () => {
    const rs = (await revisions(owner, ac.id)).revisions;
    const [now, mid, first] = await Promise.all(rs.map((r) => detail(owner, ac.id, r.id)));
    expect(first.snapshot.aircraft).toMatchObject({ cruiseTasKt: 95, colours: '', serial: '' });
    expect(mid.snapshot.aircraft).toMatchObject({ cruiseTasKt: 105, colours: 'WHITE', serial: '' });
    const {
      id: _i,
      created: _c,
      updated: _u,
      access: _a,
      photo: _p,
      placeholder: _pl,
      updatedAt: _ua,
      updatedBy: _ub,
      ...cur
    } = ac;
    expect(now.snapshot.aircraft).toEqual(cur);
    expect(now.snapshot).toMatchObject({ photo: null, documents: [] });
    expect(now.changes).toEqual([]);
    expect(now.head).toEqual({ id: rs[0].id, at: rs[0].at });
  });

  test('the preview lists what differs from the current aircraft (from now, to the version)', async () => {
    const first = (await revisions(owner, ac.id)).revisions.at(-1)!;
    const d = await detail(viewer, ac.id, first.id);
    expect(d.revision).toMatchObject({ id: first.id, kind: 'create' });
    expect(d.changes).toEqual([
      { path: 'serial', from: '17262', to: '' },
      { path: 'colours', from: 'WHITE', to: '' },
      { path: 'cruiseTasKt', from: 105, to: 95 },
    ]);
  });

  test('pages; unknown revisions are 404', async () => {
    const p1 = await revisions(owner, ac.id, '?limit=2');
    expect(p1.revisions).toHaveLength(2);
    const p2 = await revisions(owner, ac.id, `?limit=2&before=${p1.next}`);
    expect(p2.revisions.map((r) => r.kind)).toEqual(['create']);
    expect((await owner.call('GET', `aircraft/${ac.id}/revisions?limit=500`)).status).toBe(400);
    expect((await owner.call('GET', `aircraft/${ac.id}/revisions/999999`)).status).toBe(404);
    expect((await owner.call('GET', `aircraft/${ac.id}/revisions/abc`)).status).toBe(404);
    // a sharing entry is not a revision
    const [share] = await db.query(`SELECT id FROM aircraft_log WHERE aircraft_id = $1 AND kind = 'share-add'`, [
      ac.id,
    ]);
    expect((await owner.call('GET', `aircraft/${ac.id}/revisions/${share.id}`)).status).toBe(404);
  });

  test('restoring is a new revision that changes the aircraft; restoring the one before undoes it', async () => {
    const rs = (await revisions(owner, ac.id)).revisions;
    const first = rs.at(-1)!;
    const r = await restore(editor, ac.id, first.id, { head: rs[0].id, headAt: rs[0].at });
    expect(r.status).toBe(200);
    expect(r.body.aircraft).toMatchObject({ cruiseTasKt: 95, colours: '', serial: '' });
    expect(r.body.previous).toEqual({ id: rs[0].id, at: rs[0].at });
    expect(r.body.revision).toMatchObject({
      kind: 'restore',
      by: { pilotId: ids.e, name: 'Eddie Editor' },
      restored: { id: first.id, at: first.at, by: { pilotId: ids.o, name: 'Olga Owner' } },
    });
    expect(r.body.revision.summary).toMatch(
      /^Eddie Editor restored the version of \d{4}-\d\d-\d\d \d\d:\d\d by Olga Owner: /,
    );
    expect(await get(ac.id)).toMatchObject({ cruiseTasKt: 95, colours: '', serial: '' });
    const after = (await revisions(owner, ac.id)).revisions;
    expect(after).toHaveLength(rs.length + 1);
    expect(after[0].id).toBe(r.body.revision.id);
    // nothing is lost: the version restored over is still there, and the restore itself is a version
    const undo = await restore(editor, ac.id, r.body.previous.id);
    expect(undo.status).toBe(200);
    expect(await get(ac.id)).toMatchObject({ cruiseTasKt: 105, colours: 'WHITE', serial: '17262' });
    expect(undo.body.revision.restored?.id).toBe(rs[0].id);
    const redo = await restore(owner, ac.id, r.body.revision.id);
    expect(redo.status).toBe(200);
    expect(await get(ac.id)).toMatchObject({ cruiseTasKt: 95, serial: '' });
    // the next save is a session of its own, not merged into the restore
    ac = await get(ac.id);
    ac = await put(owner, ac, { cruiseTasKt: 99 });
    expect((await revisions(owner, ac.id)).revisions.slice(0, 2).map((x) => x.kind)).toEqual(['edit', 'restore']);
  });

  test('viewers browse and preview but cannot restore; strangers get 404', async () => {
    const [newest, older] = (await revisions(viewer, ac.id)).revisions;
    expect((await viewer.call('GET', `aircraft/${ac.id}/revisions/${older.id}`)).status).toBe(200);
    expect((await restore(viewer, ac.id, older.id)).status).toBe(403);
    expect((await stranger.call('GET', `aircraft/${ac.id}/revisions`)).status).toBe(404);
    expect((await stranger.call('GET', `aircraft/${ac.id}/revisions/${older.id}`)).status).toBe(404);
    expect((await restore(stranger, ac.id, older.id)).status).toBe(404);
    expect((await revisions(owner, ac.id)).revisions[0].id).toBe(newest.id);
  });

  test('a version that is not the newest any more is a 409 with the current aircraft', async () => {
    const [head, older] = (await revisions(owner, ac.id)).revisions;
    await age(ac.id);
    ac = await put(editor, ac, { cruiseTasKt: 101 });
    const stale = await restore(owner, ac.id, older.id, { head: head.id, headAt: head.at });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ id: ac.id, cruiseTasKt: 101 });
    expect((await get(ac.id)).cruiseTasKt).toBe(101);
    // the same entry, extended by a later save of the session, is a change too
    const [cur] = (await revisions(owner, ac.id)).revisions;
    ac = await put(editor, ac, { cruiseTasKt: 102 });
    expect((await restore(owner, ac.id, older.id, { head: cur.id, headAt: cur.at })).status).toBe(409);
    expect((await restore(owner, ac.id, older.id, { head: 'x' })).status).toBe(400);
  });

  test('restoring is validated as a save: a registration in use is a 409, an invalid version a 400', async () => {
    const other = await newAircraft('SX-RVA');
    await age(other.id);
    const renamed = await put(owner, other, { registration: 'SX-RVB' });
    const created = (await revisions(owner, other.id)).revisions.at(-1)!;
    await newAircraft('SX-RVA');
    expect((await restore(owner, other.id, created.id)).status).toBe(409);
    await db.query(
      `UPDATE aircraft_log SET snapshot = jsonb_set(snapshot, '{aircraft,cruiseTasKt}', '-5') WHERE id = $1`,
      [created.id],
    );
    expect((await restore(owner, other.id, created.id)).status).toBe(400);
    expect((await get(other.id)).registration).toBe(renamed.registration);
  });
});

describe('files', () => {
  let ac: HangarAircraft;
  beforeAll(async () => {
    ac = await newAircraft('SX-RVF');
  });
  const revs = async () => (await revisions(owner, ac.id)).revisions;

  test('file changes are revisions; a snapshot keeps the files attached by reference', async () => {
    const poh = await upload(editor, ac.id, 'document', 'POH');
    const photo = await upload(owner, ac.id, 'photo');
    const [p, d] = await revs();
    expect([p.kind, d.kind]).toEqual(['photo-set', 'document-add']);
    const s = (await detail(owner, ac.id, p.id)).snapshot;
    expect(s.photo).toMatchObject({ id: photo, kind: 'photo' });
    expect(s.documents.map((f) => [f.id, f.title])).toEqual([[poh, 'POH']]);
    expect(JSON.stringify(s)).not.toContain(PDF);
  });

  test('restoring detaches files the version did not have, and undoing attaches them again', async () => {
    const created = (await revs()).at(-1)!;
    const d = await detail(owner, ac.id, created.id);
    expect(d.changes.map((c) => c.summary)).toEqual(['document “POH” removed', 'photo removed']);
    const r = await restore(owner, ac.id, created.id);
    expect(r.status).toBe(200);
    expect(r.body.aircraft.photo).toBeNull();
    expect(await files(ac.id)).toEqual({ photo: null, documents: [] });
    expect(r.body.revision.changes.map((c) => c.summary)).toEqual(['document “POH” removed', 'photo removed']);
    // still stored, but out of reach
    const [{ n }] = await db.query(
      `SELECT count(*)::int AS n FROM aircraft_attachments WHERE aircraft_id = $1 AND detached`,
      [ac.id],
    );
    expect(n).toBe(2);
    const hidden = (
      await db.query(`SELECT id FROM aircraft_attachments WHERE aircraft_id = $1 AND kind = 'document'`, [ac.id])
    )[0].id;
    expect((await owner.call('GET', `aircraft/${ac.id}/files/${hidden}/chunks/0`)).status).toBe(404);

    const undo = await restore(owner, ac.id, r.body.previous.id);
    expect(undo.status).toBe(200);
    const f = await files(ac.id);
    expect(f.photo).not.toBeNull();
    expect(f.documents.map((x) => x.title)).toEqual(['POH']);
    expect(undo.body.aircraft.photo?.id).toBe(f.photo?.id);
  });

  test('titles come back; files deleted since are skipped and named', async () => {
    const [withBoth] = await revs();
    const doc = (await files(ac.id)).documents[0];
    await owner.call('PUT', `aircraft/${ac.id}/files/${doc.id}`, { title: 'AFM' });
    const t = await restore(owner, ac.id, withBoth.id);
    expect(t.status).toBe(200);
    expect((await files(ac.id)).documents.map((x) => x.title)).toEqual(['POH']);

    expect((await owner.call('DELETE', `aircraft/${ac.id}/files/${doc.id}`)).status).toBe(204);
    const newPhoto = await upload(owner, ac.id, 'photo');
    const preview = await detail(owner, ac.id, withBoth.id);
    expect(preview.changes.map((c) => c.summary)).toEqual([
      'document “POH” is no longer stored',
      'photo is no longer stored',
    ]);
    const r = await restore(owner, ac.id, withBoth.id);
    expect(r.status).toBe(200);
    expect(r.body.revision.skipped).toEqual(['document “POH”', 'the photo']);
    // what cannot come back leaves the aircraft as it is
    expect((await files(ac.id)).photo?.id).toBe(newPhoto);
    expect((await revisions(owner, ac.id)).revisions[0].skipped).toEqual(['document “POH”', 'the photo']);
  });

  test('a compass swing report deleted since is skipped; one still stored comes back', async () => {
    const report = async (name: string) =>
      (
        await owner.call('POST', `aircraft/${ac.id}/attachments`, {
          name,
          mime: 'application/pdf',
          data: PDF,
        })
      ).body;
    ac = await get(ac.id);
    const a = await report('swing-a.pdf');
    const card = {
      name: 'Magnetic compass',
      swung: '2026-01-01',
      expires: '2027-01-01',
      source: '',
      points: [],
      report: a,
    };
    await age(ac.id);
    ac = await put(owner, ac, { compassCards: [card] });
    const withA = (await revs())[0];
    await age(ac.id);
    ac = await put(owner, ac, { compassCards: [] });
    // the save deleted the report no card refers to any more
    const back = await restore(owner, ac.id, withA.id);
    expect(back.status).toBe(200);
    expect(back.body.revision.skipped).toEqual(['compass swing report “swing-a.pdf”']);
    expect(back.body.aircraft.compassCards).toHaveLength(1);
    expect(back.body.aircraft.compassCards[0].report).toBeUndefined();

    const b = await report('swing-b.pdf');
    ac = await get(ac.id);
    await age(ac.id);
    ac = await put(owner, ac, { compassCards: [{ ...card, report: b }] });
    const withB = (await revs())[0];
    const off = await restore(owner, ac.id, (await revs())[1].id);
    expect(off.body.aircraft.compassCards[0].report).toBeUndefined();
    // the restore keeps the report: undoing it brings it back
    const on = await restore(owner, ac.id, withB.id);
    expect(on.body.revision.skipped).toBeUndefined();
    expect(on.body.aircraft.compassCards[0].report?.id).toBe(b.id);
  });
});
