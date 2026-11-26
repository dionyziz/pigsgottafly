// A passenger's e-mail address (migration 045) and Form 731 e-mailed to each passenger
// (POST /flights/:id/forms/731/email/:key, api/_lib/routes/forms.ts): the PDF and a new signing
// link, cc and reply-to the pilot, logged in mail_log as '731-pax' and capped per recipient.
// The mail transport is MOCKED: nothing is sent for real.
import zlib from 'node:zlib';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { AERODROMES as aerodromes } from '../../src/data/ref';
import type { FormsState } from '../../src/shared/forms';
import type { RefAerodrome } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import { type Client, client, startApi } from './helpers';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);

let api: Awaited<ReturnType<typeof startApi>>;
let A: Client, B: Client, anon: Client;
const sent: SentMail[] = [];
const db = async () => (await api.server.ready).db;

beforeAll(async () => {
  api = await startApi({ allowedEmails: ['pilot.a@example.com', 'pilot.b@example.com'] });
  A = client(api.base);
  B = client(api.base);
  anon = client(api.base);
  expect((await A.login('sa', 'pilot.a@example.com')).status).toBe(200);
  expect((await B.login('sb', 'pilot.b@example.com')).status).toBe(200);
  await A.call('PUT', 'me', { fullName: 'Pat Pilot', phone: '+30 690 000 0001', idNumber: 'AK123456', idType: 'ID' });
});
afterAll(() => api.close());
afterEach(() => setMailTransport(null));
const mockMail = (fail = false) =>
  setMailTransport(async (m) => {
    if (fail) throw new Error('provider down');
    sent.push(m);
    return { id: `m-${sent.length}` };
  });

const snap = (fullName: string, idNumber: string, phone: string) => ({
  fullName,
  phone,
  dateOfBirth: null,
  weightKg: 70,
  idNumber,
  idType: 'ID',
  nationality: '',
  relation: '',
});

async function setup() {
  const maria = (
    await A.call('POST', 'passengers', {
      fullName: 'Maria Papadopoulou',
      phone: '+30 690 111 2233',
      idNumber: 'AB987654',
      idType: 'ID',
      email: 'maria@example.com',
    })
  ).body;
  const nikos = (
    await A.call('POST', 'passengers', {
      fullName: 'Nikos Nikolaou',
      phone: '+30 690 444 5566',
      idNumber: 'XY112233',
      idType: 'ID',
      email: 'nikos@example.com',
    })
  ).body;
  const eleni = (
    await A.call('POST', 'passengers', { fullName: 'Eleni Noemail', phone: '+30 690 777', idNumber: 'EE1' })
  ).body;
  const f = (
    await A.call('POST', 'flights', {
      date: tomorrow,
      blockOff: '08:00',
      route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      crew: [
        { role: 'PIC', passengerId: null, seat: 'front-left', snapshot: snap('', '', '') },
        {
          role: 'PAX',
          passengerId: maria.id,
          seat: 'front-right',
          snapshot: snap('Maria Papadopoulou', 'AB987654', '+30 690 111 2233'),
        },
        {
          role: 'PAX',
          passengerId: nikos.id,
          seat: 'rear-left',
          snapshot: snap('Nikos Nikolaou', 'XY112233', '+30 690 444 5566'),
        },
        {
          role: 'PAX',
          passengerId: eleni.id,
          seat: 'rear-right',
          snapshot: snap('Eleni Noemail', 'EE1', '+30 690 777'),
        },
      ],
    })
  ).body;
  expect(f.id).toBeTruthy();
  return { flightId: f.id as string, maria: maria.id as string, nikos: nikos.id as string, eleni: eleni.id as string };
}
const email = (c: Client, flightId: string, key: string) =>
  c.call<FormsState>('POST', `flights/${flightId}/forms/731/email/${encodeURIComponent(key)}`);

describe('a passenger’s e-mail address', () => {
  test('saved, checked, cleared; passengers from before migration 045 have none', async () => {
    const p = (await A.call('POST', 'passengers', { fullName: 'Kostas K', email: ' kostas@example.com ' })).body;
    expect(p.email).toBe('kostas@example.com');
    expect((await A.call('POST', 'passengers', { fullName: 'Bad', email: 'not-an-address' })).status).toBe(400);
    expect((await A.call('PUT', `passengers/${p.id}`, { phone: '+30' })).body.email).toBe('kostas@example.com');
    expect((await A.call('PUT', `passengers/${p.id}`, { email: '' })).body.email).toBe('');
    const [row] = await (await db()).query('SELECT email FROM passengers WHERE id = $1', [p.id]);
    expect(row.email).toBeNull();
    // an old row (NULL) is still a valid passenger, just without an address
    const old = (await A.call('POST', 'passengers', { fullName: 'Old Timer' })).body;
    expect(old.email).toBe('');
    expect((await A.call('GET', `passengers/${old.id}`)).status).toBe(200);
  });
});

