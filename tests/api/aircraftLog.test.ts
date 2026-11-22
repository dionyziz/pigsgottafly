// The edit log of an aircraft (api/_lib/aircraftLog.ts, migration 056): creation, saves coalesced per
// pilot within the window, summaries of tables, files, photo and sharing entries, who can read it,
// updatedAt/updatedBy in the hangar, and what account deletion and export do with it.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { Db } from '../../api/_lib/db';
import type { AircraftLogEntry, AircraftLogPage, HangarAircraft } from '../../src/shared';
import { AIRCRAFT_LOG_COALESCE_MS } from '../../src/shared';
import { blankAircraft } from '../../src/shared/templates';
import { type Client, client, startApi } from './helpers';

let api: Awaited<ReturnType<typeof startApi>>;
let db: Db;
let owner: Client, editor: Client, viewer: Client, stranger: Client;
const ids: Record<string, string> = {};

const aircraftBody = (reg: string) => {
  const ac = blankAircraft();
  ac.registration = reg;
  ac.cruiseTasKt = 95;
  ac.patternTasKt = 80;
  ac.massBalance.stations = [
    { id: 'front', name: 'Front', kind: 'seat', armM: 0.94, seats: [{ id: 'fl', label: 'Front left' }] },
    { id: 'rear', name: 'Rear', kind: 'seat', armM: 1.85, seats: [{ id: 'rl', label: 'Rear left' }] },
    { id: 'bag', name: 'Baggage', kind: 'baggage', armM: 2.4, maxKg: 54 },
  ];
  return ac;
};

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
    expect((await c.login(`log-${sub}`, email)).status).toBe(200);
    ids[sub] = (await c.call('GET', 'me')).body.id;
  }
  await owner.call('PUT', 'me', { fullName: 'Olga Owner' });
  await editor.call('PUT', 'me', { fullName: 'Eddie Editor' });
});
afterAll(() => api.close());

async function newAircraft(reg: string): Promise<HangarAircraft> {
  const r = await owner.call<HangarAircraft>('POST', 'aircraft', aircraftBody(reg));
  expect(r.status).toBe(201);
  return r.body;
}
const log = async (c: Client, id: string, q = '') =>
  (await c.call<AircraftLogPage>('GET', `aircraft/${id}/log${q}`)).body;
const put = async (c: Client, ac: HangarAircraft, patch: Partial<HangarAircraft>) => {
  const r = await c.call<HangarAircraft>('PUT', `aircraft/${ac.id}`, { ...ac, ...patch });
  expect(r.status).toBe(200);
  return r.body;
};
/** Moves the newest entry back in time, past the coalescing window. */
const age = (id: string) =>
  db.query(
    `UPDATE aircraft_log SET at = at - $2 WHERE id = (SELECT max(id) FROM aircraft_log WHERE aircraft_id = $1)`,
    [id, AIRCRAFT_LOG_COALESCE_MS + 1000],
  );
async function share(id: string, email: string, role: 'view' | 'edit') {
  expect((await owner.call('POST', `aircraft/${id}/shares`, { email, role })).status).toBe(201);
}

