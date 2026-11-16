// Deleting a passenger: flights keep the manifest snapshot (no passenger id), an editor still holding
// the old id saves without error, and the passenger's Form 731 signature and signing link survive.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { Flight } from '../../src/shared';
import type { FormsState, SigningView } from '../../src/shared/forms';
import { type Client, client, startApi } from './helpers';

let api: Awaited<ReturnType<typeof startApi>>;
let a: Client, b: Client;
beforeAll(async () => {
  api = await startApi();
  a = client(api.base);
  b = client(api.base);
  await a.login('sub-a', 'a@example.com');
  await b.login('sub-b', 'b@example.com');
  await a.call('PUT', 'me', { fullName: 'Alice Pilot', phone: '+30 690 000 0001', idNumber: 'AK 1' });
});
afterAll(() => api.close());

describe('deleting a passenger', () => {
  test('flights keep the snapshot; stale saves pass; signatures and links keep working', async () => {
    const pax = (
      await a.call('POST', 'passengers', {
        fullName: 'Bob Pax',
        phone: '+30 690 000 0002',
        idNumber: 'AB 2',
        weightKg: 80,
      })
    ).body;
    const f = (await a.call('POST', 'flights', { date: new Date(Date.now() + 86400e3).toISOString().slice(0, 10) }))
      .body as Flight;
    const crew = [
      ...f.crew,
      {
        role: 'PAX',
        passengerId: pax.id,
        seat: 'front-right',
        snapshot: { fullName: 'Bob Pax', phone: '+30 690 000 0002', idNumber: 'AB 2', weightKg: 80 },
      },
    ];
    const put = await a.call('PUT', `flights/${f.id}`, { flight: { crew }, version: f.version });
    expect(put.status).toBe(200);

    // Bob signs Form 731 through his link
    const links = (await a.call<FormsState>('POST', `flights/${f.id}/forms/731/links`)).body.links!;
    const token = links[pax.id];
    expect(token).toBeTruthy();
    expect((await a.call<SigningView>('POST', `sign/${token}`)).status).toBe(200);
    let st = (await a.call<FormsState>('GET', `flights/${f.id}/forms`)).body;
    expect(st.form731.signatures.find((s) => s.name === 'Bob Pax')?.signed).toBe(true);

    // another pilot cannot delete him; the owner can, once
    expect((await b.call('DELETE', `passengers/${pax.id}`)).status).toBe(404);
    expect((await a.call('DELETE', `passengers/${pax.id}`)).status).toBe(204);
    expect((await a.call('DELETE', `passengers/${pax.id}`)).status).toBe(404);
    expect((await a.call('PUT', `passengers/${pax.id}`, { fullName: 'Too Late' })).status).toBe(404);
    expect((await a.call('GET', 'passengers')).body).toEqual([]);

    const g = (await a.call<Flight>('GET', `flights/${f.id}`)).body;
    expect(g.crew[1]).toMatchObject({
      passengerId: null,
      seat: 'front-right',
      snapshot: { fullName: 'Bob Pax', idNumber: 'AB 2', weightKg: 80 },
    });
    // an editor still holding the deleted id saves without error (the link is dropped)
    const stale = await a.call('PUT', `flights/${f.id}`, {
      flight: { crew, title: 'Edited later' },
      version: g.version,
    });
    expect(stale.status).toBe(200);
    expect((await a.call<Flight>('GET', `flights/${f.id}`)).body.crew[1].passengerId).toBeNull();

    // his signature still counts, and his link still opens his row
    st = (await a.call<FormsState>('GET', `flights/${f.id}/forms`)).body;
    const bob = st.form731.signatures.find((s) => s.name === 'Bob Pax')!;
    expect(bob).toMatchObject({ key: 'seat:front-right', signed: true });
    expect(bob.link).toMatchObject({ revoked: false });
    const view = await a.call<SigningView>('GET', `sign/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.me).toBe('seat:front-right');
    expect(view.body.content.people.find((p) => p.key === 'seat:front-right')?.idPassport).toBe('AB 2');
  });
});