describe('Form 731 e-mailed to a passenger', () => {
  test('the PDF and a working signing link, to the passenger, cc and reply-to the pilot; logged; shown as e-mailed', async () => {
    mockMail();
    const { flightId, maria } = await setup();
    const before = (await A.call<FormsState>('GET', `flights/${flightId}/forms`)).body;
    const m0 = before.form731.signatures.find((s) => s.key === maria)!;
    expect(m0).toMatchObject({ email: 'maria@example.com', emailedAt: null });
    expect(before.form731.signatures.find((s) => s.role === 'PIC')!.email).toBe('');

    const n = sent.length;
    const r = await email(A, flightId, maria);
    expect(r.status).toBe(200);
    expect(sent.length - n).toBe(1);
    const m = sent[n];
    expect(m.to).toEqual(['maria@example.com']);
    expect(m.cc).toEqual(['pilot.a@example.com']);
    expect(m.replyTo).toBe('pilot.a@example.com');
    expect(m.subject).toMatch(/^Form 731/);
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments![0].contentType).toBe('application/pdf');
    expect(m.attachments![0].content.subarray(0, 5).toString()).toBe('%PDF-');
    // their own row in full; other people's ID and phone masked, as on the signing page
    const text = pdfText(m.attachments![0].content);
    expect(text).toContain('AB987654');
    expect(text).toContain('Nikos Nikolaou');
    expect(text).not.toContain('XY112233');
    expect(text).not.toContain('AK123456');
    const token = /\/sign\/([A-Za-z0-9_-]+)/.exec(m.text)![1];
    expect(m.text).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sign\//m);
    // the link opens the passenger's own view and signs
    const view = (await anon.call('GET', `sign/${token}`)).body;
    expect(view.me).toBe(maria);
    expect((await anon.call('POST', `sign/${token}`)).status).toBe(200);

    const st = r.body.form731.signatures.find((s) => s.key === maria)!;
    expect(st.emailedAt).toBeGreaterThan(0);
    expect(st.link).toMatchObject({ revoked: false });
    const log = await (
      await db()
    ).query(`SELECT form, recipient, result, message_id FROM mail_log WHERE flight_id = $1 ORDER BY at`, [flightId]);
    expect(log).toEqual([{ form: '731-pax', recipient: 'maria@example.com', result: 'sent', message_id: 'm-1' }]);
    // her signature is news to the pilot
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toMatch(/^Form 731 signed by /);
  });

  test('capped per recipient: the same passenger again waits 10 minutes, another passenger does not', async () => {
    mockMail();
    const { flightId, maria, nikos } = await setup();
    expect((await email(A, flightId, maria)).status).toBe(200);
    const again = await email(A, flightId, maria);
    expect(again.status).toBe(429);
    expect((again.body as unknown as { error: string }).error).toMatch(/maria@example\.com/);
    expect((await email(A, flightId, nikos)).status).toBe(200);
    const results = (
      await (await db()).query(`SELECT result FROM mail_log WHERE flight_id = $1 ORDER BY at`, [flightId])
    ).map((x) => x.result);
    expect(results).toEqual(['sent', 'capped', 'sent']);
  });

  test('no address: 409; not a passenger: 404; another pilot: 404; a failed send is logged and does not count', async () => {
    mockMail();
    const { flightId, maria, eleni } = await setup();
    const n = sent.length;
    expect((await email(A, flightId, eleni)).status).toBe(409);
    expect((await email(A, flightId, 'PIC')).status).toBe(404);
    expect((await email(A, flightId, 'nobody')).status).toBe(404);
    expect((await email(B, flightId, maria)).status).toBe(404);
    expect((await email(anon, flightId, maria)).status).toBe(401);
    expect(sent.length - n).toBe(0);

    mockMail(true);
    expect((await email(A, flightId, maria)).status).toBe(502);
    const [row] = await (await db()).query(`SELECT result, error FROM mail_log WHERE flight_id = $1`, [flightId]);
    expect(row).toEqual({ result: 'failed', error: 'provider down' });
    expect(
      (await A.call<FormsState>('GET', `flights/${flightId}/forms`)).body.form731.signatures.find(
        (s) => s.key === maria,
      )!.emailedAt,
    ).toBeNull();
    // the failure does not hold the next try back
    mockMail();
    expect((await email(A, flightId, maria)).status).toBe(200);
  });
});

/** Text shown by the PDF's content streams (inflated), as in forms.test.ts. */
function pdfText(pdf: Buffer): string {
  const s = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of s.matchAll(/stream\n/g)) {
    const begin = m.index + m[0].length;
    try {
      const raw = zlib.inflateSync(pdf.subarray(begin, s.indexOf('\nendstream', begin))).toString('latin1');
      for (const t of raw.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) out.push(t[1]);
    } catch {
      /* the font stream */
    }
  }
  return out.join('\n');
}
