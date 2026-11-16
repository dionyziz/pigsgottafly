// The pilot's own account (api/_lib/routes/account.ts): GET /me/export (portability) and DELETE /me
// (erasure). After deletion, no column of any table may still hold the pilot's id, e-mail or the
// personal data they entered; another pilot's data (and flights that used the deleted pilot's
// shared aircraft) stays. The mail transport is MOCKED.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { client, googleClaims, signToken, startApi, type Client } from './helpers';
import { setMailTransport } from '../../api/_lib/mail';
import { blankAircraft } from '../../src/shared/templates';
import aerodromes from '../../src/data/ref/aerodromes.json';
import type { RefAerodrome } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import type { Db } from '../../api/_lib/db';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
const aircraftBody = (reg: string) => {
  const ac = blankAircraft();
  ac.registration = reg;
  ac.cruiseTasKt = 95;
  ac.patternTasKt = 80;
  ac.massBalance.stations = [
    {
      id: 'front',
      name: 'Front',
      kind: 'seat',
      armM: 0.94,
      seats: [
        { id: 'front-left', label: 'Front left' },
        { id: 'front-right', label: 'Front right' },
      ],
    },
  ];
  return ac;
};
const PDF = Buffer.from('%PDF-1.4 swing report').toString('base64');
const person = (fullName: string, idNumber = '') => ({
  fullName,
  phone: '',
  dateOfBirth: null,
  weightKg: 70,
  idNumber,
  idType: idNumber ? 'ID' : '',
  nationality: '',
  relation: '',
});

let api: Awaited<ReturnType<typeof startApi>>;
let db: Db;
let A: Client, B: Client;
const ids: Record<string, string> = {};
afterEach(() => setMailTransport(null));

beforeAll(async () => {
  api = await startApi();
  db = (await api.server.ready).db;
  A = client(api.base);
  B = client(api.base);
  expect((await A.login('sub-del-a', 'Leaving.Pilot@example.com')).status).toBe(200);
  expect((await B.login('sub-del-b', 'staying@example.com')).status).toBe(200);
  ids.a = (await A.call('GET', 'me')).body.id;
  ids.b = (await B.call('GET', 'me')).body.id;

  // A: profile, passenger, waypoint, aircraft with a file, a flight with a passenger, signing link, a sent form, trash
  await A.call('PUT', 'me', {
    fullName: 'Lena Leaving',
    phone: '+30 690 555 0101',
    idNumber: 'ZZ445566',
    idType: 'ID',
    licenceNo: 'GR.FCL.PPL.98765',
    nationality: 'GREEK',
  });
  const pax = (
    await A.call('POST', 'passengers', {
      fullName: 'Petros Passengeridis',
      phone: '+30 690 777 8899',
      idNumber: 'PP112233',
      idType: 'PASSPORT',
      nationality: 'GREEK',
    })
  ).body;
  ids.pax = pax.id;
  expect((await A.call('POST', 'waypoints', { name: 'LENAFIELD', lat: 38.1, lon: 23.9 })).status).toBe(201);
  const op = (
    await A.call('POST', 'operators', { name: 'Leaving Aviation', phone: '+30 210 555 0199', notes: 'Lena ops' })
  ).body;
  ids.op = op.id;
  const ac = (await A.call('POST', 'aircraft', { ...aircraftBody('SX-DEL'), operatorId: op.id })).body;
  expect(ac.operatorId).toBe(op.id);
  ids.ac = ac.id;
  expect(
    (await A.call('POST', `aircraft/${ac.id}/attachments`, { name: 'swing.pdf', mime: 'application/pdf', data: PDF }))
      .status,
  ).toBe(201);
  const doc = (
    await A.call('POST', `aircraft/${ac.id}/files`, {
      kind: 'document',
      name: 'poh.pdf',
      title: 'POH',
      mime: 'application/pdf',
      size: 10,
    })
  ).body;
  expect(
    (
      await A.call('PUT', `aircraft/${ac.id}/files/${doc.id}/chunks/0`, {
        data: Buffer.from('%PDF-1.4 x').toString('base64'),
      })
    ).status,
  ).toBe(204);
  expect((await A.call('POST', `aircraft/${ac.id}/files/${doc.id}/complete`)).status).toBe(200);
  const f = (
    await A.call('POST', 'flights', {
      date: tomorrow,
      blockOff: '08:00',
      aircraftId: ac.id,
      route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      crew: [
        { role: 'PIC', passengerId: null, seat: 'front-left', snapshot: person('Lena Leaving') },
        { role: 'PAX', passengerId: pax.id, seat: 'front-right', snapshot: person('Petros Passengeridis', 'PP112233') },
      ],
    })
  ).body;
  ids.flight = f.id;
  expect((await A.call('POST', `flights/${f.id}/forms/731/links`)).status).toBe(200);
  setMailTransport(async () => ({ id: 'm-1' }));
  expect((await A.call('POST', `flights/${f.id}/forms/gendec/send`)).status).toBe(200);
  const trashed = (await A.call('POST', 'flights', { date: tomorrow, route: [pt('LGTT', 'c')] })).body;
  expect((await A.call('DELETE', `flights/${trashed.id}`)).status).toBe(204);

  // sharing both ways: A shares SX-DEL with B (B flies it); B shares SX-STY with A
  expect(
    (await A.call('POST', `aircraft/${ac.id}/shares`, { email: 'staying@example.com', role: 'edit' })).status,
  ).toBe(201);
  const bac = (await B.call('POST', 'aircraft', aircraftBody('SX-STY'))).body;
  ids.bac = bac.id;
  expect(
    (await B.call('POST', `aircraft/${bac.id}/shares`, { email: 'leaving.pilot@example.com', role: 'view' })).status,
  ).toBe(201);
  const bf = (
    await B.call('POST', 'flights', { date: tomorrow, aircraftId: ac.id, route: [pt('LGTT', 'd'), pt('LGAV', 'e')] })
  ).body;
  ids.bflight = bf.id;
  await B.call('PUT', 'me', { fullName: 'Stavros Staying', defaultAircraftId: ac.id });

  // operators both ways: A owns "Leaving Aviation" (SX-DEL assigned above; a document, shared with B); B shares "Staying Club" with A
  const od = (
    await A.call('POST', `operators/${op.id}/files`, {
      kind: 'document',
      name: 'om.pdf',
      title: 'OM',
      mime: 'application/pdf',
      size: 10,
    })
  ).body;
  ids.opFile = od.id;
  expect(
    (
      await A.call('PUT', `operators/${op.id}/files/${od.id}/chunks/0`, {
        data: Buffer.from('%PDF-1.4 y').toString('base64'),
      })
    ).status,
  ).toBe(204);
  expect((await A.call('POST', `operators/${op.id}/files/${od.id}/complete`)).status).toBe(200);
  expect(
    (await A.call('POST', `operators/${op.id}/shares`, { email: 'staying@example.com', role: 'view' })).status,
  ).toBe(201);
  const bop = (await B.call('POST', 'operators', { name: 'Staying Club' })).body;
  ids.bop = bop.id;
  expect(
    (await B.call('POST', `operators/${bop.id}/shares`, { email: 'leaving.pilot@example.com', role: 'edit' })).status,
  ).toBe(201);
});
afterAll(() => api.close());

