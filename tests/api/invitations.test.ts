// Inviting pilots to the app (api/_lib/routes/invitations.ts, migration 055): an invitation with
// aircraft the inviter may share, listed and cancelled whole or per aircraft (also from the aircraft's
// sharing); accepted on the Google or Apple sign-in with that address, which shares the aircraft; an
// address with an account gets the aircraft at once; the e-mail, its caps and the rate limit; an
// invitation admits its address past ALLOWED_EMAILS. The mail transport is MOCKED.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { MAIL_RECIPIENT_CAP } from '../../api/_lib/sendCaps';
import { inviteMail } from '../../api/_lib/shareMail';
import type { AircraftSharing, HangarAircraft, InviteResponse, PilotInvitation } from '../../src/shared';
import { blankAircraft } from '../../src/shared/templates';
import { appleClaims, type Client, client, signToken, startApi } from './helpers';

let api: Awaited<ReturnType<typeof startApi>>;
let owner: Client, editor: Client, viewer: Client, other: Client;
const ids: Record<string, string> = {};
const sent: SentMail[] = [];
const db = async () => (await api.server.ready).db;
const origin = () => api.base.replace(/\/api\/$/, '');
const mockMail = () =>
  setMailTransport(async (m) => {
    sent.push(m);
    return { id: `m-${sent.length}` };
  });

beforeAll(async () => {
  api = await startApi({ apple: true });
  owner = client(api.base);
  editor = client(api.base);
  viewer = client(api.base);
  other = client(api.base);
  for (const [c, sub, email] of [
    [owner, 'o', 'Olga@Example.com'],
    [editor, 'e', 'editor@example.com'],
    [viewer, 'v', 'viewer@example.com'],
    [other, 'x', 'other@example.com'],
  ] as const) {
    expect((await c.login(`sub-${sub}`, email)).status).toBe(200);
    ids[sub] = (await c.call('GET', 'me')).body.id;
  }
  await owner.call('PUT', 'me', { fullName: 'Olga Owner' });
});
afterAll(() => api.close());
afterEach(async () => {
  setMailTransport(null);
  sent.length = 0;
  const q = await db();
  await q.query('DELETE FROM mail_log');
  await q.query('DELETE FROM rate_limits');
});

async function newAircraft(c: Client, reg: string) {
  const ac = blankAircraft();
  ac.registration = reg;
  ac.makeModel = 'Cessna 172';
  ac.icaoType = 'C172';
  const r = await c.call('POST', 'aircraft', ac);
  expect(r.status).toBe(201);
  return r.body.id as string;
}
const invite = (c: Client, email: string, aircraft: [string, 'view' | 'edit'][] = [], message?: string) =>
  c.call<InviteResponse>('POST', 'invitations', {
    email,
    message,
    aircraft: aircraft.map(([aircraftId, role]) => ({ aircraftId, role })),
  });
const list = async (c: Client) => (await c.call<PilotInvitation[]>('GET', 'invitations')).body;
const hangar = async (c: Client) =>
  (await c.call<HangarAircraft[]>('GET', 'aircraft')).body.map((a) => [a.registration, a.access.role]);
const pending = async (c: Client, acId: string) =>
  (await c.call<AircraftSharing>('GET', `aircraft/${acId}/shares`)).body.people
    .filter((p) => p.pending)
    .map((p) => [p.email, p.role]);

