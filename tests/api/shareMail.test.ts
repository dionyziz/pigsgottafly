// The e-mail to someone an aircraft or an operator is shared with (api/_lib/shareMail.ts): who shared
// what, the access and a link that opens it, reply-to the sharer, logged in mail_log as
// 'share-aircraft' / 'share-operator' and capped; a failed or capped e-mail never fails the share.
// The mail transport is MOCKED: nothing is sent for real.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { MAIL_DAILY_CAP, MAIL_RECIPIENT_CAP } from '../../api/_lib/sendCaps';
import { shareMail } from '../../api/_lib/shareMail';
import { blankAircraft } from '../../src/shared/templates';
import { type Client, client, startApi } from './helpers';

let api: Awaited<ReturnType<typeof startApi>>;
let A: Client, B: Client, C: Client;
const ids: Record<string, string> = {};
const sent: SentMail[] = [];
const db = async () => (await api.server.ready).db;
const origin = () => api.base.replace(/\/api\/$/, '');

beforeAll(async () => {
  api = await startApi();
  A = client(api.base);
  B = client(api.base);
  C = client(api.base);
  for (const [c, sub, email] of [
    [A, 'a', 'pat@example.com'],
    [B, 'b', 'Bob@Example.com'],
    [C, 'c', 'carol@example.com'],
  ] as const) {
    expect((await c.login(`sub-${sub}`, email)).status).toBe(200);
    ids[sub] = (await c.call('GET', 'me')).body.id;
  }
  await A.call('PUT', 'me', { fullName: 'Pat Pilot' });
});
afterAll(() => api.close());
afterEach(async () => {
  setMailTransport(null);
  sent.length = 0;
  await (await db()).query('DELETE FROM mail_log');
});
const mockMail = (fail = false) =>
  setMailTransport(async (m) => {
    if (fail) throw new Error('provider down');
    sent.push(m);
    return { id: `m-${sent.length}` };
  });

async function newAircraft(reg: string) {
  const ac = blankAircraft();
  ac.registration = reg;
  ac.makeModel = 'Cessna 172';
  ac.icaoType = 'C172';
  const r = await A.call('POST', 'aircraft', ac);
  expect(r.status).toBe(201);
  return r.body.id as string;
}
const log = async (form: string) =>
  (
    await (
      await db()
    ).query(
      `SELECT pilot_id, flight_id, recipient, subject, result, message_id, error FROM mail_log WHERE form = $1 ORDER BY at`,
      [form],
    )
  ).map((r) => ({ ...r }));