describe('edits', () => {
  let ac: HangarAircraft;
  beforeAll(async () => {
    ac = await newAircraft('SX-LOG');
    await share(ac.id, 'eddie@example.com', 'edit');
    await share(ac.id, 'vera@example.com', 'view');
  });

  test('creation is the first entry; the hangar says who updated the aircraft', async () => {
    const { entries, next } = await log(owner, ac.id);
    expect(next).toBeNull();
    expect(entries.map((e) => e.kind)).toEqual(['share-add', 'share-add', 'create']);
    expect(entries[2].by).toEqual({ pilotId: ids.o, name: 'Olga Owner' });
    expect(entries[0]).toMatchObject({ person: 'vera', personId: ids.v, role: 'view' });
    expect(entries[1]).toMatchObject({ person: 'Eddie Editor', personId: ids.e, role: 'edit' });
    const listed = (await viewer.call<HangarAircraft[]>('GET', 'aircraft')).body.find((a) => a.id === ac.id)!;
    // sharing is not an update of the aircraft
    expect(listed.updatedBy).toEqual({ pilotId: ids.o, name: 'Olga Owner' });
    expect(listed.updatedAt).toBe(entries[2].at);
  });

  test('a save records the fields it changed, old → new', async () => {
    ac = await put(owner, ac, { cruiseTasKt: 100, colours: 'WHITE' });
    const [e] = (await log(owner, ac.id)).entries;
    expect(e).toMatchObject({ kind: 'edit', by: { pilotId: ids.o } });
    expect(e.changes).toEqual([
      { path: 'colours', from: '', to: 'WHITE' },
      { path: 'cruiseTasKt', from: 95, to: 100 },
    ]);
    expect(ac.updatedAt).toBe(e.at);
    expect(ac.updatedBy).toEqual({ pilotId: ids.o, name: 'Olga Owner' });
  });

  test('saves within the window coalesce: first old → latest new; fields changed back drop out', async () => {
    ac = await put(owner, ac, { cruiseTasKt: 105, colours: '' });
    ac = await put(owner, ac, { cruiseTasKt: 110, fuel: { ...ac.fuel, usableL: 140 } });
    const { entries } = await log(owner, ac.id);
    expect(entries.filter((e) => e.kind === 'edit')).toHaveLength(1);
    expect(entries[0].changes).toEqual([
      { path: 'cruiseTasKt', from: 95, to: 110 },
      { path: 'fuel.usableL', from: 0, to: 140 },
    ]);
  });

  test('a save that changes nothing records nothing', async () => {
    const before = await log(owner, ac.id);
    await age(ac.id);
    ac = await put(owner, ac, {});
    expect((await log(owner, ac.id)).entries.map((e) => e.id)).toEqual(before.entries.map((e) => e.id));
  });

  test('after the window, a new entry', async () => {
    ac = await put(owner, ac, { cruiseTasKt: 115 });
    const { entries } = await log(owner, ac.id);
    expect(entries.filter((e) => e.kind === 'edit')).toHaveLength(2);
    expect(entries[0].changes).toEqual([{ path: 'cruiseTasKt', from: 110, to: 115 }]);
    expect(entries[1].changes[0]).toEqual({ path: 'cruiseTasKt', from: 95, to: 110 });
  });

  test('another pilot’s save is their own entry, even within the window', async () => {
    ac = await put(editor, ac, { patternTasKt: 75 });
    ac = await put(owner, ac, { cruiseTasKt: 120 });
    const { entries } = await log(owner, ac.id);
    expect(entries.slice(0, 3).map((e) => [e.by.name, e.changes.map((c) => `${c.path} ${c.from}→${c.to}`)])).toEqual([
      ['Olga Owner', ['cruiseTasKt 115→120']],
      ['Eddie Editor', ['patternTasKt 80→75']],
      ['Olga Owner', ['cruiseTasKt 110→115']],
    ]);
    // only the newest entry keeps the aircraft it started from
    const [{ n }] = await db.query(
      'SELECT count(*)::int AS n FROM aircraft_log WHERE aircraft_id = $1 AND before_doc IS NOT NULL',
      [ac.id],
    );
    expect(n).toBe(1);
    const listed = (await editor.call<HangarAircraft[]>('GET', 'aircraft')).body.find((a) => a.id === ac.id)!;
    expect(listed.updatedBy).toEqual({ pilotId: ids.o, name: 'Olga Owner' });
  });

  test('tables and lists are summarized, long text only changed', async () => {
    await age(ac.id);
    const mb = structuredClone(ac.massBalance);
    mb.stations[0].armM = 0.95;
    mb.stations[1].armM = 1.9;
    mb.stations.push({ id: 'bag2', name: 'Baggage 2', kind: 'baggage', armM: 3, maxKg: 20 });
    mb.envelopes.normal.polygon = [
      [0.9, 600],
      [1.1, 1043],
      [1.2, 1043],
      [1.2, 600],
    ];
    const perf = structuredClone(ac.performance);
    perf.takeoff.altitudesFt = [0, 2000];
    perf.takeoff.standardTempC = [15, 11];
    perf.landing.altitudesFt = [0];
    perf.landing.standardTempC = [15];
    perf.landing.distances = [[200, 400]];
    ac = await put(owner, ac, { massBalance: mb, performance: perf, notes: 'x'.repeat(300) });
    const [e] = (await log(owner, ac.id)).entries;
    expect(e.changes).toEqual([
      { path: 'massBalance.stations', summary: '2 stations changed, 1 station added' },
      { path: 'massBalance.envelopes.normal.polygon', summary: 'normal CG envelope changed' },
      { path: 'performance.takeoff.table', summary: 'take-off table changed' },
      { path: 'performance.landing.table', summary: 'landing table changed' },
      { path: 'notes' },
    ]);
    expect(JSON.stringify(e)).not.toContain('xxxxx');
  });

  test('pages, newest first', async () => {
    const all = (await log(viewer, ac.id)).entries;
    const p1 = await log(viewer, ac.id, '?limit=2');
    expect(p1.entries.map((e) => e.id)).toEqual(all.slice(0, 2).map((e) => e.id));
    const p2 = await log(viewer, ac.id, `?limit=2&before=${p1.next}`);
    expect(p2.entries.map((e) => e.id)).toEqual(all.slice(2, 4).map((e) => e.id));
    expect((await viewer.call('GET', `aircraft/${ac.id}/log?limit=0`)).status).toBe(400);
  });

  test('anyone who can view the aircraft reads the log; a viewer cannot write; a stranger gets 404', async () => {
    expect((await viewer.call('GET', `aircraft/${ac.id}/log`)).status).toBe(200);
    expect((await viewer.call('PUT', `aircraft/${ac.id}`, { ...ac, cruiseTasKt: 1 })).status).toBe(403);
    expect((await stranger.call('GET', `aircraft/${ac.id}/log`)).status).toBe(404);
  });
});