describe('the invitation e-mail (pure)', () => {
  const by = { fullName: 'Olga Owner', name: '', email: 'olga@example.com' };
  test('who invited, the note, the aircraft and how to sign in', () => {
    const m = inviteMail(
      by,
      {
        to: 'new@example.com',
        message: 'Come fly\nwith me',
        aircraft: [
          { registration: 'SX-AAA', detail: 'Cessna 172, C172', role: 'view' },
          { registration: 'SX-BBB', role: 'edit' },
        ],
      },
      'https://pgf.test',
    );
    expect(m.subject).toBe("Olga Owner invited you to Pig's Gotta Fly");
    expect(m.text).toBe(
      [
        "Olga Owner (olga@example.com) invited you to Pig's Gotta Fly and shared 2 aircraft with you.",
        '',
        'Come fly with me',
        '',
        '- SX-AAA (Cessna 172, C172): you can view it',
        '- SX-BBB: you can view and edit it',
        '',
        "To accept, sign in with Google or Apple using this e-mail address (new@example.com). Pig's Gotta Fly is free; signing in creates your account.",
        '',
        'https://pgf.test/hangar',
      ].join('\n'),
    );
  });
  test('without aircraft or note; an existing account is told what was shared', () => {
    const plain = inviteMail(by, { to: 'n@example.com', message: '', aircraft: [] }, 'https://pgf.test');
    expect(plain.text.split('\n')[0]).toBe("Olga Owner (olga@example.com) invited you to Pig's Gotta Fly.");
    expect(plain.text.endsWith('https://pgf.test/')).toBe(true);
    const ex = inviteMail(
      by,
      { to: 'n@example.com', message: '', existing: true, aircraft: [{ registration: 'SX-AAA', role: 'view' }] },
      'https://pgf.test',
    );
    expect(ex.subject).toBe('Olga Owner shared the aircraft SX-AAA with you');
    expect(ex.text).not.toContain('sign in');
  });
});