describe('sharing an aircraft e-mails the person', () => {
  test('recipient, content, link and log', async () => {
    mockMail();
    const id = await newAircraft('SX-SHM');
    const r = await A.call('POST', `aircraft/${id}/shares`, { email: 'bob@example.com', role: 'edit' });
    expect(r.status).toBe(201);
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.to).toEqual(['Bob@Example.com']);
    expect(m.cc ?? []).toEqual([]);
    expect(m.replyTo).toBe('pat@example.com');
    expect(m.subject).toBe('Pat Pilot shared the aircraft SX-SHM with you');
    expect(m.text).toContain('Pat Pilot (pat@example.com) shared the aircraft SX-SHM (Cessna 172, C172) with you');
    expect(m.text).toContain('You can view and edit it.');
    expect(m.text).toContain(`${origin()}/hangar/${id}`);
    expect(await log('share-aircraft')).toEqual([
      {
        pilot_id: ids.a,
        flight_id: null,
        recipient: 'Bob@Example.com',
        subject: m.subject,
        result: 'sent',
        message_id: 'm-1',
        error: null,
      },
    ]);
  });

  test('a viewer is told they can view it', async () => {
    mockMail();
    const id = await newAircraft('SX-SHV');
    expect((await A.call('POST', `aircraft/${id}/shares`, { email: 'carol@example.com', role: 'view' })).status).toBe(
      201,
    );
    expect(sent[0].text).toContain('You can view it.');
    expect(sent[0].text).not.toContain('edit');
  });

  test('no e-mail when the share is refused, or for a role change', async () => {
    mockMail();
    const id = await newAircraft('SX-SHR');
    expect((await A.call('POST', `aircraft/${id}/shares`, { email: 'nobody@example.com', role: 'view' })).status).toBe(
      404,
    );
    expect((await A.call('POST', `aircraft/${id}/shares`, { email: 'bob@example.com', role: 'view' })).status).toBe(
      201,
    );
    expect((await A.call('POST', `aircraft/${id}/shares`, { email: 'bob@example.com', role: 'view' })).status).toBe(
      409,
    );
    expect((await A.call('PUT', `aircraft/${id}/shares/${ids.b}`, { role: 'edit' })).status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  test('a failed e-mail does not fail the share; the log keeps why', async () => {
    mockMail(true);
    const id = await newAircraft('SX-SHF');
    const r = await A.call('POST', `aircraft/${id}/shares`, { email: 'bob@example.com', role: 'edit' });
    expect(r.status).toBe(201);
    expect(r.body.people.map((p: { pilotId: string }) => p.pilotId)).toContain(ids.b);
    expect((await B.call('GET', `aircraft/${id}`)).status).toBe(200);
    const [row] = await log('share-aircraft');
    expect(row.result).toBe('failed');
    expect(row.error).toBe('provider down');
  });

  test('without e-mail configured the share still works and nothing is logged', async () => {
    const id = await newAircraft('SX-SHN');
    expect((await A.call('POST', `aircraft/${id}/shares`, { email: 'bob@example.com', role: 'view' })).status).toBe(
      201,
    );
    expect(await log('share-aircraft')).toEqual([]);
  });

  test('capped per recipient: the share stands, the e-mail is logged as capped', async () => {
    mockMail();
    const q = await db();
    const now = Date.now();
    for (let i = 0; i < MAIL_RECIPIENT_CAP; i++)
      await q.query(
        `INSERT INTO mail_log (id, pilot_id, flight_id, form, at, recipient, subject, result) VALUES ($1,$2,NULL,'share-aircraft',$3,'bob@example.com','x','sent')`,
        [`ml-cap-${i}`, ids.a, now - 1000 - i],
      );
    const id = await newAircraft('SX-SHC');
    expect((await A.call('POST', `aircraft/${id}/shares`, { email: 'bob@example.com', role: 'view' })).status).toBe(
      201,
    );
    expect(sent).toHaveLength(0);
    const rows = await log('share-aircraft');
    expect(rows.at(-1)!.result).toBe('capped');
  });

  test('share notices and the forms are counted apart', async () => {
    mockMail();
    const q = await db();
    const now = Date.now();
    // a day's worth of forms does not stop the share notices
    for (let i = 0; i < MAIL_DAILY_CAP; i++)
      await q.query(
        `INSERT INTO mail_log (id, pilot_id, flight_id, form, at, recipient, subject, result) VALUES ($1,$2,NULL,'wbperf',$3,$4,'x','sent')`,
        [`ml-f-${i}`, ids.a, now - 1000 - i, `ops${i}@example.com`],
      );
    const id = await newAircraft('SX-SHD');
    expect((await A.call('POST', `aircraft/${id}/shares`, { email: 'bob@example.com', role: 'view' })).status).toBe(
      201,
    );
    expect(sent).toHaveLength(1);
  });
});

describe('sharing an operator e-mails the person', () => {
  test('recipient, content, link and log', async () => {
    mockMail();
    const op = (await A.call('POST', 'operators', { name: 'Aeroclub of Athens' })).body;
    const r = await A.call('POST', `operators/${op.id}/shares`, { email: 'carol@example.com', role: 'view' });
    expect(r.status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['carol@example.com']);
    expect(sent[0].replyTo).toBe('pat@example.com');
    expect(sent[0].subject).toBe('Pat Pilot shared the operator Aeroclub of Athens with you');
    expect(sent[0].text).toContain('You can view it.');
    expect(sent[0].text).toContain(`${origin()}/operators/${op.id}`);
    const [row] = await log('share-operator');
    expect(row).toMatchObject({ pilot_id: ids.a, recipient: 'carol@example.com', result: 'sent' });
  });

  test('a failed e-mail does not fail the share', async () => {
    mockMail(true);
    const op = (await A.call('POST', 'operators', { name: 'Failing Ops' })).body;
    expect((await A.call('POST', `operators/${op.id}/shares`, { email: 'bob@example.com', role: 'edit' })).status).toBe(
      201,
    );
    expect((await B.call('GET', `operators/${op.id}`)).status).toBe(200);
    expect((await log('share-operator'))[0].result).toBe('failed');
  });
});

describe('the notice text', () => {
  test('falls back to the Google name, then the address; one line per value', () => {
    const n = { kind: 'aircraft' as const, id: 'ac 1', name: 'SX-ABC\nx', role: 'view' as const, to: 'b@x.com' };
    expect(shareMail({ fullName: '', name: 'Pat G', email: 'p@x.com' }, n, 'https://h').subject).toBe(
      'Pat G shared the aircraft SX-ABC x with you',
    );
    const m = shareMail({ fullName: '', name: '', email: 'p@x.com' }, n, 'https://h');
    expect(m.subject).toBe('p@x.com shared the aircraft SX-ABC x with you');
    expect(m.text).toContain('p@x.com shared the aircraft');
    expect(m.text).not.toContain('(p@x.com)');
    expect(m.text).toContain('https://h/hangar/ac%201');
  });
});