describe('files, photo and sharing', () => {
  let ac: HangarAircraft;
  const PDF = Buffer.from('%PDF-1.4 x').toString('base64');
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
  async function upload(c: Client, kind: 'photo' | 'document', title = '') {
    const data = kind === 'photo' ? JPEG : PDF;
    const size = Buffer.from(data, 'base64').length;
    const f = (
      await c.call('POST', `aircraft/${ac.id}/files`, {
        kind,
        name: kind === 'photo' ? 'p.jpg' : 'poh.pdf',
        title,
        mime: kind === 'photo' ? 'image/jpeg' : 'application/pdf',
        size,
      })
    ).body;
    expect((await c.call('PUT', `aircraft/${ac.id}/files/${f.id}/chunks/0`, { data })).status).toBe(204);
    expect((await c.call('POST', `aircraft/${ac.id}/files/${f.id}/complete`)).status).toBe(200);
    return f.id as string;
  }
  const kinds = async () => (await log(owner, ac.id)).entries.map((e) => e.kind);

  beforeAll(async () => {
    ac = await newAircraft('SX-FIL');
    await share(ac.id, 'eddie@example.com', 'edit');
  });

  test('documents added, renamed, removed', async () => {
    const id = await upload(editor, 'document', 'POH');
    expect((await editor.call('PUT', `aircraft/${ac.id}/files/${id}`, { title: 'AFM' })).status).toBe(200);
    expect((await editor.call('DELETE', `aircraft/${ac.id}/files/${id}`)).status).toBe(204);
    const [rm, ren, add] = (await log(owner, ac.id)).entries;
    expect(add).toMatchObject({ kind: 'document-add', file: 'POH', by: { pilotId: ids.e, name: 'Eddie Editor' } });
    expect(ren).toMatchObject({
      kind: 'document-rename',
      file: 'AFM',
      changes: [{ path: 'title', from: 'POH', to: 'AFM' }],
    });
    expect(rm).toMatchObject({ kind: 'document-remove', file: 'AFM' });
    const listed = (await owner.call<HangarAircraft[]>('GET', 'aircraft')).body.find((a) => a.id === ac.id)!;
    expect(listed.updatedBy).toEqual({ pilotId: ids.e, name: 'Eddie Editor' });
  });

  test('the photo set and removed', async () => {
    const id = await upload(owner, 'photo');
    expect((await owner.call('DELETE', `aircraft/${ac.id}/files/${id}`)).status).toBe(204);
    expect((await kinds()).slice(0, 2)).toEqual(['photo-remove', 'photo-set']);
  });

  test('sharing: added, role changed, removed; invited addresses; leaving', async () => {
    await share(ac.id, 'vera@example.com', 'view');
    expect((await owner.call('PUT', `aircraft/${ac.id}/shares/${ids.v}`, { role: 'edit' })).status).toBe(200);
    expect((await owner.call('DELETE', `aircraft/${ac.id}/shares/${ids.v}`)).status).toBe(204);
    await share(ac.id, 'nobody.yet@example.com', 'view');
    expect((await owner.call('DELETE', `aircraft/${ac.id}/shares/nobody.yet@example.com`)).status).toBe(204);
    expect((await editor.call('DELETE', `aircraft/${ac.id}/shares/${ids.e}`)).status).toBe(204);
    const es = (await log(owner, ac.id)).entries.slice(0, 6).reverse();
    const brief = (e: AircraftLogEntry) => [e.kind, e.by.name, e.person, e.role ?? null];
    expect(es.map(brief)).toEqual([
      ['share-add', 'Olga Owner', 'vera', 'view'],
      ['share-role', 'Olga Owner', 'vera', 'edit'],
      ['share-remove', 'Olga Owner', 'vera', null],
      ['share-add', 'Olga Owner', 'nobody.yet@example.com', 'view'],
      ['share-remove', 'Olga Owner', 'nobody.yet@example.com', null],
      ['share-remove', 'Eddie Editor', 'Eddie Editor', null],
    ]);
    expect(es[5].personId).toBe(ids.e);
  });
});

