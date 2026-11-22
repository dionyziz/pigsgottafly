// A passenger corrects their own details on the Form 731 signing page (PUT /sign/:token/details,
// api/_lib/routes/forms.ts): the pilot's passenger record and the flight's manifest change, the form
// is a new version (earlier signatures no longer count), and the pilot's "signed" e-mail lists what
// changed and who has to sign again. The mail transport is MOCKED: nothing is sent for real.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import aerodromes from '../../src/data/ref/aerodromes.json';
import type { FormsState, SigningView } from '../../src/shared/forms';
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
let A: Client, anon: Client;
let sent: SentMail[] = [];

beforeAll(async () => {
  api = await startApi({ allowedEmails: ['pilot.a@example.com'] });
  A = client(api.base);
  anon = client(api.base);
  expect((await A.login('sa', 'pilot.a@example.com')).status).toBe(200);
  await A.call('PUT', 'me', { fullName: 'Pat Pilot', phone: '+30 690 000 0001', idNumber: 'AK123456', idType: 'ID' });
});
afterAll(() => api.close());
afterEach(() => setMailTransport(null));
const mockMail = () => {
  sent = [];
  setMailTransport(async (m) => {
    sent.push(m);
    return { id: `m-${sent.length}` };
  });
};

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

/** A flight with Maria and Nikos (saved passengers) and Xavier (no record), each with a signing link. */
async function setup() {
  const maria = (
    await A.call('POST', 'passengers', {
      fullName: 'Maria Papadopoulou',
      phone: '+30 690 111 2233',
      idNumber: 'AB987654',
      email: 'maria@example.com',
    })
  ).body;
  const nikos = (
    await A.call('POST', 'passengers', {
      fullName: 'Nikos Nikolaou',
      phone: '+30 690 444 5566',
      idNumber: 'XY112233',
      email: 'nikos@example.com',
    })
  ).body;
  const f = (
    await A.call('POST', 'flights', {
      title: 'Milos trip',
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
          // the pilot typed her phone on this flight: her correction wins and it follows her record again
          overrides: ['phone', 'weightKg'],
        },
        { role: 'PAX', passengerId: nikos.id, seat: 'rear-left', snapshot: snap('Nikos Nikolaou', '', '') },
        { role: 'PAX', passengerId: null, seat: 'rear-right', snapshot: snap('Xavier X', 'XX111111', '+30 690 9') },
      ],
    })
  ).body;
  expect(f.id).toBeTruthy();
  const links = (await A.call<FormsState>('POST', `flights/${f.id}/forms/731/links`)).body.links!;
  return {
    flightId: f.id as string,
    maria: maria.id as string,
    nikos: nikos.id as string,
    tMaria: links[maria.id],
    tNikos: links[nikos.id],
    tXavier: links['seat:rear-right'],
  };
}
const forms = async (id: string) => (await A.call<FormsState>('GET', `flights/${id}/forms`)).body;
const details = (token: string, body: unknown) => anon.call<SigningView>('PUT', `sign/${token}/details`, body);
const row = (v: SigningView, key: string) => v.content.people.find((p) => p.key === key)!;

