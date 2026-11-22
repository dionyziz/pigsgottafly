// End-to-end test of filing by fax in dry run (FAX_DRY_RUN: nothing is sent): with autorouter not
// configured, the FPL export's filing panel says the plan goes by fax to Athens Central AIS without
// acknowledgement, files it, and shows it delivered. The fax is the server's headless-Chrome print of
// the built PDF page (cover + ICAO form), kept in tests/e2e/artifacts/fax/ to be looked at.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { faxFromEnv } from '../../api/_lib/filers/faxProviders.ts';
import { setMailTransport } from '../../api/_lib/mail.ts';
import { chromiumFaxPdf } from '../../api/_lib/sheetPdf.ts';
import { fleetSeed } from '../../tools/build_seed.ts';
import { ARTIFACTS, launch, ROOT, startServer } from './harness.mjs';

const FAX_DIR = path.join(ARTIFACTS, 'fax');
let server, browser, page;
before(async () => {
  fs.rmSync(FAX_DIR, { recursive: true, force: true });
  server = await startServer({
    fax: faxFromEnv({ FAX_DRY_RUN: '1', FAX_DRY_RUN_DIR: FAX_DIR }),
    faxPdf: chromiumFaxPdf({ distDir: path.join(ROOT, 'dist') }),
  });
  setMailTransport(async () => ({ id: 'm' }));
  browser = await launch();
  page = await browser.newPage();
});
after(async () => {
  setMailTransport(null);
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
const ADS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ref/aerodromes.json'), 'utf8'));
const pt = (icao, uid) => {
  const a = (ADS.aerodromes ?? ADS).find((x) => x.icao === icao);
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const text = (sel) => page.eval((s) => document.querySelector(s)?.textContent ?? null, sel);

test('filing by fax (dry run): delivered by fax to Athens AIS, no acknowledgement', { timeout: 180000 }, async () => {
  await api('PUT', 'me', {
    fullName: 'Test Pilot',
    phone: '+30 690 000 0000',
    homeAerodrome: 'LGTT',
    weightKg: 80,
    settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 },
  });
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
  await page.waitFor(
    () => !!document.querySelector('[data-testid=fpl-message]') && !document.querySelector('.fpl-loading'),
    { timeout: 20000 },
  );
  // autorouter is not configured: the fax is the one backend, and says what it cannot do
  await page.waitFor(() => !!document.querySelector('[data-testid=fpl-filing-via-choice]'), { timeout: 20000 });
  assert.equal(
    await text('[data-testid=fpl-filing-via-choice]'),
    'Files via Fax to Athens Central AIS — no acknowledgement',
  );
  await page.waitFor(() => document.querySelector('[data-testid=fpl-file]')?.disabled === false, { timeout: 20000 });
  await page.click('[data-testid=fpl-file]');
  await page.waitFor(
    () => document.querySelector('[data-testid=fpl-filing-status]')?.textContent === 'Delivered by fax',
    {
      timeout: 60000,
    },
  );
  assert.equal(
    await text('[data-testid=fpl-filing-via]'),
    'Delivered by fax to Athens Central AIS (+30 210 3532635) — no acknowledgement',
  );
  // the plan can be cancelled (by fax) and its delivery asked again
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=fpl-cancel]')), true);
  assert.equal(await page.eval(() => document.querySelector('[data-testid=fpl-refresh]').disabled), false);
  if (process.env.SHOTS) await page.screenshot('fax-filed');

  // the fax as it would have gone: the server's print, a cover page and the ICAO form
  const files = fs.readdirSync(FAX_DIR).filter((n) => n.endsWith('.pdf'));
  assert.equal(files.length, 1);
  const raw = fs.readFileSync(path.join(FAX_DIR, files[0])).toString('latin1');
  assert.match(raw, /^%PDF-/);
  assert.match(raw, /\/Type\s*\/Pages[\s\S]{0,200}?\/Count 2\b/);

  const s = await api('GET', `flights/${f.id}/filing`);
  assert.equal(s.filing.provider, 'fax');
  assert.deepEqual(s.filing.faxTo, { number: '+302103532635', unit: 'Athens Central AIS' });
  assert.deepEqual(s.log.map((l) => [l.action, l.via, l.ok]).slice(0, 3), [
    ['copy', 'fax', false],
    ['delivery', 'fax', true],
    ['file', 'fax', true],
  ]);
  const c = await api('POST', `flights/${f.id}/filing/cancel`, {});
  assert.equal(c.filing.status, 'cancelled');
  assert.equal(c.filing.message, 'Cancellation delivered by fax.');
  assert.equal(fs.readdirSync(FAX_DIR).filter((n) => n.endsWith('.pdf')).length, 2);
});
