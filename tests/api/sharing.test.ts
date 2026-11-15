// Shared aircraft: owner / editor / viewer / stranger access to the aircraft, its files and its
// sharing; adding people by e-mail; flights and the default aircraft on a shared aircraft; revoking.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { client, startApi, type Client } from './helpers';
import { blankAircraft } from '../../src/shared/templates';
import type { AircraftSharing, Flight, HangarAircraft } from '../../src/shared';

let api: Awaited<ReturnType<typeof startApi>>;
let owner: Client, editor: Client, viewer: Client, stranger: Client;
const ids: Record<string, string> = {};

const aircraftBody = (reg: string) => {
  const ac = blankAircraft();
  ac.registration = reg;
  ac.cruiseTasKt = 95;
  ac.patternTasKt = 80;
  ac.massBalance.stations = [{ id: 'front', name: 'Front', kind: 'seat', armM: 0.94, seats: [{ id: 'front-left', label: 'Front left' }, { id: 'front-right', label: 'Front right' }] }];
  return ac;
};
const PDF = Buffer.from('%PDF-1.4 swing report').toString('base64');

beforeAll(async () => {
  api = await startApi();
  owner = client(api.base);
  editor = client(api.base);
  viewer = client(api.base);
  stranger = client(api.base);
  for (const [c, sub, email] of [[owner, 'o', 'Owner@Example.com'], [editor, 'e', 'editor@example.com'], [viewer, 'v', 'viewer@example.com'], [stranger, 's', 'stranger@example.com']] as const) {
    expect((await c.login(`sub-${sub}`, email)).status).toBe(200);
    ids[sub] = (await c.call('GET', 'me')).body.id;
  }
  await owner.call('PUT', 'me', { fullName: 'Olga Owner' });
});
afterAll(() => api.close());

async function newAircraft(reg: string): Promise<HangarAircraft> {
  const r = await owner.call('POST', 'aircraft', aircraftBody(reg));
  expect(r.status).toBe(201);
  return r.body;
}

