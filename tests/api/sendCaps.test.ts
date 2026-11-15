// Sending caps (api/_lib/sendCaps.ts): e-mails to HCAA per flight and form (5) and per pilot (20)
// in any rolling 24 hours, re-sends included, failed sends not counted; signing links per flight
// (20) and per pilot (60). The mail transport is MOCKED: nothing is sent for real.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { client, startApi, type Client } from './helpers';
import { setMailTransport } from '../../api/_lib/mail';
import { LINK_DAILY_CAP, LINK_FLIGHT_CAP, MAIL_DAILY_CAP, MAIL_FLIGHT_FORM_CAP } from '../../api/_lib/sendCaps';
import aerodromes from '../../src/data/ref/aerodromes.json';
import type { RefAerodrome } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import type { Db } from '../../api/_lib/db';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => { const a = ADS.find((x) => x.icao === icao)!; return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon }; };
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
const person = (fullName: string) => ({ fullName, phone: '+30 690 000 0000', dateOfBirth: null, weightKg: 70, idNumber: 'AB1', idType: 'ID', nationality: '', relation: '' });

let api: Awaited<ReturnType<typeof startApi>>;
let db: Db;
let sent = 0;
afterEach(() => setMailTransport(null));
const mockMail = () => setMailTransport(async () => ({ id: `m-${++sent}` }));

beforeAll(async () => {
  api = await startApi();
  db = (await api.server.ready).db;
});
afterAll(() => api.close());

async function pilot(n: string): Promise<{ c: Client; id: string }> {
  const c = client(api.base);
  expect((await c.login(`sub-cap-${n}`, `cap-${n}@example.com`)).status).toBe(200);
  await c.call('PUT', 'me', { fullName: `Cap Pilot ${n}`, phone: '+30 690 000 0001' });
  return { c, id: (await c.call('GET', 'me')).body.id };
}
async function flight(c: Client, pax = false): Promise<{ id: string; paxKey?: string }> {
  let paxKey: string | undefined;
  const crew = [{ role: 'PIC', passengerId: null, seat: 'front-left', snapshot: person('') }];
  if (pax) {
    paxKey = (await c.call('POST', 'passengers', { fullName: 'Anna Pax' })).body.id;
    crew.push({ role: 'PAX', passengerId: paxKey as any, seat: 'front-right', snapshot: person('Anna Pax') });
  }
  const f = (await c.call('POST', 'flights', { date: tomorrow, blockOff: '08:00', route: [pt('LGAV', 'a'), pt('LGTT', 'b')], crew })).body;
  expect(f.id).toBeTruthy();
  return { id: f.id, paxKey };
}
const sendGendec = (c: Client, id: string) => c.call('POST', `flights/${id}/forms/gendec/send`, { resend: true });

describe('e-mail caps', () => {
  test(`a form goes out at most ${MAIL_FLIGHT_FORM_CAP} times per flight in 24 h, re-sends included; failures do not count`, async () => {
    const { c } = await pilot('flight');
    const f = await flight(c);
    // a failed send is not counted
    setMailTransport(async () => { throw new Error('provider down'); });
    expect((await sendGendec(c, f.id)).status).toBe(502);
    mockMail();
    const n0 = sent;
    for (let i = 0; i < MAIL_FLIGHT_FORM_CAP; i++) expect((await sendGendec(c, f.id)).status).toBe(200);
    const r = await sendGendec(c, f.id);
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/already e-mailed 5 times for this flight in the last 24 hours\. Try again after \d\d:\d\d UTC\./);
    expect(r.body.retryAfter).toBeGreaterThan(0);
    expect(sent - n0).toBe(MAIL_FLIGHT_FORM_CAP);
    // another flight is not affected
    expect((await sendGendec(c, (await flight(c)).id)).status).toBe(200);
  });

  test(`at most ${MAIL_DAILY_CAP} e-mails per pilot in 24 h; older ones do not count`, async () => {
    const { c, id } = await pilot('daily');
    mockMail();
    // 18 sends of 25 h ago (outside the window) and 16 within it, on other flights
    const now = Date.now();
    for (let i = 0; i < 18; i++) await db.query('INSERT INTO mail_log (id, pilot_id, flight_id, form, at) VALUES ($1,$2,$3,$4,$5)', [`old${i}`, id, `fx${i}`, '731', now - 25 * 3600e3]);
    for (let i = 0; i < MAIL_DAILY_CAP - 4; i++) await db.query('INSERT INTO mail_log (id, pilot_id, flight_id, form, at) VALUES ($1,$2,$3,$4,$5)', [`new${i}`, id, `fy${i}`, '731', now - 3600e3 * (1 + i / 10)]);
    const f1 = await flight(c);
    const f2 = await flight(c);
    for (let i = 0; i < 4; i++) expect((await sendGendec(c, i < 2 ? f1.id : f2.id)).status).toBe(200);
    const n0 = sent;
    const r = await sendGendec(c, (await flight(c)).id);
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/You have sent 20 e-mails in the last 24 hours/);
    // the oldest counted send was 2.5 h ago: sending opens again ~21.5 h from now
    expect(r.body.retryAfter).toBeGreaterThan(21 * 3600);
    expect(r.body.retryAfter).toBeLessThan(22 * 3600);
    expect(sent).toBe(n0);
    // the refused attempt left no reservation behind
    const [{ n }] = await db.query('SELECT count(*)::int AS n FROM mail_log WHERE pilot_id = $1 AND at > $2', [id, now - 24 * 3600e3]);
    expect(n).toBe(MAIL_DAILY_CAP);
  });

  test('caps are per pilot', async () => {
    const { c } = await pilot('other');
    mockMail();
    expect((await sendGendec(c, (await flight(c)).id)).status).toBe(200);
  });
});

describe('signing link caps', () => {
  test(`at most ${LINK_FLIGHT_CAP} signing links per flight in 24 h, renewals included`, async () => {
    const { c } = await pilot('links');
    const f = await flight(c, true);
    expect(Object.keys((await c.call('POST', `flights/${f.id}/forms/731/links`)).body.links)).toEqual([f.paxKey]);
    for (let i = 1; i < LINK_FLIGHT_CAP; i++) expect((await c.call('POST', `flights/${f.id}/forms/731/links/${f.paxKey}/renew`)).status).toBe(200);
    const r = await c.call('POST', `flights/${f.id}/forms/731/links/${f.paxKey}/renew`);
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/Too many signing links for this flight/);
  });

  test(`at most ${LINK_DAILY_CAP} signing links per pilot in 24 h`, async () => {
    const { c, id } = await pilot('links-daily');
    const f = await flight(c, true);
    const other = await flight(c);
    // links of the last hours, on the pilot's other flight
    const now = Date.now();
    for (let i = 0; i < LINK_DAILY_CAP; i++) {
      await db.query(`INSERT INTO form_links (id, pilot_id, flight_id, person_key, token_hash, created, expires) VALUES ($1,$2,$3,'k',$4,$5,$6)`,
        [`lk${i}-${id}`, id, other.id, `h${i}-${id}`, now - 3600e3, now + 3600e3]);
    }
    const r = await c.call('POST', `flights/${f.id}/forms/731/links`);
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/Too many signing links: at most 60 in 24 hours/);
  });
});
