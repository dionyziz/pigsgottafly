// The navlog e-mailed to the signed-in pilot (api/_lib/routes/navlogMail.ts): the owner and a pilot the
// flight is shared with may e-mail it to their own address, nobody else; the content is normalized
// (bounded, no links); the PDF is the print (injected here) attached as <date>-navlog.pdf; the sending
// caps hold; a failed print fails the send and is recorded. The mail transport is MOCKED. The real
// print in headless Chromium is in sheetPdf.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { MAIL_FLIGHT_FORM_CAP, SELF_RESEND_MIN_MS } from '../../api/_lib/sendCaps';
import { AERODROMES as aerodromes } from '../../src/data/ref';
import type { NavlogContent, NavlogMailState } from '../../src/shared';
import type { RefAerodrome } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import { fixtureNavlog } from '../helpers/navlogFixture';
import { type Client, client, startApi } from './helpers';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};

let api: Awaited<ReturnType<typeof startApi>>;
let owner: Client, viewer: Client, stranger: Client;
let flightId = '';
const sent: SentMail[] = [];
let printed: NavlogContent[] = [];
let print: (c: NavlogContent) => Promise<Buffer> = async () => Buffer.from('%PDF-1.7 navlog');
const db = async () => (await api.server.ready).db;
const path = () => `flights/${flightId}/exports/navlog/email`;
const send = (c: Client, content: unknown = fixtureNavlog()) => c.call<NavlogMailState>('POST', path(), { content });
/** The pause between two sends of a flight's navlog, passed. */
const later = async () =>
  (await db()).query('UPDATE mail_log SET at = at - $2 WHERE flight_id = $1', [flightId, SELF_RESEND_MIN_MS + 1000]);

beforeAll(async () => {
  api = await startApi({
    navlogPdf: async (c) => {
      printed.push(c);
      return print(c);
    },
  });
  owner = client(api.base);
  viewer = client(api.base);
  stranger = client(api.base);
  await owner.login('nl-owner', 'olga@example.com');
  await viewer.login('nl-viewer', 'vic@example.com');
  await stranger.login('nl-stranger', 'stan@example.com');
  setMailTransport(async (m) => (sent.push(m), { id: `m-${sent.length}` }));
  flightId = (
    await owner.call('POST', 'flights', {
      date: '2026-12-01',
      route: [pt('LGTT', 'a'), pt('LGSY', 'b'), pt('LGMG', 'c')],
    })
  ).body.id;
  expect(
    (await owner.call('POST', `flights/${flightId}/shares`, { email: 'vic@example.com', role: 'view' })).status,
  ).toBe(201);
  sent.length = 0;
});
afterAll(() => api.close());
afterEach(async () => {
  setMailTransport(async (m) => (sent.push(m), { id: `m-${sent.length}` }));
  sent.length = 0;
  printed = [];
  print = async () => Buffer.from('%PDF-1.7 navlog');
  await (await db()).query('DELETE FROM mail_log');
});