describe('sharing an aircraft', () => {
  let ac: HangarAircraft;
  beforeAll(async () => { ac = await newAircraft('SX-SHR'); });

  test('the creator owns it', async () => {
    expect(ac.access).toEqual({ role: 'owner', owner: { pilotId: ids.o, name: 'Olga Owner', email: 'Owner@Example.com' } });
    const s = (await owner.call<AircraftSharing>('GET', `aircraft/${ac.id}/shares`)).body;
    expect(s).toMatchObject({ aircraftId: ac.id, registration: 'SX-SHR', role: 'owner', canManage: true });
    expect(s.people).toEqual([{ pilotId: ids.o, name: 'Olga Owner', email: 'Owner@Example.com', role: 'owner', added: null }]);
  });

  test('a stranger gets 404 everywhere', async () => {
    expect((await stranger.call('GET', `aircraft/${ac.id}`)).status).toBe(404);
    expect((await stranger.call('GET', 'aircraft')).body).toEqual([]);
    expect((await stranger.call('GET', `aircraft/${ac.id}/shares`)).status).toBe(404);
    expect((await stranger.call('POST', `aircraft/${ac.id}/shares`, { email: 'stranger@example.com', role: 'edit' })).status).toBe(404);
    expect((await stranger.call('PUT', `aircraft/${ac.id}`, { colours: 'RED' })).status).toBe(404);
    expect((await stranger.call('DELETE', `aircraft/${ac.id}`)).status).toBe(404);
    expect((await stranger.call('POST', `aircraft/${ac.id}/attachments`, { name: 'r.pdf', mime: 'application/pdf', data: PDF })).status).toBe(404);
  });

  test('adding people: by e-mail, case-insensitive; unknown, self, owner and duplicates are refused', async () => {
    const add = (c: Client, email: string, role = 'view') => c.call('POST', `aircraft/${ac.id}/shares`, { email, role });
    const unknown = await add(owner, 'nobody@example.com');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatch(/No Pig’s Gotta Fly account uses nobody@example\.com/);
    expect((await add(owner, 'owner@example.com')).status).toBe(400); // yourself
    expect((await add(owner, '')).status).toBe(400);
    expect((await add(owner, 'viewer@example.com', 'admin')).status).toBe(400);
    const r = await add(owner, '  VIEWER@example.COM ', 'view');
    expect(r.status).toBe(201);
    expect(r.body.people.map((p: any) => [p.pilotId, p.role])).toEqual([[ids.o, 'owner'], [ids.v, 'view']]);
    expect((await add(owner, 'viewer@example.com', 'edit')).status).toBe(409);
    expect((await add(owner, 'editor@example.com', 'edit')).status).toBe(201);
  });

  test('viewers see it and the sharing but change nothing', async () => {
    const list = (await viewer.call<HangarAircraft[]>('GET', 'aircraft')).body;
    expect(list.map((a) => a.id)).toEqual([ac.id]);
    expect(list[0].access).toMatchObject({ role: 'view', owner: { pilotId: ids.o, name: 'Olga Owner' } });
    expect((await viewer.call('GET', `aircraft/${ac.id}`)).body.registration).toBe('SX-SHR');
    const s = (await viewer.call<AircraftSharing>('GET', `aircraft/${ac.id}/shares`)).body;
    expect(s).toMatchObject({ role: 'view', canManage: false });
    expect(s.people.map((p) => p.role)).toEqual(['owner', 'edit', 'view']);
    expect((await viewer.call('PUT', `aircraft/${ac.id}`, { colours: 'RED' })).status).toBe(403);
    expect((await viewer.call('DELETE', `aircraft/${ac.id}`)).status).toBe(403);
    expect((await viewer.call('POST', `aircraft/${ac.id}/shares`, { email: 'stranger@example.com', role: 'view' })).status).toBe(403);
    expect((await viewer.call('PUT', `aircraft/${ac.id}/shares/${ids.v}`, { role: 'edit' })).status).toBe(403);
    expect((await viewer.call('DELETE', `aircraft/${ac.id}/shares/${ids.e}`)).status).toBe(403);
    expect((await viewer.call('POST', `aircraft/${ac.id}/attachments`, { name: 'r.pdf', mime: 'application/pdf', data: PDF })).status).toBe(403);
  });

  test('editors change the aircraft and its files, and manage the sharing, but cannot delete it', async () => {
    const put = await editor.call('PUT', `aircraft/${ac.id}`, { colours: 'WHITE BLUE' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ colours: 'WHITE BLUE', access: { role: 'edit' } });
    expect((await owner.call('GET', `aircraft/${ac.id}`)).body.colours).toBe('WHITE BLUE');
    // a swing report uploaded by the editor belongs to the aircraft: everyone with access reads it
    const file = await editor.call('POST', `aircraft/${ac.id}/attachments`, { name: 'swing.pdf', mime: 'application/pdf', data: PDF });
    expect(file.status).toBe(201);
    const card = { name: 'Magnetic compass', swung: '2026-01-10', expires: '2028-01-10', source: '', points: [[0, 1], [90, 91]], report: file.body };
    const withCard = await editor.call('PUT', `aircraft/${ac.id}`, { compassCards: [card] });
    expect(withCard.status, JSON.stringify(withCard.body)).toBe(200);
    expect((await viewer.call('GET', `aircraft/${ac.id}/attachments/${file.body.id}`)).body.data).toBe(PDF);
    expect((await owner.call('GET', `aircraft/${ac.id}/attachments/${file.body.id}`)).status).toBe(200);
    expect((await stranger.call('GET', `aircraft/${ac.id}/attachments/${file.body.id}`)).status).toBe(404);
    expect((await viewer.call('DELETE', `aircraft/${ac.id}/attachments/${file.body.id}`)).status).toBe(403);
    // sharing
    expect((await editor.call('POST', `aircraft/${ac.id}/shares`, { email: 'stranger@example.com', role: 'view' })).status).toBe(201);
    expect((await stranger.call('GET', `aircraft/${ac.id}`)).status).toBe(200);
    expect((await editor.call('DELETE', `aircraft/${ac.id}/shares/${ids.s}`)).status).toBe(204);
    expect((await stranger.call('GET', `aircraft/${ac.id}`)).status).toBe(404);
    expect((await editor.call('PUT', `aircraft/${ac.id}/shares/${ids.o}`, { role: 'view' })).status).toBe(400);
    expect((await editor.call('DELETE', `aircraft/${ac.id}/shares/${ids.o}`)).status).toBe(400);
    expect((await editor.call('POST', `aircraft/${ac.id}/shares`, { email: 'owner@example.com', role: 'view' })).status).toBe(400);
    expect((await editor.call('DELETE', `aircraft/${ac.id}`)).status).toBe(403);
  });

  test('roles change and the change sticks', async () => {
    const r = await owner.call<AircraftSharing>('PUT', `aircraft/${ac.id}/shares/${ids.v}`, { role: 'edit' });
    expect(r.body.people.find((p) => p.pilotId === ids.v)?.role).toBe('edit');
    expect((await viewer.call('PUT', `aircraft/${ac.id}`, { notes: 'by the viewer, now an editor' })).status).toBe(200);
    await owner.call('PUT', `aircraft/${ac.id}/shares/${ids.v}`, { role: 'view' });
    expect((await viewer.call('PUT', `aircraft/${ac.id}`, { notes: 'again' })).status).toBe(403);
    expect((await owner.call('PUT', `aircraft/${ac.id}/shares/${ids.s}`, { role: 'view' })).status).toBe(404);
    const again = (await owner.call<AircraftSharing>('GET', `aircraft/${ac.id}/shares`)).body;
    expect(again.people.map((p) => [p.pilotId, p.role])).toEqual([[ids.o, 'owner'], [ids.e, 'edit'], [ids.v, 'view']]);
  });

  test('registrations stay unique per owner: a shared aircraft does not block your own', async () => {
    const mine = await viewer.call('POST', 'aircraft', aircraftBody('SX-SHR'));
    expect(mine.status).toBe(201);
    const list = (await viewer.call<HangarAircraft[]>('GET', 'aircraft')).body;
    expect(list.map((a) => [a.registration, a.access.role])).toEqual([['SX-SHR', 'owner'], ['SX-SHR', 'view']]);
    expect((await viewer.call('DELETE', `aircraft/${mine.body.id}`)).status).toBe(204);
  });
});