describe('a passenger corrects their own details before signing', () => {
  test('their record, the manifest and the form change; only they see their row in full', async () => {
    const s = await setup();
    const before = (await A.call('GET', `flights/${s.flightId}`)).body;
    const r = await details(s.tMaria, {
      fullName: '  Maria   Papadopoulou-Smith ',
      idNumber: 'AB000111',
      phone: '+30 690 111 9999',
    });
    expect(r.status).toBe(200);
    expect(row(r.body, s.maria)).toMatchObject({
      name: 'Maria Papadopoulou-Smith',
      idPassport: 'AB000111',
      contact: '+30 690 111 9999',
    });
    expect(row(r.body, s.nikos).contact).not.toContain('444');

    const rec = (await A.call('GET', `passengers/${s.maria}`)).body;
    expect(rec).toMatchObject({
      fullName: 'Maria Papadopoulou-Smith',
      idNumber: 'AB000111',
      phone: '+30 690 111 9999',
    });
    expect(rec.email).toBe('maria@example.com');
    const fl = (await A.call('GET', `flights/${s.flightId}`)).body;
    expect(fl.version).toBe(before.version + 1);
    const crew = fl.crew.find((c: any) => c.passengerId === s.maria);
    expect(crew.snapshot).toMatchObject({ fullName: 'Maria Papadopoulou-Smith', idNumber: 'AB000111', weightKg: 70 });
    expect(crew.overrides).toEqual(['weightKg']);

    const st = await forms(s.flightId);
    expect(st.form731.content.people.find((p) => p.key === s.maria)).toMatchObject({
      name: 'Maria Papadopoulou-Smith',
      idPassport: 'AB000111',
      contact: '+30 690 111 9999',
    });
    // Nikos's own empty snapshot fields still come from his record, untouched
    expect(st.form731.content.people.find((p) => p.key === s.nikos)!.idPassport).toBe('XY112233');
    expect((await anon.call('GET', `sign/${s.tMaria}`)).status).toBe(200);
  });

  test('a passenger without a saved record: the manifest changes and their link still works', async () => {
    const s = await setup();
    const r = await details(s.tXavier, { fullName: 'Xavier Xenos', idNumber: 'XX222222', phone: '+30 690 9' });
    expect(r.status).toBe(200);
    expect(row(r.body, 'seat:rear-right').name).toBe('Xavier Xenos');
    expect((await anon.call('GET', `sign/${s.tXavier}`)).status).toBe(200);
    expect((await anon.call('POST', `sign/${s.tXavier}`)).status).toBe(200);
    const st = await forms(s.flightId);
    expect(st.form731.signatures.find((x) => x.key === 'seat:rear-right')).toMatchObject({
      name: 'Xavier Xenos',
      signed: true,
    });
  });

  test('only their own row; invalid input 400; revoked and expired links refused; rate-limited per link', async () => {
    const s = await setup();
    for (const body of [
      { fullName: 'Nikos Hacked', key: s.nikos },
      { passengerId: s.nikos, fullName: 'X' },
      { email: 'evil@example.com' },
      { weightKg: 1 },
    ])
      expect((await details(s.tMaria, body)).status).toBe(400);
    expect((await details(s.tMaria, { fullName: '   ' })).status).toBe(400);
    expect((await details(s.tMaria, { fullName: 'x'.repeat(201) })).status).toBe(400);
    expect((await details(s.tMaria, { idNumber: 'x'.repeat(51) })).status).toBe(400);
    expect((await details(s.tMaria, { phone: 42 })).status).toBe(400);
    expect((await anon.call('PUT', `sign/${s.tMaria}/details`, [1, 2])).status).toBe(400);
    expect((await A.call('GET', `passengers/${s.nikos}`)).body.fullName).toBe('Nikos Nikolaou');
    expect((await A.call('GET', `passengers/${s.maria}`)).body.fullName).toBe('Maria Papadopoulou');

    expect((await details('not-a-token-at-all-xxxxxxxxxxxxxxx', { fullName: 'X' })).status).toBe(404);
    await A.call('POST', `flights/${s.flightId}/forms/731/links/${s.nikos}/revoke`);
    expect((await details(s.tNikos, { fullName: 'Nikos N' })).status).toBe(404);
    expect((await A.call('GET', `passengers/${s.nikos}`)).body.fullName).toBe('Nikos Nikolaou');
    const db = (await api.server.ready).db;
    await db.query('UPDATE form_links SET expires = 1 WHERE flight_id = $1 AND person_key = $2', [
      s.flightId,
      'seat:rear-right',
    ]);
    expect((await details(s.tXavier, { fullName: 'Xavier Y' })).status).toBe(410);

    let last = 0;
    for (let i = 0; i < 25 && last !== 429; i++)
      last = (await details(s.tMaria, { phone: `+30 690 000 ${String(i).padStart(4, '0')}` })).status;
    expect(last).toBe(429);
  });

  test('signing after a correction tells the pilot what changed and whose signatures must be given again', async () => {
    mockMail();
    const s = await setup();
    await anon.call('POST', `sign/${s.tNikos}`);
    expect(sent).toHaveLength(1);
    sent = [];

    await details(s.tMaria, { fullName: 'Maria Smith', idNumber: 'AB987654', phone: '+30 690 111 2233' });
    expect(sent).toHaveLength(0); // the e-mail goes with the signature
    let st = await forms(s.flightId);
    expect(st.form731.signatures.find((x) => x.key === s.nikos)).toMatchObject({ signed: false, needsResign: true });
    expect(st.form731.signatures.find((x) => x.role === 'PIC')!.signed).toBe(true);

    const v = (await anon.call<SigningView>('POST', `sign/${s.tMaria}`)).body;
    expect(v.signatures.find((x) => x.key === s.maria)!.signedAt).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Form 731 signed by Maria Smith (details changed)');
    expect(sent[0].text).toContain('Maria Smith changed their details:\n  Name: Maria Papadopoulou → Maria Smith');
    expect(sent[0].text).not.toContain('Phone:');
    expect(sent[0].text).toContain('These signatures need to be given again: Nikos Nikolaou.');
    expect(sent[0].text).toMatch(/2 of 4 signed/);

    // reported once: Nikos signs again, then the next signature is plain news
    await anon.call('POST', `sign/${s.tNikos}`);
    expect(sent[1].subject).toBe('Form 731 signed by Nikos Nikolaou');
    expect(sent[1].text).not.toContain('changed their details');
    st = await forms(s.flightId);
    expect(st.form731.signatures.find((x) => x.key === s.maria)!.signed).toBe(true);
  });

  test('corrections accumulate (first value → latest); a field back where it began and a no-op are not reported', async () => {
    mockMail();
    const s = await setup();
    const base = { fullName: 'Maria Papadopoulou', idNumber: 'AB987654', phone: '+30 690 111 2233' };
    await details(s.tMaria, { ...base, phone: '+30 690 1' });
    await details(s.tMaria, { ...base, phone: '+30 690 2', idNumber: 'AB0' });
    await details(s.tMaria, { ...base, phone: '+30 690 3', idNumber: 'AB987654' });
    expect(sent).toHaveLength(0);
    await anon.call('POST', `sign/${s.tMaria}`);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('  Phone: +30 690 111 2233 → +30 690 3');
    expect(sent[0].text).not.toContain('ID / passport number');
    expect(sent[0].text).not.toContain('need to be given again');

    // the same details again change nothing: the form version and the signature stand, no e-mail
    const v = (await details(s.tNikos, { fullName: 'Nikos Nikolaou', idNumber: 'XY112233', phone: '+30 690 444 5566' }))
      .body;
    expect(v.signatures.find((x) => x.key === s.maria)!.signedAt).toBeGreaterThan(0);
    // a phone changed and changed back is no change either
    await details(s.tNikos, { phone: '+30 690 7' });
    await details(s.tNikos, { phone: '+30 690 444 5566' });
    await anon.call('POST', `sign/${s.tNikos}`);
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toBe('Form 731 signed by Nikos Nikolaou');
    expect(sent[1].text).not.toContain('changed their details');
    expect(sent[1].text).toMatch(/3 of 4 signed/);
  });

  test('signing without corrections: the plain e-mail', async () => {
    mockMail();
    const s = await setup();
    await anon.call('POST', `sign/${s.tMaria}`);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Form 731 signed by Maria Papadopoulou');
    expect(sent[0].text).not.toContain('changed their details');
    expect(sent[0].text).not.toContain('need to be given again');
  });
});