describe('inviting a pilot with aircraft', () => {
  let a1: string, a2: string, mine: string;
  beforeAll(async () => {
    a1 = await newAircraft(owner, 'SX-IN1');
    a2 = await newAircraft(owner, 'SX-IN2');
    mine = await newAircraft(other, 'SX-OTH');
    expect(
      (await owner.call('POST', `aircraft/${a1}/shares`, { email: 'editor@example.com', role: 'edit' })).status,
    ).toBe(201);
    expect(
      (await owner.call('POST', `aircraft/${a2}/shares`, { email: 'viewer@example.com', role: 'view' })).status,
    ).toBe(201);
  });

  test('refused: someone else’s aircraft, an aircraft one only views, oneself, a bad address', async () => {
    expect((await invite(owner, 'new@example.com', [[mine, 'view']])).status).toBe(404);
    expect((await invite(viewer, 'new@example.com', [[a2, 'view']])).status).toBe(403);
    expect((await invite(owner, 'olga@example.com')).status).toBe(400);
    expect((await invite(owner, 'not-an-address')).status).toBe(400);
    expect((await invite(owner, 'new@example.com', [[a1, 'admin' as 'view']])).status).toBe(400);
    expect(await list(owner)).toEqual([]);
  });

  test('an invitation with two aircraft: listed, on the aircraft’s sharing, e-mailed', async () => {
    mockMail();
    const r = await invite(
      owner,
      'New.Pilot@Example.com',
      [
        [a2, 'edit'],
        [a1, 'view'],
      ],
      'Join me',
    );
    expect(r.status).toBe(201);
    expect(r.body.existing).toBe(false);
    expect(r.body.invitations).toEqual([
      {
        id: expect.any(String),
        email: 'new.pilot@example.com',
        message: 'Join me',
        created: expect.any(Number),
        aircraft: [
          { aircraftId: a1, registration: 'SX-IN1', role: 'view' },
          { aircraftId: a2, registration: 'SX-IN2', role: 'edit' },
        ],
      },
    ]);
    expect(await list(owner)).toEqual(r.body.invitations);
    expect(await list(editor)).toEqual([]);
    expect(await pending(owner, a1)).toEqual([['new.pilot@example.com', 'view']]);
    expect(await pending(viewer, a2)).toEqual([['new.pilot@example.com', 'edit']]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: ['New.Pilot@Example.com'],
      subject: "Olga Owner invited you to Pig's Gotta Fly",
      replyTo: 'Olga@Example.com',
    });
    expect(sent[0].text).toContain('- SX-IN1 (Cessna 172, C172): you can view it');
    expect(sent[0].text).toContain('- SX-IN2 (Cessna 172, C172): you can view and edit it');
    expect(sent[0].text).toContain('Join me');
    expect(sent[0].text).toContain(`${origin()}/hangar`);
    const [row] = await (await db()).query(`SELECT form, result FROM mail_log`);
    expect(row).toEqual({ form: 'invite', result: 'sent' });
    // again with nothing new: refused
    expect((await invite(owner, 'new.pilot@example.com', [[a1, 'view']])).status).toBe(409);
  });

  test('cancelling one aircraft from the aircraft’s sharing leaves the invitation and the other aircraft', async () => {
    expect((await viewer.call('DELETE', `aircraft/${a1}/shares/new.pilot@example.com`)).status).toBe(404);
    expect((await owner.call('DELETE', `aircraft/${a2}/shares/new.pilot@example.com`)).status).toBe(204);
    expect(await pending(owner, a2)).toEqual([]);
    expect(await pending(owner, a1)).toEqual([['new.pilot@example.com', 'view']]);
    const [inv] = await list(owner);
    expect(inv.aircraft.map((a) => a.registration)).toEqual(['SX-IN1']);
    // the editor of a1 makes the pending share an editor's
    expect(
      (await editor.call('PUT', `aircraft/${a1}/shares/New.Pilot@example.com`, { role: 'edit' })).body.people.at(-1),
    ).toMatchObject({ email: 'new.pilot@example.com', role: 'edit', pending: true });
  });

  test('accepted on the Google sign-in: only the remaining aircraft is shared', async () => {
    const n = client(api.base);
    expect((await n.login('sub-new', 'new.pilot@EXAMPLE.com')).status).toBe(200);
    expect(await hangar(n)).toEqual([['SX-IN1', 'edit']]);
    expect(await list(owner)).toEqual([]);
    expect(await pending(owner, a1)).toEqual([]);
    const s = (await owner.call<AircraftSharing>('GET', `aircraft/${a1}/shares`)).body;
    expect(s.people.map((p) => [p.email, p.role, p.pending ?? false])).toEqual([
      ['Olga@Example.com', 'owner', false],
      ['editor@example.com', 'edit', false],
      ['new.pilot@EXAMPLE.com', 'edit', false],
    ]);
    const [row] = await (
      await db()
    ).query(`SELECT accepted_at FROM pilot_invitations WHERE email = 'new.pilot@example.com'`);
    expect(Number(row.accepted_at)).toBeGreaterThan(0);
  });

  test('an editor invites with the aircraft they edit; accepted on the Apple sign-in', async () => {
    expect((await invite(editor, 'apple.pilot@example.com', [[a1, 'view']])).status).toBe(201);
    const n = client(api.base);
    expect(
      (await n.call('POST', 'login/apple', { idToken: signToken(appleClaims('apple-1', 'Apple.Pilot@example.com')) }))
        .status,
    ).toBe(200);
    expect(await hangar(n)).toEqual([['SX-IN1', 'view']]);
  });

  test('an invitation whose inviter lost the aircraft shares nothing of it', async () => {
    const a3 = await newAircraft(owner, 'SX-IN3');
    await owner.call('POST', `aircraft/${a3}/shares`, { email: 'editor@example.com', role: 'edit' });
    expect((await invite(editor, 'late@example.com', [[a3, 'view']])).status).toBe(201);
    expect((await owner.call('DELETE', `aircraft/${a3}/shares/${ids.e}`)).status).toBe(204);
    const n = client(api.base);
    expect((await n.login('sub-late', 'late@example.com')).status).toBe(200);
    expect(await hangar(n)).toEqual([]);
  });

  test('cancelling an invitation; one aircraft of it by its id', async () => {
    const r = await invite(owner, 'gone@example.com', [
      [a1, 'view'],
      [a2, 'view'],
    ]);
    const id = r.body.invitations[0].id;
    expect((await owner.call('DELETE', `invitations/${id}/aircraft/${a2}`)).status).toBe(204);
    expect((await list(owner))[0].aircraft.map((a) => a.registration)).toEqual(['SX-IN1']);
    expect((await other.call('DELETE', `invitations/${id}`)).status).toBe(404);
    expect((await owner.call('DELETE', `invitations/${id}`)).status).toBe(204);
    expect(await list(owner)).toEqual([]);
    expect(await pending(owner, a1)).toEqual([]);
    const n = client(api.base);
    expect((await n.login('sub-gone', 'gone@example.com')).status).toBe(200);
    expect(await hangar(n)).toEqual([]);
  });

  test('an address with an account gets the aircraft at once, no invitation', async () => {
    mockMail();
    expect((await invite(owner, 'other@example.com')).status).toBe(409);
    const r = await invite(owner, 'Other@example.com', [
      [a1, 'view'],
      [a2, 'edit'],
    ]);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ existing: true, shared: ['SX-IN1', 'SX-IN2'], invitations: [] });
    expect(await hangar(other)).toEqual([
      ['SX-IN1', 'view'],
      ['SX-IN2', 'edit'],
      ['SX-OTH', 'owner'],
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Olga Owner shared 2 aircraft with you');
    expect((await invite(owner, 'other@example.com', [[a1, 'view']])).status).toBe(409);
    expect((await (await db()).query(`SELECT 1 FROM pilot_invitations WHERE email = 'other@example.com'`)).length).toBe(
      0,
    );
  });

  test('the invitation e-mails are capped per recipient; the invitation stands', async () => {
    mockMail();
    const q = await db();
    for (let i = 0; i < MAIL_RECIPIENT_CAP; i++)
      await q.query(
        `INSERT INTO mail_log (id, pilot_id, flight_id, form, at, recipient, subject, result) VALUES ($1,$2,NULL,'invite',$3,'capped@example.com','x','sent')`,
        [`ml-icap-${i}`, ids.o, Date.now() - 1000 - i],
      );
    expect((await invite(owner, 'capped@example.com', [[a1, 'view']])).status).toBe(201);
    expect(sent).toHaveLength(0);
    const rows = await q.query(`SELECT result FROM mail_log WHERE form = 'invite' ORDER BY at DESC LIMIT 1`);
    expect(rows[0].result).toBe('capped');
    expect((await list(owner)).map((i) => i.email)).toContain('capped@example.com');
  });

  test('rate limited like sharing', async () => {
    await (
      await db()
    ).query(
      `INSERT INTO rate_limits (bucket, subject, pilot_id, tokens, updated, ok) VALUES ('share', $1, $2, 0, $3, false)`,
      [`p:${ids.o}`, ids.o, Date.now()],
    );
    expect((await invite(owner, 'limited@example.com')).status).toBe(429);
  });
});