describe('who may e-mail the navlog, and to whom', () => {
  test('the owner: to their own address only, the print attached as <date>-navlog.pdf', async () => {
    const st = (await owner.call<NavlogMailState>('GET', path())).body;
    expect(st).toEqual({ to: 'olga@example.com', sent: null, emailEnabled: true, emailReason: null });
    const r = await send(owner);
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.to).toEqual(['olga@example.com']);
    expect(m.cc ?? []).toEqual([]);
    expect(m.replyTo).toBeUndefined();
    expect(m.subject).toBe('Navlog 2026-12-01 LGTT–LGMG');
    expect(m.text).toContain('2 sheets');
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments![0]).toMatchObject({ filename: '2026-12-01-navlog.pdf', contentType: 'application/pdf' });
    expect(m.attachments![0].content.toString()).toBe('%PDF-1.7 navlog');
    // the print got the sheets as sent
    expect(printed).toEqual([fixtureNavlog()]);
    expect(r.body.sent).toMatchObject({ to: 'olga@example.com' });
    expect(Math.abs(Date.now() - r.body.sent!.sentAt)).toBeLessThan(60e3);
    const [row] = await (await db()).query(`SELECT * FROM mail_log WHERE flight_id = $1`, [flightId]);
    expect(row).toMatchObject({ form: 'navlog', result: 'sent', recipient: 'olga@example.com', message_id: 'm-1' });
    expect((await owner.call<NavlogMailState>('GET', path())).body.sent?.to).toBe('olga@example.com');
  });

  test('a pilot the flight is shared with: to their own address', async () => {
    const r = await send(viewer);
    expect(r.status).toBe(200);
    expect(sent.map((m) => m.to)).toEqual([['vic@example.com']]);
    expect(r.body.to).toBe('vic@example.com');
    // the owner's state is their own
    expect((await owner.call<NavlogMailState>('GET', path())).body.sent).toBeNull();
  });

  test('anyone else: no such flight, nothing printed or sent', async () => {
    expect((await stranger.call('GET', path())).status).toBe(404);
    expect((await send(stranger)).status).toBe(404);
    expect(printed).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('no e-mail address, no mail service, no printer: disabled with the reason', async () => {
    const d = await db();
    await d.query(`UPDATE pilots SET email = '' WHERE email = 'vic@example.com'`);
    try {
      const st = (await viewer.call<NavlogMailState>('GET', path())).body;
      expect(st).toMatchObject({
        to: '',
        emailEnabled: false,
        emailReason: expect.stringMatching(/no e-mail address/),
      });
      expect((await send(viewer)).status).toBe(403);
    } finally {
      await d.query(`UPDATE pilots SET email = 'vic@example.com' WHERE email = ''`);
    }
    setMailTransport(null);
    const env = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      expect((await owner.call<NavlogMailState>('GET', path())).body.emailReason).toMatch(/not configured/);
      expect((await send(owner)).status).toBe(503);
    } finally {
      if (env !== undefined) process.env.RESEND_API_KEY = env;
    }
    const plain = await startApi();
    try {
      const c = client(plain.base);
      await c.login('nl-plain', 'pat@example.com');
      const id = (await c.call('POST', 'flights', { date: '2026-12-01', route: [] })).body.id;
      setMailTransport(async (m) => (sent.push(m), { id: 'x' }));
      const st = (await c.call<NavlogMailState>('GET', `flights/${id}/exports/navlog/email`)).body;
      expect(st).toMatchObject({ emailEnabled: false, emailReason: expect.stringMatching(/Printing the navlog/) });
      expect((await c.call('POST', `flights/${id}/exports/navlog/email`, { content: fixtureNavlog() })).status).toBe(
        503,
      );
    } finally {
      await plain.close();
    }
    expect(printed).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('the content is checked and normalized on the server', () => {
  test('not a navlog: 400, nothing printed', async () => {
    for (const content of [null, 'sheets', [fixtureNavlog().sheets[0]], { sheets: [] }, { sheets: 'x' }])
      expect((await send(owner, content)).status, JSON.stringify(content)?.slice(0, 40)).toBe(400);
    expect(printed).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('bounded, rebuilt from the known fields, no links, e-mail addresses or markup that runs', async () => {
    const nav = fixtureNavlog();
    const s = structuredClone(nav.sheets[0]) as any;
    s.index = 7;
    s.count = 99;
    s.extra = 'dropped';
    s.topName = 'LGTT see https://evil.example/x and www.evil.example';
    s.checkpoints[0] = 'mail me@evil.example\u0000<img src=x onerror=alert(1)>';
    s.checkpoints.push('ninth', 'tenth');
    s.legs.push(s.legs[0], s.legs[0]);
    s.header.aircraft = 'X'.repeat(5000);
    s.terminal = Array.from({ length: 100 }, () => ({ field: 'LGTT', elev: '1', rwy: '', units: [], href: 'x' }));
    s.legs[1] = { ...s.legs[1], tc: 7, altMissing: 'yes' };
    const r = await send(owner, { sheets: Array.from({ length: 50 }, () => s) });
    expect(r.status).toBe(200);
    const [c] = printed;
    expect(c.sheets).toHaveLength(30);
    const p = c.sheets[3];
    expect(p).toMatchObject({ index: 3, count: 30, topName: 'LGTT see and' });
    expect(p).not.toHaveProperty('extra');
    expect(p.checkpoints).toHaveLength(8);
    expect(p.checkpoints[0]).toBe('mail <img src=x onerror=alert(1)>');
    expect(p.legs).toHaveLength(9);
    expect(p.legs[1]).toMatchObject({ tc: '7', altMissing: false });
    expect(p.header.aircraft.length).toBeLessThanOrEqual(40);
    expect(p.terminal).toHaveLength(24);
    expect(p.terminal[0]).not.toHaveProperty('href');
  });
});

describe('the sending caps', () => {
  test('a minute between two sends of a flight, at most MAIL_FLIGHT_FORM_CAP a day', async () => {
    expect((await send(owner)).status).toBe(200);
    const again = await send(owner);
    expect(again.status).toBe(429);
    expect((again.body as any).error).toMatch(/less than a minute ago/);
    for (let i = 1; i < MAIL_FLIGHT_FORM_CAP; i++) {
      await later();
      expect((await send(owner)).status).toBe(200);
    }
    await later();
    const over = await send(owner);
    expect(over.status).toBe(429);
    expect((over.body as any).error).toMatch(new RegExp(`${MAIL_FLIGHT_FORM_CAP} times`));
    expect(sent).toHaveLength(MAIL_FLIGHT_FORM_CAP);
    // over a cap: nothing printed
    expect(printed).toHaveLength(MAIL_FLIGHT_FORM_CAP);
    const rows = await (await db()).query(`SELECT result FROM mail_log WHERE flight_id = $1 ORDER BY at`, [flightId]);
    expect(rows.filter((x) => x.result === 'capped')).toHaveLength(2);
  });
});

describe('failures', () => {
  test('the print fails: 502 with the reason, nothing sent, the failure in the mail log and app_errors', async () => {
    print = async () => {
      throw new Error('Chromium did not start');
    };
    const r = await send(owner);
    expect(r.status).toBe(502);
    expect((r.body as any).error).toBe('The navlog could not be printed: Chromium did not start');
    expect(sent).toEqual([]);
    const d = await db();
    const [row] = await d.query(`SELECT * FROM mail_log WHERE flight_id = $1`, [flightId]);
    expect(row).toMatchObject({ form: 'navlog', result: 'failed', error: 'Chromium did not start' });
    const [err] = await d.query(`SELECT * FROM app_errors WHERE message LIKE '%navlog could not be printed%'`);
    expect(err).toMatchObject({ kind: 'server', route: '/api/flights/:id/exports/navlog/email' });
    // a failed send does not count: no pause before the next
    print = async () => Buffer.from('%PDF-1.7 navlog');
    expect((await send(owner)).status).toBe(200);
  });

  test('the mail provider fails: 502, recorded as failed', async () => {
    setMailTransport(async () => {
      throw new Error('provider down');
    });
    const r = await send(owner);
    expect(r.status).toBe(502);
    const [row] = await (await db()).query(`SELECT * FROM mail_log WHERE flight_id = $1`, [flightId]);
    expect(row).toMatchObject({ result: 'failed', error: 'provider down' });
    expect((await owner.call<NavlogMailState>('GET', path())).body.sent).toBeNull();
  });
});
