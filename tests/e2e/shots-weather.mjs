// Screenshots of the editor's weather (winds, hazards, the degraded states) with the forecast
// served by GET /api/weather/grid from the recorded-data fake Open-Meteo. Not a test: run with
//   node --import tsx tests/e2e/shots-weather.mjs <outdir>
import fs from 'node:fs';
import path from 'node:path';
import { launch, startServer } from './harness.mjs';
import { fakeOpenMeteo } from '../helpers/openMeteoGrid.ts';
import { fleetSeed } from '../../tools/build_seed.ts';

const out = process.argv[2] || 'tests/e2e/artifacts';
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AD = JSON.parse(fs.readFileSync('src/data/ref/aerodromes.json', 'utf8'));
const ad = (id) => {
  const a = AD.find((x) => x.id === id);
  return { uid: id, kind: 'aerodrome', refId: a.id, name: id, lat: a.lat, lon: a.lon };
};
const date = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

async function scene(name, openMeteo, check) {
  const server = await startServer({ openMeteo });
  const api = async (method, p, body) => {
    const r = await fetch(`${server.url}/api/${p}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };
  await api('PUT', 'me', {
    fullName: 'Test Pilot',
    phone: '+30 690 000 0000',
    homeAerodrome: 'LGTT',
    settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 },
  });
  const ac = await api('POST', 'aircraft', fleetSeed()[0]);
  const f = await api('POST', 'flights', {
    route: [ad('LGTT'), ad('LGSR'), ad('LGIR')],
    date,
    blockOff: '09:00',
    aircraftId: ac.id,
  });
  const browser = await launch();
  const page = await browser.newPage();
  await page.viewport(1500, 1000);
  try {
    await page.goto(`${server.url}/flights/${f.id}`);
    await page.waitFor(() => document.querySelector('[data-testid=map]')?.dataset.ready === '1', { timeout: 20000 });
    await page.waitFor(check, { timeout: 20000 });
    await sleep(1500);
    await page.click('[data-testid=navlog-warn-toggle]');
    await sleep(500);
    fs.copyFileSync(
      await page.screenshot('weather-' + name + '-warnings', { fullPage: false }),
      path.join(out, name + '-warnings.png'),
    );
    await page.click('[data-testid=navlog-warn-toggle]');
    await sleep(500);
    const file = await page.screenshot('weather-' + name, { fullPage: false });
    fs.copyFileSync(file, path.join(out, name + '.png'));
    const text = await page.eval(() => document.querySelector('[data-testid=navlog-strip]')?.innerText ?? '');
    console.log(`--- ${name}\n${text}\nerrors: ${JSON.stringify(page.errors)}`);
  } finally {
    await page.close();
    await browser.close();
    server.close();
  }
}

const om = fakeOpenMeteo();
await scene('1-winds-and-hazards', { fetch: om.fetch }, () => /Z run/.test(document.body.innerText));
console.log('Open-Meteo requests by the API:', om.calls.length, 'locations:', om.locations());
await scene('2-budget-used-up', { fetch: fakeOpenMeteo().fetch, dailyBudget: 0 }, () =>
  /No winds/.test(document.body.innerText),
);
const down = fakeOpenMeteo();
down.fail(429, 'Daily API request limit exceeded. Please try again tomorrow.');
await scene('3-open-meteo-limit', { fetch: down.fetch }, () => /No winds/.test(document.body.innerText));
