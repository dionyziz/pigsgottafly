// Shared flights (api/_lib/routes/flightShares.ts, access.ts flightFor): sharing by e-mail with an
// account (a share) or with an address no account uses yet (an invite, claimed on the next Google or
// Apple sign-in with that address); what viewers, editors and strangers may do with the flight, its
// manifest, briefing, filing and forms; the lobby's shared flights; leaving; the e-mails and caps.
// The mail transport is MOCKED: nothing is sent for real.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { MAIL_RECIPIENT_CAP } from '../../api/_lib/sendCaps';
import aerodromes from '../../src/data/ref/aerodromes.json';
import type { Flight, FlightListItem, FlightSharing } from '../../src/shared';
import type { RefAerodrome } from '../../src/shared/ref';
import { blankAircraft } from '../../src/shared/templates';
import type { PersonDetails, RoutePoint } from '../../src/shared/types';
import { appleClaims, type Client, client, signToken, startApi } from './helpers';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
const person = (fullName: string): PersonDetails => ({
  fullName,
  phone: '',
  dateOfBirth: null,
  weightKg: 70,
  idNumber: '',
  idType: '',
  nationality: '',
  relation: '',
});

let api: Awaited<ReturnType<typeof startApi>>;
let owner: Client, editor: Client, viewer: Client, stranger: Client;
const ids: Record<string, string> = {};
const sent: SentMail[] = [];
const db = async () => (await api.server.ready).db;
const origin = () => api.base.replace(/\/api\/$/, '');
const mockMail = () =>
  setMailTransport(async (m) => {
    sent.push(m);
    return { id: `m-${sent.length}` };
  });
const appleLogin = (c: Client, claims: Record<string, unknown>) =>
  c.call('POST', 'login/apple', { idToken: signToken(claims) });