describe('GET /me/export', () => {
  test('everything the pilot owns, files listed without their bytes', async () => {
    const r = await fetch(api.base + 'me/export', { headers: { cookie: await cookieOf(A) } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(
      /^attachment; filename="pigsgottafly-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const x = await r.json();
    expect(x.format).toBe('pigsgottafly-export');
    expect(x.account).toMatchObject({ id: ids.a, email: 'Leaving.Pilot@example.com', googleSubject: 'sub-del-a' });
    expect(x.profile).toMatchObject({ fullName: 'Lena Leaving', licenceNo: 'GR.FCL.PPL.98765', idNumber: 'ZZ445566' });
    expect(x.passengers.map((p: any) => p.fullName)).toEqual(['Petros Passengeridis']);
    expect(x.waypoints.map((w: any) => w.name)).toEqual(['LENAFIELD']);
    expect(x.aircraft.map((a: any) => a.registration)).toEqual(['SX-DEL']);
    const files = x.aircraft[0].files;
    expect(files.map((f: any) => f.name).sort()).toEqual(['poh.pdf', 'swing.pdf']);
    expect(JSON.stringify(files)).not.toContain(PDF);
    expect(x.aircraft[0].sharedWith).toEqual([expect.objectContaining({ email: 'staying@example.com', role: 'edit' })]);
    expect(x.aircraftSharedWithMe).toEqual([
      expect.objectContaining({ registration: 'SX-STY', owner: 'staying@example.com', role: 'view' }),
    ]);
    expect(x.operators.map((o: any) => o.name)).toEqual(['Leaving Aviation']);
    expect(x.operators[0].files.map((f: any) => f.name)).toEqual(['om.pdf']);
    expect(x.operators[0].sharedWith).toEqual([
      expect.objectContaining({ email: 'staying@example.com', role: 'view' }),
    ]);
    expect(x.operatorsSharedWithMe).toEqual([
      expect.objectContaining({ name: 'Staying Club', owner: 'staying@example.com', role: 'edit' }),
    ]);
    expect(x.flights).toHaveLength(2);
    expect(x.flights.filter((f: any) => f.deleted)).toHaveLength(1);
    expect(x.flights.find((f: any) => f.id === ids.flight).crew).toHaveLength(2);
    expect(x.forms.signingLinks).toHaveLength(1);
    expect(JSON.stringify(x.forms)).not.toMatch(/token/i);
    expect(x.forms.submissions).toEqual([expect.objectContaining({ form: 'gendec', to: 'gendec@hcaa.gov.gr' })]);
    expect(x.forms.emailsSent).toHaveLength(1);
    // nothing of the other pilot beyond the share
    expect(JSON.stringify(x)).not.toContain(ids.bflight);
  });
});

describe('DELETE /me', () => {
  test('needs the account e-mail typed as confirmation', async () => {
    expect((await A.call('DELETE', 'me')).status).toBe(400);
    expect((await A.call('DELETE', 'me', { confirm: 'staying@example.com' })).status).toBe(400);
    expect((await A.call('GET', 'me')).status).toBe(200);
  });

  test('deletes the pilot and everything they own; no table keeps a trace', async () => {
    // a second session of A, to check that every session ends
    const A2 = client(api.base);
    await A2.login('sub-del-a', 'Leaving.Pilot@example.com');
    const before = await tablesHolding(['Leaving.Pilot@example.com', ids.a]);
    expect(before.length).toBeGreaterThan(5);

    const r = await fetch(api.base + 'me', {
      method: 'DELETE',
      headers: { cookie: await cookieOf(A), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: ' leaving.pilot@EXAMPLE.com ' }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/pgf_session=;.*Max-Age=0/);
    expect((await A.call('GET', 'me')).status).toBe(401);
    expect((await A2.call('GET', 'flights')).status).toBe(401);

    // no row in any table holds A's id, e-mail, or the personal data A entered
    const traces = [
      'Leaving.Pilot@example.com',
      'leaving.pilot@example.com',
      ids.a,
      ids.pax,
      ids.ac,
      ids.flight,
      ids.op,
      ids.opFile,
      'Leaving Aviation',
      'Lena ops',
      'Lena Leaving',
      'Petros Passengeridis',
      'PP112233',
      'ZZ445566',
      'LENAFIELD',
      'sub-del-a',
    ];
    expect(await tablesHolding(traces)).toEqual([]);
    // and no table has a pilot/owner column with a row for A
    const owned = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND (column_name ~ '(^|_)(pilot|owner)(_id)?$' OR column_name = 'created_by')`,
    );
    expect(owned.length).toBeGreaterThan(10);
    for (const c of owned) {
      const [n] = await db.query(
        `SELECT count(*)::int AS n FROM "${c.table_name}" WHERE "${c.column_name}"::text = $1`,
        [ids.a],
      );
      expect(`${c.table_name}.${c.column_name}: ${n.n}`).toBe(`${c.table_name}.${c.column_name}: 0`);
    }
  });

  test('the other pilot keeps their data; their flight on the deleted aircraft has no aircraft', async () => {
    expect((await B.call('GET', 'aircraft')).body.map((a: any) => a.registration)).toEqual(['SX-STY']);
    const f = (await B.call('GET', `flights/${ids.bflight}`)).body;
    expect(f.aircraftId).toBeNull();
    expect(f.route).toHaveLength(2);
    expect((await B.call('GET', 'me')).body).toMatchObject({ fullName: 'Stavros Staying', defaultAircraftId: null });
    expect((await B.call('GET', `aircraft/${ids.bac}/shares`)).body.people).toHaveLength(1);
    // A's operator is gone for B too; B's own operator stays, without A
    expect((await B.call('GET', 'operators')).body.map((o: any) => o.name)).toEqual(['Staying Club']);
    expect((await B.call('GET', `operators/${ids.bop}/shares`)).body.people).toHaveLength(1);
  });

  test('signing in again starts a new, empty account', async () => {
    expect((await A.login('sub-del-a', 'Leaving.Pilot@example.com')).status).toBe(200);
    const me = (await A.call('GET', 'me')).body;
    expect(me.id).not.toBe(ids.a);
    expect(me.fullName).toBe('');
    expect((await A.call('GET', 'flights')).body).toEqual([]);
    expect((await A.call('GET', 'passengers')).body).toEqual([]);
    expect((await A.call('GET', 'aircraft')).body).toEqual([]);
  });

  test('local mode: confirm with "delete"', async () => {
    const local = await startApi({ google: false });
    try {
      const c = client(local.base);
      await c.call('PUT', 'me', { fullName: 'Local Person' });
      expect((await c.call('DELETE', 'me', { confirm: '' })).status).toBe(400);
      expect((await c.call('DELETE', 'me', { confirm: 'DELETE' })).status).toBe(200);
      expect((await c.call('GET', 'me')).body.fullName).toBe('');
    } finally {
      await local.close();
    }
  });
});

/** A fresh session cookie for A or B (the helper client keeps its own private), to read response headers. */
async function cookieOf(c: Client): Promise<string> {
  const [sub, email] = c === A ? ['sub-del-a', 'Leaving.Pilot@example.com'] : ['sub-del-b', 'staying@example.com'];
  const r = await fetch(api.base + 'login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signToken(googleClaims(sub, email)) }),
  });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

/** "table.column" for every text-like column of every table holding one of these strings. */
async function tablesHolding(needles: string[]): Promise<string[]> {
  const cols = await db.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = current_schema() AND c.data_type IN ('text', 'jsonb', 'json', 'character varying')`,
  );
  const out: string[] = [];
  for (const c of cols) {
    const [r] = await db.query(
      `SELECT count(*)::int AS n FROM "${c.table_name}" WHERE ${needles.map((_, i) => `strpos("${c.column_name}"::text, $${i + 1}) > 0`).join(' OR ')}`,
      needles,
    );
    if (r.n) out.push(`${c.table_name}.${c.column_name}`);
  }
  return out;
}