describe('flights on a shared aircraft', () => {
  test('a viewer flies it, makes it their default, and keeps their flights when access ends', async () => {
    const ac = await newAircraft('SX-FLY');
    await owner.call('POST', `aircraft/${ac.id}/shares`, { email: 'viewer@example.com', role: 'view' });

    // default aircraft and new flights
    expect((await viewer.call('PUT', 'me', { defaultAircraftId: ac.id })).status).toBe(200);
    const created = await viewer.call<Flight>('POST', 'flights', {});
    expect(created.status).toBe(201);
    expect(created.body.aircraftId).toBe(ac.id);
    expect(created.body.summary.aircraft).toBe('SX-FLY');
    const f = created.body;
    const crew = [...f.crew, { role: 'PAX', passengerId: null, seat: 'front-right', snapshot: { fullName: 'Guest', weightKg: 70 } }];
    const put = await viewer.call('PUT', `flights/${f.id}`, { flight: { crew }, version: f.version });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    // seats are those of the shared aircraft
    const bad = [...f.crew, { role: 'PAX', passengerId: null, seat: 'rear-left', snapshot: { fullName: 'Guest' } }];
    expect((await viewer.call('PUT', `flights/${f.id}`, { flight: { crew: bad }, version: put.body.version })).status).toBe(400);
    // forms and filing see the aircraft
    const forms = await viewer.call('GET', `flights/${f.id}/forms`);
    expect(forms.status).toBe(200);
    expect(JSON.stringify(forms.body)).toContain('SX-FLY');
    // a stranger cannot put it on a flight or make it their default
    expect((await stranger.call('POST', 'flights', { aircraftId: ac.id })).status).toBe(400);
    expect((await stranger.call('PUT', 'me', { defaultAircraftId: ac.id })).status).toBe(400);

    // the owner revokes: the default is cleared, the flight still opens and saves with the aircraft unavailable
    expect((await owner.call('DELETE', `aircraft/${ac.id}/shares/${ids.v}`)).status).toBe(204);
    expect((await viewer.call('GET', 'me')).body.defaultAircraftId).toBeNull();
    expect((await viewer.call('GET', `aircraft/${ac.id}`)).status).toBe(404);
    const after = await viewer.call<Flight>('GET', `flights/${f.id}`);
    expect(after.status).toBe(200);
    expect(after.body.aircraftId).toBe(ac.id);
    const save = await viewer.call('PUT', `flights/${f.id}`, { flight: { ...after.body, title: 'still mine' }, version: after.body.version });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    // but cannot choose it again on another flight
    expect((await viewer.call('POST', 'flights', { aircraftId: ac.id })).status).toBe(400);
    const other = (await viewer.call<Flight>('POST', 'flights', {})).body;
    expect(other.aircraftId).toBeNull();
    expect((await viewer.call('PUT', `flights/${other.id}`, { flight: { aircraftId: ac.id }, version: other.version })).status).toBe(400);
    // the forms no longer show the aircraft
    expect(JSON.stringify((await viewer.call('GET', `flights/${f.id}/forms`)).body)).not.toContain('SX-FLY');
    // choosing no aircraft (or another) works
    const cleared = await viewer.call('PUT', `flights/${f.id}`, { flight: { aircraftId: null }, version: save.body.version });
    expect(cleared.status).toBe(200);
  });

  test('a pilot removes a shared aircraft from their own hangar; the owner deleting it clears it everywhere', async () => {
    const ac = await newAircraft('SX-GONE');
    await owner.call('POST', `aircraft/${ac.id}/shares`, { email: 'editor@example.com', role: 'edit' });
    await owner.call('POST', `aircraft/${ac.id}/shares`, { email: 'viewer@example.com', role: 'view' });
    await viewer.call('PUT', 'me', { defaultAircraftId: ac.id });
    // the viewer leaves (their own share), the owner is unaffected
    expect((await viewer.call('DELETE', `aircraft/${ac.id}/shares/${ids.v}`)).status).toBe(204);
    expect((await viewer.call('GET', 'me')).body.defaultAircraftId).toBeNull();
    expect((await viewer.call('GET', 'aircraft')).body.some((a: any) => a.id === ac.id)).toBe(false);
    expect((await owner.call('GET', `aircraft/${ac.id}`)).status).toBe(200);
    expect((await viewer.call('DELETE', `aircraft/${ac.id}/shares/${ids.v}`)).status).toBe(404);
    // the owner cannot leave their own aircraft
    expect((await owner.call('DELETE', `aircraft/${ac.id}/shares/${ids.o}`)).status).toBe(400);
    // the editor's flight and default lose the aircraft when the owner deletes it
    await editor.call('PUT', 'me', { defaultAircraftId: ac.id });
    const f = (await editor.call<Flight>('POST', 'flights', {})).body;
    expect(f.aircraftId).toBe(ac.id);
    expect((await owner.call('DELETE', `aircraft/${ac.id}`)).status).toBe(204);
    expect((await editor.call('GET', `flights/${f.id}`)).body.aircraftId).toBeNull();
    expect((await editor.call('GET', 'me')).body.defaultAircraftId).toBeNull();
    expect((await editor.call('GET', 'aircraft')).body.some((a: any) => a.id === ac.id)).toBe(false);
  });
});
