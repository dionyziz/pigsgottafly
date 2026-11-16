// Fuel on board by type on a flight (FlightOptions.fuelL): stored, validated, cleared.
import { afterAll, beforeAll, expect, test } from 'vitest';

import { fleetSeed } from '../../tools/build_seed';
import { type Client, client, startApi } from './helpers';

let api: Awaited<ReturnType<typeof startApi>>;
let c: Client;
beforeAll(async () => {
  api = await startApi();
  c = client(api.base);
  expect((await c.login('sub-fuel', 'fuel@example.com')).status).toBe(200);
});
afterAll(() => api.close());

test('MOGAS and AVGAS litres are kept with the flight; bad values are 400', async () => {
  const ac = await c.call('POST', 'aircraft', fleetSeed()[0]);
  expect(ac.status).toBe(201);
  expect(ac.body.fuel.types.map((g: any) => g.type)).toEqual(['AVGAS', 'MOGAS']);
  const f = (await c.call('POST', 'flights', { aircraftId: ac.body.id })).body;
  const put = (options: unknown, fobL: number | null, version: number) =>
    c.call('PUT', `flights/${f.id}`, { flight: { fobL, options: { ...f.options, ...(options as object) } }, version });

  let r = await put({ fuelL: { AVGAS: 60, MOGAS: 40 } }, 100, 1);
  expect(r.status).toBe(200);
  let got = (await c.call('GET', `flights/${f.id}`)).body;
  expect(got.fobL).toBe(100);
  expect(got.options.fuelL).toEqual({ AVGAS: 60, MOGAS: 40 });

  for (const bad of [{ DIESEL: 10 }, { AVGAS: -1 }, { AVGAS: '10' }, 'x']) {
    expect((await put({ fuelL: bad }, 10, got.version)).status, JSON.stringify(bad)).toBe(400);
  }
  r = await put({ fuelL: null }, null, got.version);
  expect(r.status).toBe(200);
  got = (await c.call('GET', `flights/${f.id}`)).body;
  expect(got.options.fuelL).toBeNull();
  expect(got.fobL).toBeNull();
});