describe('ALLOWED_EMAILS', () => {
  test('an invitation admits its address; a cancelled one does not', async () => {
    const s = await startApi({ allowedEmails: ['boss@example.com'] });
    try {
      const boss = client(s.base);
      expect((await boss.login('sub-boss', 'boss@example.com')).status).toBe(200);
      const guest = client(s.base);
      expect((await guest.login('sub-guest', 'guest@example.com')).status).toBe(403);
      const r = await boss.call<InviteResponse>('POST', 'invitations', { email: 'Guest@example.com', aircraft: [] });
      expect(r.status).toBe(201);
      expect((await guest.login('sub-guest', 'guest@example.com')).status).toBe(200);
      // accepted, it keeps admitting them
      expect((await guest.call('GET', 'me')).status).toBe(200);
      expect((await guest.login('sub-guest', 'guest@example.com')).status).toBe(200);
      const late = client(s.base);
      const r2 = await boss.call<InviteResponse>('POST', 'invitations', { email: 'late@example.com', aircraft: [] });
      expect((await boss.call('DELETE', `invitations/${r2.body.invitations[0].id}`)).status).toBe(204);
      expect((await late.login('sub-late', 'late@example.com')).status).toBe(403);
    } finally {
      await s.close();
    }
  });
});

test('local mode (no sign-in): nobody to invite', async () => {
  const s = await startApi({ google: false });
  try {
    const c = client(s.base);
    const ac = await newAircraft(c, 'SX-LOC');
    expect((await c.call('POST', 'invitations', { email: 'nobody@example.com', aircraft: [] })).status).toBe(404);
    expect((await c.call('POST', `aircraft/${ac}/shares`, { email: 'nobody@example.com', role: 'view' })).status).toBe(
      404,
    );
  } finally {
    await s.close();
  }
});
