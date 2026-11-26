// End-to-end test of linking the pilot's own autorouter account (api/_lib/routes/autorouter.ts) as
// far as this site goes: the profile's Connect button and the filing panel's "Connect autorouter to
// file", both through /api/autorouter/connect and back to the same page. autorouter itself is never
// reached (nothing here follows the link); a link stored directly shows as connected and disconnects.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { linkStatus, seal } from '../../api/_lib/autorouterLinks.ts';
import { fleetSeed } from '../../tools/build_seed.ts';
import { launch, startServer } from './harness.mjs';
import { refJson } from './refInEffect.mjs';

const OAUTH = {
  clientId: 'pgf-client',
  clientSecret: 'pgf-secret',
  tokenKey: 'e2e-key',
  redirectUri: '',
  filing: true,
  fetch: async () => {
    throw new Error('autorouter is not reached in this test');
  },
};

let server, browser, page;
before(async () => {
  server = await startServer({ autorouterOAuth: OAUTH });
  browser = await launch();
  page = await browser.newPage();
});
after(async () => {
  await page?.close();
  await browser?.close();
  server?.close();
});

const api = async (method, p, body) => {
  const r = await fetch(`${server.url}/api/${p}`, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status === 204 ? null : r.json();
};
const ADS = refJson('aerodromes.json');
const pt = (icao, uid) => {
  const a = (ADS.aerodromes ?? ADS).find((x) => x.icao === icao);
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const text = (sel) => page.eval((s) => document.querySelector(s)?.textContent ?? null, sel);
const href = (sel) => page.eval((s) => document.querySelector(s)?.getAttribute('href') ?? null, sel);

test('profile and filing panel offer to connect autorouter, back to the same page', { timeout: 120000 }, async () => {
  await page.goto(`${server.url}/profile`);
  await page.waitFor(() => !!document.querySelector('[data-testid=autorouter-connect]'), { timeout: 20000 });
  assert.equal(await text('[data-testid=autorouter-state]'), 'Not connected');
  assert.equal(await text('[data-testid=autorouter-connect]'), 'Connect');
  assert.equal(await href('[data-testid=autorouter-connect]'), '/api/autorouter/connect?return=%2Fprofile');

  const ac = await api('POST', 'aircraft', { ...fleetSeed()[0] });
  const date = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
  const f = await api('POST', 'flights', {
    date,
    aircraftId: ac.id,
    blockOff: '09:00',
    route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
  });
  await page.intercept('*/api/weather/metar*', () => ({ body: { stations: {}, fetched: Date.now() } }));
  await page.goto(`${server.url}/flights/${f.id}/export/fpl`);
  await page.waitFor(() => !!document.querySelector('[data-testid=fpl-autorouter-connect]'), { timeout: 20000 });
  assert.equal(await text('[data-testid=fpl-autorouter-connect]'), 'Connect autorouter to file');
  assert.equal(
    await href('[data-testid=fpl-autorouter-connect]'),
    `/api/autorouter/connect?return=${encodeURIComponent(`/flights/${f.id}/export/fpl`)}`,
  );
  // the one way to file here is to connect: no File button, no "not available" notice
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=fpl-file]')), false);
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=fpl-filing-disabled]')), false);
  if (process.env.SHOTS) await page.screenshot('autorouter-connect-filing');

  // linked (as the callback would store it): connected on the profile, and it disconnects
  await server.db.query(
    `INSERT INTO autorouter_links (pilot_id, access_token, linked_at, updated) SELECT id, $1, $2, $2 FROM pilots`,
    [seal(OAUTH, 'tok'), Date.now()],
  );
  await page.goto(`${server.url}/profile`);
  await page.waitFor(() => !!document.querySelector('[data-testid=autorouter-disconnect]'), { timeout: 20000 });
  assert.equal(await text('[data-testid=autorouter-state]'), 'Connected');
  if (process.env.SHOTS) await page.screenshot('autorouter-connected-profile');
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=autorouter-connect]')), false);
  await page.click('[data-testid=autorouter-disconnect]');
  await page.waitFor(() => !!document.querySelector('[data-testid=autorouter-connect]'), { timeout: 20000 });
  assert.deepEqual(await api('GET', 'autorouter'), linkStatus(OAUTH, null));
});
