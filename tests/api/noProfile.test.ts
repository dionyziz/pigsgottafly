// A new account has only its e-mail (no name, phone or home aerodrome): sign-up asks for nothing, and
// nothing the account does is refused for it. A passenger views what is shared with them; acting as a
// pilot, the account creates flights and aircraft, and the forms show the PIC's details as missing.
// The mail transport is MOCKED: nothing is sent for real.
import { afterAll, beforeAll, expect, test } from 'vitest';

import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { AERODROMES as aerodromes } from '../../src/data/ref';
import type { Flight, FlightListItem, HangarAircraft } from '../../src/shared';
import type { FormsState } from '../../src/shared/forms';
import type { RefAerodrome } from '../../src/shared/ref';
import { blankAircraft } from '../../src/shared/templates';
import type { RoutePoint } from '../../src/shared/types';
import { type Client, client, startApi } from './helpers';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};

let api: Awaited<ReturnType<typeof startApi>>;
let owner: Client, newcomer: Client;
const sent: SentMail[] = [];

beforeAll(async () => {
  api = await startApi();
  setMailTransport(async (m) => {
    sent.push(m);
    return { id: `m-${sent.length}` };
  });
  owner = client(api.base);
  expect((await owner.login('sub-owner', 'owner@example.com')).status).toBe(200);
  await owner.call('PUT', 'me', { fullName: 'Olga Owner', phone: '+30 690 000 0000', homeAerodrome: 'LGTT' });
});
afterAll(async () => {
  setMailTransport(null);
  await api.close();
});

test('a passenger with only an e-mail sees the flight and the aircraft shared with them', async () => {
  const ac = { ...blankAircraft(), registration: 'SX-NOP' };
  const a = (await owner.call<HangarAircraft>('POST', 'aircraft', ac)).body;
  const f = (await owner.call<Flight>('POST', 'flights', { title: 'Island hop', aircraftId: a.id })).body;
  // no account yet: invites, claimed at the first sign-in
  expect((await owner.call('POST', `flights/${f.id}/shares`, { email: 'pax@example.com', role: 'view' })).status).toBe(
    201,
  );
  expect(
    (
      await owner.call('POST', 'invitations', {
        email: 'pax@example.com',
        aircraft: [{ aircraftId: a.id, role: 'view' }],
      })
    ).status,
  ).toBe(201);

  newcomer = client(api.base);
  expect((await newcomer.login('sub-pax', 'pax@example.com')).status).toBe(200);
  const me = (await newcomer.call('GET', 'me')).body;
  expect([me.email, me.fullName, me.phone, me.homeAerodrome]).toEqual(['pax@example.com', '', '', null]);

  const list = (await newcomer.call<FlightListItem[]>('GET', 'flights')).body;
  expect(list.map((x) => x.id)).toEqual([f.id]);
  const got = await newcomer.call<Flight>('GET', `flights/${f.id}`);
  expect(got.status).toBe(200);
  expect(got.body.access?.role).toBe('view');
  expect((await newcomer.call('GET', `flights/${f.id}/forms`)).status).toBe(200);
  const hangar = (await newcomer.call<HangarAircraft[]>('GET', 'aircraft')).body;
  expect(hangar.map((x) => [x.registration, x.access.role])).toEqual([['SX-NOP', 'view']]);
});

test('acting as a pilot without a profile: flights and aircraft are created, the forms show what is missing', async () => {
  // no home aerodrome: a flight starts with an empty route, or the route given
  const empty = await newcomer.call<Flight>('POST', 'flights', {});
  expect(empty.status).toBe(201);
  expect(empty.body.route).toEqual([]);
  const ac = await newcomer.call<HangarAircraft>('POST', 'aircraft', { ...blankAircraft(), registration: 'SX-NEW' });
  expect(ac.status).toBe(201);
  const route = [pt('LGTT', 'a'), pt('LGSY', 'b')];
  const f = await newcomer.call<Flight>('POST', 'flights', { route, aircraftId: ac.body.id });
  expect(f.status).toBe(201);
  expect(f.body.route.map((p) => p.name)).toEqual(['LGTT', 'LGSY']);
  expect(f.body.crew).toMatchObject([{ role: 'PIC', snapshot: { fullName: '', phone: '' } }]);

  const forms = await newcomer.call<FormsState>('GET', `flights/${f.body.id}/forms`);
  expect(forms.status).toBe(200);
  const pic = forms.body.form731.content.people.find((p) => p.role === 'PIC')!;
  expect([pic.name, pic.contact, pic.idPassport]).toEqual(['', '', '']);
  // added later, the forms take the details
  await newcomer.call('PUT', 'me', { fullName: 'Pat Passenger', phone: '+30 690 111 1111' });
  const again = (await newcomer.call<FormsState>('GET', `flights/${f.body.id}/forms`)).body;
  expect(again.form731.content.people.find((p) => p.role === 'PIC')).toMatchObject({ name: 'Pat Passenger' });
});
