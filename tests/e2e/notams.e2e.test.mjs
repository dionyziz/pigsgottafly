// NOTAMs in the editor (a fake autorouter answers the server): hovering one in the panel outlines
// its area on the map with marching dashes; leaving it clears the outline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { after, before } from 'node:test';

import { fleetSeed } from '../../tools/build_seed.ts';
import { launch, startServer } from './harness.mjs';

const AD = JSON.parse(fs.readFileSync('src/data/ref/aerodromes.json', 'utf8'));
const ad = (id) => {
  const a = AD.find((x) => x.id === id);
  return { uid: id, kind: 'aerodrome', refId: a.id, name: id, lat: a.lat, lon: a.lon };
};
const G = 2 ** 30 / 90; // autorouter's coordinate unit
const date = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
const at = (hhmm) => Math.floor(Date.parse(`${date}T${hhmm}:00Z`) / 1000);

// a temporary restricted area, a small box half way between Tatoi and Megara, SFC – 5000 ft
const NOTAM = {
  id: 1,
  series: 'A',
  number: 9001,
  year: 26,
  type: 'N',
  fir: 'LGGG',
  code23: 'RT',
  code45: 'CA',
  traffic: 'IV',
  purpose: 'BO',
  scope: 'W',
  lower: 0,
  upper: 50,
  lat: Math.round(38.04 * G),
  lon: Math.round(23.57 * G),
  radius: 3,
  itema: ['LGGG'],
  startvalidity: at('06:00'),
  endvalidity: at('18:00'),
  iteme:
    'A TEMPO RESTRICTED AREA IS ESTABLISHED: 380600N 0233000E - 380600N 0233800E - 380000N 0233800E - 380000N 0233000E - 380600N 0233000E.',
  itemf: 'SFC',
  itemg: '5000FT AMSL',
};
const autorouterFetch = async (input) => {
  const url = new URL(String(input));
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.endsWith('/oauth2/token')) return json({ access_token: 'tok', expires_in: 3600 });
  if (url.pathname.endsWith('/notam')) return json({ total: 1, rows: [NOTAM] });
  return new Response(JSON.stringify({ error: 'no such endpoint' }), { status: 404 });
};

let server, browser, page, flightId;
const api = async (method, p, body) => {
  const r = await fetch(`${server.url}/api/${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
before(async () => {
  server = await startServer({
    autorouter: { email: 'app@example.com', password: 'x', filing: false, fetch: autorouterFetch },
  });
  await api('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0000', homeAerodrome: 'LGTT' });
  const ac = await api('POST', 'aircraft', fleetSeed()[0]);
  const f = await api('POST', 'flights', {
    route: [ad('LGTT'), ad('LGMG')],
    date,
    blockOff: '09:00',
    aircraftId: ac.id,
  });
  flightId = f.id;
  browser = await launch();
  page = await browser.newPage();
  await page.viewport(1400, 900);
});
after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

test('hovering a NOTAM in the panel outlines its area on the map; leaving clears it', async () => {
  await page.goto(`${server.url}/flights/${flightId}`);
  await page.waitFor(() => document.querySelector('[data-testid=map]')?.dataset.ready === '1', { timeout: 20000 });
  await page.click('[data-testid=stage-brief]');
  await page.waitFor(() => !!document.querySelector('[data-testid=notam][data-key="A9001/26"]'), { timeout: 20000 });
  // the departure's and the destination's groups are there with no NOTAM, then the airspace's
  assert.deepEqual(
    await page.eval(() =>
      [...document.querySelectorAll('[data-testid^=notam-group-]')].map((g) => [
        g.dataset.testid,
        g.querySelector('.ep-note')?.textContent ?? g.querySelectorAll('[data-testid=notam]').length,
      ]),
    ),
    [
      ['notam-group-LGTT', 'No relevant NOTAMs.'],
      ['notam-group-LGMG', 'No relevant NOTAMs.'],
      ['notam-group-airspace', 1],
    ],
  );
  const focus = () =>
    page.eval(() =>
      document
        .querySelector('.pgf-map-canvas')
        .__pgfMap.getSource('air-focus')
        .serialize()
        .data.features.map((f) => f.properties.id),
    );
  assert.deepEqual(await focus(), []);
  const r = await page.eval(() => {
    const b = document.querySelector('[data-testid=notam][data-key="A9001/26"]').getBoundingClientRect();
    return { x: b.left + 20, y: b.top + 10 };
  });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await page.waitFor(
    () =>
      document
        .querySelector('.pgf-map-canvas')
        .__pgfMap.getSource('air-focus')
        .serialize()
        .data.features.some((f) => f.properties.id === 'A9001/26'),
    { timeout: 5000 },
  );
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1300, y: 450 });
  await page.waitFor(
    () =>
      !document
        .querySelector('.pgf-map-canvas')
        .__pgfMap.getSource('air-focus')
        .serialize()
        .data.features.some((f) => f.properties.id === 'A9001/26'),
    { timeout: 5000 },
  );
});