describe('account deletion and export', () => {
  test('the export lists the pilot’s edits; after deletion they stay, by a former pilot', async () => {
    const ac = await newAircraft('SX-GON');
    const leaver = client(api.base);
    expect((await leaver.login('log-gone', 'gone@example.com')).status).toBe(200);
    await leaver.call('PUT', 'me', { fullName: 'Gina Gone' });
    await share(ac.id, 'gone@example.com', 'edit');
    expect((await leaver.call('PUT', `aircraft/${ac.id}`, { ...ac, serial: '17262' })).status).toBe(200);

    const x = (await leaver.call('GET', 'me/export')).body;
    expect(x.aircraftEdits).toEqual([
      expect.objectContaining({
        registration: 'SX-GON',
        kind: 'edit',
        changes: [{ path: 'serial', from: '', to: '17262' }],
      }),
    ]);

    expect((await leaver.call('DELETE', 'me', { confirm: 'gone@example.com' })).status).toBe(200);
    const { entries } = await log(owner, ac.id);
    expect(entries.map((e) => [e.kind, e.by, e.person ?? null])).toEqual([
      ['edit', { pilotId: null, name: '' }, null],
      ['share-add', { pilotId: ids.o, name: 'Olga Owner' }, ''],
      ['create', { pilotId: ids.o, name: 'Olga Owner' }, null],
    ]);
    const listed = (await owner.call<HangarAircraft[]>('GET', 'aircraft')).body.find((a) => a.id === ac.id)!;
    expect(listed.updatedBy).toEqual({ pilotId: null, name: '' });
    const rows = await db.query(`SELECT * FROM aircraft_log WHERE aircraft_id = $1`, [ac.id]);
    expect(JSON.stringify(rows)).not.toMatch(/gone@example\.com|Gina Gone/);
  });
});