beforeAll(async () => {
  api = await startApi({ apple: true });
  owner = client(api.base);
  editor = client(api.base);
  viewer = client(api.base);
  stranger = client(api.base);
  for (const [c, sub, email] of [
    [owner, 'o', 'Olga@Example.com'],
    [editor, 'e', 'editor@example.com'],
    [viewer, 'v', 'viewer@example.com'],
    [stranger, 's', 'stranger@example.com'],
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
  await (await db()).query('DELETE FROM mail_log');
});

async function newAircraft(reg: string) {
  const ac = blankAircraft();
  ac.registration = reg;
  ac.cruiseTasKt = 95;
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
  const r = await owner.call('POST', 'aircraft', ac);
  expect(r.status).toBe(201);
  return r.body.id as string;
}
async function newFlight(title: string, aircraftId: string | null = null): Promise<Flight> {
  const r = await owner.call<Flight>('POST', 'flights', {
    title,
    date: tomorrow,
    aircraftId,
    route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
    crew: [
      { role: 'PIC', passengerId: null, seat: 'front-left', snapshot: person('Olga Owner') },
      { role: 'PAX', passengerId: null, seat: 'front-right', snapshot: person('Petros Passenger') },
    ],
  });
  expect(r.status).toBe(201);
  return r.body;
}
const share = (c: Client, id: string, email: string, role: 'view' | 'edit') =>
  c.call<FlightSharing>('POST', `flights/${id}/shares`, { email, role });
const put = async (c: Client, f: Flight, patch: Partial<Flight>) => {
  const cur = (await c.call<Flight>('GET', `flights/${f.id}`)).body;
  const { id: _i, version, created: _c, updated: _u, opened: _o, deleted: _d, access: _a, ...doc } = cur;
  return c.call('PUT', `flights/${f.id}`, { flight: { ...doc, ...patch }, version });
};

describe('sharing a flight with pilots who have an account', () => {
  let f: Flight;
  let acId: string;
  beforeAll(async () => {
    acId = await newAircraft('SX-FLS');
    // another aircraft of the owner's that the shared pilots must not see
    await newAircraft('SX-HID');
    f = await newFlight('Thessaloniki – Megara', acId);
  });

  test('the owner alone has it; strangers get 404 everywhere', async () => {
    const s = (await owner.call<FlightSharing>('GET', `flights/${f.id}/shares`)).body;
    expect(s).toMatchObject({ flightId: f.id, title: 'Thessaloniki – Megara', role: 'owner', canManage: true });
    expect(s.people).toEqual([
      { pilotId: ids.o, name: 'Olga Owner', email: 'Olga@Example.com', role: 'owner', added: null },
    ]);
    expect((await owner.call<Flight>('GET', `flights/${f.id}`)).body.access).toBeUndefined();
    for (const [m, p] of [
      ['GET', `flights/${f.id}`],
      ['GET', `flights/${f.id}/shares`],
      ['GET', `flights/${f.id}/forms`],
      ['GET', `flights/${f.id}/filing`],
      ['GET', `flights/${f.id}/declarations`],
      ['GET', `flights/${f.id}/notams`],
      ['POST', `flights/${f.id}/copy`],
      ['POST', `flights/${f.id}/opened`],
      ['DELETE', `flights/${f.id}`],
    ] as const)
      expect([m, p, (await stranger.call(m, p, m === 'GET' ? undefined : {})).status]).toEqual([m, p, 404]);
    expect((await put(owner, f, {})).status).toBe(200);
    const cur = (await owner.call<Flight>('GET', `flights/${f.id}`)).body;
    expect(
      (await stranger.call('PUT', `flights/${f.id}`, { flight: { title: 'x' }, version: cur.version })).status,
    ).toBe(404);
  });

  test('adding an account: a share and an e-mail with a link', async () => {
    mockMail();
    const r = await share(owner, f.id, 'EDITOR@example.com', 'edit');
    expect(r.status).toBe(201);
    expect(r.body.people.map((p) => [p.pilotId, p.role, p.pending ?? false])).toEqual([
      [ids.o, 'owner', false],
      [ids.e, 'edit', false],
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['editor@example.com']);
    expect(sent[0].replyTo).toBe('Olga@Example.com');
    expect(sent[0].subject).toBe('Olga Owner shared the flight Thessaloniki – Megara with you');
    expect(sent[0].text).toContain('You can view and edit it.');
    expect(sent[0].text).toContain('LGTT → LGMG');
    expect(sent[0].text).toContain(`${origin()}/flights/${f.id}`);
    expect(sent[0].text).not.toContain('sign in with Google or Apple');
    const [row] = await (
      await db()
    ).query(`SELECT pilot_id, recipient, result FROM mail_log WHERE form = 'share-flight'`);
    expect({ ...row }).toEqual({ pilot_id: ids.o, recipient: 'editor@example.com', result: 'sent' });

    expect((await share(owner, f.id, 'viewer@example.com', 'view')).status).toBe(201);
    expect((await share(owner, f.id, 'viewer@example.com', 'edit')).status).toBe(409);
    expect((await share(owner, f.id, 'olga@example.com', 'view')).status).toBe(400);
    expect((await share(editor, f.id, 'olga@example.com', 'view')).status).toBe(400);
    expect((await share(owner, f.id, 'not an address', 'view')).status).toBe(400);
    expect((await owner.call('POST', `flights/${f.id}/shares`, { email: 'x@example.com', role: 'owner' })).status).toBe(
      400,
    );
  });

  test('a viewer reads the flight with its aircraft, but cannot change it', async () => {
    const got = await viewer.call<Flight>('GET', `flights/${f.id}`);
    expect(got.status).toBe(200);
    expect(got.body.crew).toHaveLength(2);
    expect(got.body.access).toMatchObject({
      role: 'view',
      owner: { pilotId: ids.o, name: 'Olga Owner', email: 'Olga@Example.com' },
      aircraft: { id: acId, registration: 'SX-FLS', access: { role: 'view', owner: { pilotId: ids.o } } },
      pilot: { fullName: 'Olga Owner', settings: expect.any(Object) },
    });
    // only that aircraft: not in their hangar, and the owner's others stay out of reach
    expect((await viewer.call('GET', 'aircraft')).body).toEqual([]);
    expect((await viewer.call('GET', `aircraft/${acId}`)).status).toBe(404);
    expect((await put(viewer, f, { title: 'Hacked' })).status).toBe(403);
    expect((await viewer.call('POST', `flights/${f.id}/forms/gendec/handled`, { handled: true })).status).toBe(403);
    expect((await viewer.call('GET', `flights/${f.id}/forms`)).status).toBe(200);
    expect((await viewer.call('GET', `flights/${f.id}/filing`)).body).toMatchObject({
      enabled: false,
      reason: 'Only the flight’s owner files its flight plan.',
    });
    expect((await viewer.call('GET', `flights/${f.id}/declarations`)).status).toBe(200);
    expect((await viewer.call('GET', `flights/${f.id}/notams`)).status).toBe(200);
    // viewers see who has access but cannot change it
    expect((await viewer.call('GET', `flights/${f.id}/shares`)).body.canManage).toBe(false);
    expect((await share(viewer, f.id, 'stranger@example.com', 'view')).status).toBe(403);
    expect((await viewer.call('PUT', `flights/${f.id}/shares/${ids.e}`, { role: 'view' })).status).toBe(403);
    expect((await viewer.call('DELETE', `flights/${f.id}/shares/${ids.e}`)).status).toBe(403);
  });

  test('an editor saves the flight and its manifest; the owner sees the change', async () => {
    const r = await put(editor, f, {
      title: 'Edited by the editor',
      crew: [
        { role: 'PIC', passengerId: null, seat: 'front-left', snapshot: person('Olga Owner') },
        { role: 'PAX', passengerId: null, seat: 'front-right', snapshot: person('Eleni Editorpicked') },
      ],
    });
    expect(r.status).toBe(200);
    const seen = (await owner.call<Flight>('GET', `flights/${f.id}`)).body;
    expect(seen.title).toBe('Edited by the editor');
    expect(seen.crew.map((c) => c.snapshot.fullName)).toEqual(['Olga Owner', 'Eleni Editorpicked']);
    // the manifest rows stay the owner's
    const rows = await (await db()).query('SELECT DISTINCT pilot_id FROM flight_crew WHERE flight_id = $1', [f.id]);
    expect(rows.map((x) => x.pilot_id)).toEqual([ids.o]);
    // a stale version: 409 with the current flight, as the editor sees it
    const stale = await editor.call('PUT', `flights/${f.id}`, { flight: { title: 'old' }, version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.access.role).toBe('edit');
    // editors may set the GenDec override (part of the flight)
    expect((await editor.call('POST', `flights/${f.id}/forms/gendec/handled`, { handled: true })).status).toBe(200);
    expect((await owner.call<Flight>('GET', `flights/${f.id}`)).body.options.genDecHandled).toBe(true);
  });

  test('owner-only: trash, restore, filing, forms, signing links and declarations', async () => {
    for (const c of [editor, viewer]) {
      for (const [m, p] of [
        ['DELETE', `flights/${f.id}`],
        ['POST', `flights/${f.id}/restore`],
        ['POST', `flights/${f.id}/filing`],
        ['POST', `flights/${f.id}/filing/delay`],
        ['POST', `flights/${f.id}/filing/cancel`],
        ['POST', `flights/${f.id}/filing/refresh`],
        ['POST', `flights/${f.id}/forms/731/links`],
        ['POST', `flights/${f.id}/forms/731/links/x/renew`],
        ['POST', `flights/${f.id}/forms/731/links/x/revoke`],
        ['POST', `flights/${f.id}/forms/731/send`],
        ['POST', `flights/${f.id}/forms/731/email/x`],
        ['POST', `flights/${f.id}/forms/gendec/send`],
        ['POST', `flights/${f.id}/declarations/send`],
      ] as const)
        expect([m, p, (await c.call(m, p, {})).status]).toEqual([m, p, 403]);
    }
    const forms = (await editor.call('GET', `flights/${f.id}/forms`)).body;
    expect(forms).toMatchObject({ emailEnabled: false, emailReason: 'Only the flight’s owner sends its forms.' });
    expect((await owner.call('POST', `flights/${f.id}/forms/731/links`, {})).status).toBe(200);
  });

  test('the lobby lists shared flights apart, with their owner and role', async () => {
    const list = (await viewer.call<FlightListItem[]>('GET', 'flights')).body;
    expect(list.map((x) => [x.id, x.role, x.sharedBy])).toEqual([
      [f.id, 'view', { pilotId: ids.o, name: 'Olga Owner', email: 'Olga@Example.com' }],
    ]);
    expect(list[0].passengers).toEqual(['Eleni Editorpicked']);
    expect((await viewer.call<FlightListItem[]>('GET', 'flights?trash=1')).body).toEqual([]);
    const own = (await owner.call<FlightListItem[]>('GET', 'flights')).body.find((x) => x.id === f.id)!;
    expect(own.sharedBy).toBeUndefined();
    expect(own.role).toBeUndefined();
    // opening it orders the viewer's list, not the owner's
    const before = (await owner.call<Flight>('GET', `flights/${f.id}`)).body.opened;
    expect((await viewer.call('POST', `flights/${f.id}/opened`, {})).status).toBe(204);
    expect((await owner.call<Flight>('GET', `flights/${f.id}`)).body.opened).toBe(before);
  });

  test('a copy by a shared pilot is theirs', async () => {
    const r = await viewer.call<Flight>('POST', `flights/${f.id}/copy`, { title: '', date: tomorrow });
    expect(r.status).toBe(201);
    expect(r.body.access).toBeUndefined();
    expect(r.body.crew.map((c) => c.snapshot.fullName)).toEqual(['Olga Owner', 'Eleni Editorpicked']);
    const mine = (await viewer.call<FlightListItem[]>('GET', 'flights')).body;
    expect(mine.find((x) => x.id === r.body.id)?.sharedBy).toBeUndefined();
    expect((await owner.call('GET', `flights/${r.body.id}`)).status).toBe(404);
    expect((await viewer.call('DELETE', `flights/${r.body.id}`)).status).toBe(204);
  });

  test('a flight in its owner’s trash is out of reach of the others', async () => {
    expect((await owner.call('DELETE', `flights/${f.id}`)).status).toBe(204);
    expect((await viewer.call('GET', `flights/${f.id}`)).status).toBe(404);
    expect((await viewer.call<FlightListItem[]>('GET', 'flights')).body.some((x) => x.id === f.id)).toBe(false);
    expect((await owner.call('POST', `flights/${f.id}/restore`, {})).status).toBe(200);
    expect((await viewer.call('GET', `flights/${f.id}`)).status).toBe(200);
  });

  test('changing roles, removing people, leaving', async () => {
    expect((await owner.call('PUT', `flights/${f.id}/shares/${ids.v}`, { role: 'edit' })).status).toBe(200);
    expect((await put(viewer, f, { title: 'Now an editor' })).status).toBe(200);
    expect((await editor.call('PUT', `flights/${f.id}/shares/${ids.v}`, { role: 'view' })).status).toBe(200);
    expect((await put(viewer, f, { title: 'x' })).status).toBe(403);
    expect((await editor.call('PUT', `flights/${f.id}/shares/${ids.o}`, { role: 'view' })).status).toBe(400);
    expect((await owner.call('DELETE', `flights/${f.id}/shares/${ids.o}`)).status).toBe(400);
    // the viewer leaves
    expect((await viewer.call('DELETE', `flights/${f.id}/shares/${ids.v}`)).status).toBe(204);
    expect((await viewer.call('GET', `flights/${f.id}`)).status).toBe(404);
    expect((await viewer.call<FlightListItem[]>('GET', 'flights')).body.some((x) => x.id === f.id)).toBe(false);
    // the owner removes the editor
    expect((await owner.call('DELETE', `flights/${f.id}/shares/${ids.e}`)).status).toBe(204);
    expect((await editor.call('GET', `flights/${f.id}`)).status).toBe(404);
    expect((await owner.call('DELETE', `flights/${f.id}/shares/${ids.e}`)).status).toBe(404);
  });
});

describe('inviting an address no account uses yet', () => {
  test('an invite, an e-mail that says how to sign in, claimed on the Google sign-in', async () => {
    mockMail();
    const f = await newFlight('Invite by Google');
    const r = await share(owner, f.id, 'New.Pilot@Example.com', 'view');
    expect(r.status).toBe(201);
    expect(r.body.people.at(-1)).toEqual({
      pilotId: 'new.pilot@example.com',
      name: '',
      email: 'new.pilot@example.com',
      role: 'view',
      added: expect.any(Number),
      pending: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['New.Pilot@Example.com']);
    expect(sent[0].text).toContain('You can view it.');
    expect(sent[0].text).toContain('sign in with Google or Apple using this e-mail address (New.Pilot@Example.com)');
    expect(sent[0].text).toContain(`${origin()}/flights/${f.id}`);
    expect((await share(owner, f.id, 'new.pilot@example.com', 'edit')).status).toBe(409);
    // pending invites change and go like shares
    expect((await owner.call('PUT', `flights/${f.id}/shares/New.Pilot@example.com`, { role: 'edit' })).status).toBe(
      200,
    );

    const b = client(api.base);
    expect((await b.login('sub-new', 'new.pilot@EXAMPLE.com')).status).toBe(200);
    const got = await b.call<Flight>('GET', `flights/${f.id}`);
    expect(got.status).toBe(200);
    expect(got.body.access?.role).toBe('edit');
    const s = (await owner.call<FlightSharing>('GET', `flights/${f.id}/shares`)).body;
    expect(s.people.map((p) => [p.email, p.role, p.pending ?? false])).toEqual([
      ['Olga@Example.com', 'owner', false],
      ['new.pilot@EXAMPLE.com', 'edit', false],
    ]);
    expect((await (await db()).query('SELECT * FROM flight_invites WHERE flight_id = $1', [f.id])).length).toBe(0);
  });

  test('claimed on the Apple sign-in; a Hide My Email address claims only invites sent to it', async () => {
    const f = await newFlight('Invite by Apple');
    expect((await share(owner, f.id, 'apple.pilot@example.com', 'view')).status).toBe(201);
    expect((await share(owner, f.id, 'abc123@privaterelay.appleid.com', 'edit')).status).toBe(201);
    // the relay address of someone whose real address was invited claims only the relay invite
    const relay = client(api.base);
    expect(
      (
        await appleLogin(
          relay,
          appleClaims('apple-relay', 'abc123@privaterelay.appleid.com', { is_private_email: 'true' }),
        )
      ).status,
    ).toBe(200);
    expect((await relay.call<Flight>('GET', `flights/${f.id}`)).body.access?.role).toBe('edit');
    const a = client(api.base);
    expect((await appleLogin(a, appleClaims('apple-real', 'Apple.Pilot@example.com'))).status).toBe(200);
    expect((await a.call<Flight>('GET', `flights/${f.id}`)).body.access?.role).toBe('view');
  });

  test('a removed invite is never claimed', async () => {
    const f = await newFlight('Withdrawn');
    expect((await share(owner, f.id, 'late@example.com', 'view')).status).toBe(201);
    expect((await owner.call('DELETE', `flights/${f.id}/shares/late@example.com`)).status).toBe(204);
    const c = client(api.base);
    expect((await c.login('sub-late', 'late@example.com')).status).toBe(200);
    expect((await c.call('GET', `flights/${f.id}`)).status).toBe(404);
  });

  test('the share notices are capped per recipient; the share stands', async () => {
    mockMail();
    const q = await db();
    const now = Date.now();
    for (let i = 0; i < MAIL_RECIPIENT_CAP; i++)
      await q.query(
        `INSERT INTO mail_log (id, pilot_id, flight_id, form, at, recipient, subject, result) VALUES ($1,$2,NULL,'share-flight',$3,'capped@example.com','x','sent')`,
        [`ml-fcap-${i}`, ids.o, now - 1000 - i],
      );
    const f = await newFlight('Capped');
    expect((await share(owner, f.id, 'capped@example.com', 'view')).status).toBe(201);
    expect(sent).toHaveLength(0);
    const rows = await q.query(
      `SELECT result FROM mail_log WHERE form = 'share-flight' AND recipient = 'capped@example.com' ORDER BY at`,
    );
    expect(rows.at(-1)!.result).toBe('capped');
    expect((await owner.call<FlightSharing>('GET', `flights/${f.id}/shares`)).body.people).toHaveLength(2);
  });
});
