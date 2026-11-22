// The navlog strip: a leg's warnings under its row (not in the list), the flight panel's collapse tab
// clear of the strip, a leg's altitude edited in the strip (saved; the map label follows), and the
// flight's start-up/taxi fuel edited in the Fuel section (required fuel follows; saved), and a leg
// too close to the ground flagged under its row.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { after, before } from 'node:test';

import { fleetSeed } from '../../tools/build_seed.ts';
import { fakeOpenMeteo } from '../helpers/openMeteoGrid.ts';
import { launch, startServer } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens a stage of the flight panel (plan, brief, file): only its sections are shown. */
const stage = async (s) => {
  await page.click(`[data-testid=stage-${s}]`);
  await page.waitFor((s) => document.querySelector(`[data-testid=stage-body-${s}]`)?.hidden === false, { args: [s] });
};

const AD = JSON.parse(fs.readFileSync('src/data/ref/aerodromes.json', 'utf8'));
const ad = (id) => {
  const a = AD.find((x) => x.id === id);
  return { uid: id, kind: 'aerodrome', refId: a.id, name: id, lat: a.lat, lon: a.lon };
};
const date = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

// The recorded forecast with a thunderstorm (WMO 95) at every place and hour.
const om = fakeOpenMeteo();
const stormy = async (input) => {
  const r = await om.fetch(input);
  if (!r.ok) return r;
  const body = await r.json();
  for (const loc of Array.isArray(body) ? body : [body])
    if (loc?.hourly?.weather_code) loc.hourly.weather_code = loc.hourly.weather_code.map(() => 95);
  return new Response(JSON.stringify(body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
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
  server = await startServer({ openMeteo: { fetch: stormy } });
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
  flightId = f.id;
  browser = await launch();
  page = await browser.newPage();
  await page.viewport(1400, 800);
});
after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

test("a leg's hazard shows under its row, not in the list; the collapse tab stays off the strip", async () => {
  await page.goto(`${server.url}/flights/${flightId}`);
  await page.waitFor(() => document.querySelector('[data-testid=map]')?.dataset.ready === '1', { timeout: 20000 });
  await page.waitFor(
    () =>
      [...document.querySelectorAll('[data-testid=navlog-leg-warnings]')].some((r) =>
        /Thunderstorm/.test(r.textContent),
      ),
    { timeout: 30000 },
  );
  const rows = await page.eval(() =>
    [...document.querySelectorAll('[data-testid=navlog-leg-warnings]')].map((r) => ({
      leg: Number(r.dataset.leg),
      after: r.previousElementSibling?.dataset.testid,
      afterLeg: r.previousElementSibling?.querySelector('.ns-leg')?.textContent,
      text: r.textContent,
    })),
  );
  const storm = rows.filter((r) => /Thunderstorm forecast/.test(r.text));
  assert.ok(storm.length >= 1, JSON.stringify(rows));
  for (const r of storm) {
    assert.equal(r.after, 'navlog-row');
    assert.equal(r.afterLeg, ['LGTT → LGSR', 'LGSR → LGIR'][r.leg]);
    // under its leg: no 'A → B:' prefix, the time range kept
    assert.doesNotMatch(r.text, /→/);
    assert.match(r.text, /\d{2}:\d{2}(–\d{2}:\d{2})?Z/);
  }

  // the list: the leg hazards are not among the general warnings, but the count has them all
  await page.click('[data-testid=navlog-warn-toggle]');
  await page.waitFor(() => !document.querySelector('[data-testid=navlog-table]'));
  // the open warnings page shows on the button: pressed, filled, with an X back to the navlog
  assert.deepEqual(
    await page.eval(() => {
      const b = document.querySelector('[data-testid=navlog-warn-toggle]');
      return [b.getAttribute('aria-pressed'), b.classList.contains('active'), !!b.querySelector('.ns-warn-close')];
    }),
    ['true', true, true],
  );
  if (process.env.SHOTS) await page.screenshot('strip-warnings-open', { fullPage: false });
  const general = await page.eval(() =>
    [...document.querySelectorAll('[data-testid=navlog-warnings] li')].map((li) => li.textContent),
  );
  assert.ok(!general.some((t) => /LGTT → LGSR: Thunderstorm|LGSR → LGIR: Thunderstorm/.test(t)), general.join('\n'));
  await page.click('[data-testid=navlog-warn-toggle]');
  await page.waitFor(() => !!document.querySelector('[data-testid=navlog-table]'));
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=navlog-warn-toggle]').getAttribute('aria-pressed')),
    'false',
  );

  // the flight panel's collapse tab never sits over the strip's table, even with a tall strip
  await page.eval(() => localStorage.setItem('pgf.editor.stripHeight', String(Math.round(innerHeight * 0.7))));
  await page.reload();
  await page.waitFor(() => !!document.querySelector('[data-testid=navlog-table] th'), { timeout: 20000 });
  await page.idle(300);
  const hit = await page.eval(() => {
    const a = document.querySelector('[data-testid=panel-collapse]').getBoundingClientRect();
    const b = document.querySelector('[data-testid=navlog-table] th').getBoundingClientRect();
    const s = document.querySelector('[data-testid=navlog-strip]').getBoundingClientRect();
    return {
      intersects: a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
      aboveStrip: a.bottom <= s.top,
    };
  });
  assert.deepEqual(hit, { intersects: false, aboveStrip: true });
  if (process.env.SHOTS) await page.screenshot('strip-leg-warnings', { fullPage: false });
  await page.eval(() => localStorage.removeItem('pgf.editor.stripHeight'));
  assert.deepEqual(page.errors, []);
});

test("a leg's altitude edited in the strip is saved; the map label and the navlog follow", async () => {
  await page.goto(`${server.url}/flights/${flightId}`);
  await page.waitFor(() => document.querySelectorAll('[data-testid=navlog-alt]').length === 2, { timeout: 20000 });
  await page.waitFor(() => document.querySelector('[data-testid=map]')?.dataset.ready === '1', { timeout: 20000 });
  const before = await page.eval(() => document.querySelectorAll('[data-testid=navlog-alt]')[1].placeholder);
  assert.ok(before && before !== '6500', before);
  // typing alone changes nothing; Enter applies
  await page.type('tr[data-testid=navlog-row] ~ tr[data-testid=navlog-row] [data-testid=navlog-alt]', '6500');
  assert.ok(!Object.values((await api('GET', `flights/${flightId}`)).legOverrides || {}).some((o) => o.altFt === 6500));
  await page.key('Enter');
  await page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', {
    timeout: 10000,
  });
  const f = await api('GET', `flights/${flightId}`);
  const keys = Object.entries(f.legOverrides).filter(([, o]) => o.altFt === 6500);
  assert.equal(keys.length, 1, JSON.stringify(f.legOverrides));
  await page.waitFor(() => [...document.querySelectorAll('.pgf-leg-alt')].some((b) => b.textContent === 'FL065'));
  assert.equal(
    await page.eval(() => document.querySelectorAll('[data-testid=navlog-alt]')[1].classList.contains('is-set')),
    true,
  );
  // Escape puts the applied value back
  await page.type('tr[data-testid=navlog-row] ~ tr[data-testid=navlog-row] [data-testid=navlog-alt]', '7000');
  await page.key('Escape');
  await page.waitFor(() => document.querySelectorAll('[data-testid=navlog-alt]')[1].value === '6500');
  await sleep(700);
  assert.ok(!Object.values((await api('GET', `flights/${flightId}`)).legOverrides).some((o) => o.altFt === 7000));
  // an empty field offers its default to edit: focusing puts it in, selected; left unchanged it stays default
  const firstAlt = 'tr[data-testid=navlog-row] [data-testid=navlog-alt]';
  const dflt0 = await page.eval((s) => document.querySelector(s).placeholder, firstAlt);
  await page.eval((s) => document.querySelector(s).focus(), firstAlt);
  await page.waitFor(
    (s, d) => {
      const i = document.querySelector(s);
      return i.value === d.replace(/\D/g, '') || i.value === d;
    },
    { args: [firstAlt, dflt0] },
  );
  await page.key('Enter');
  await page.blur();
  // TAS: Enter applies a per-leg TAS
  const tas = 'tr[data-testid=navlog-row] [data-testid=navlog-tas]';
  await page.type(tas, '77');
  await page.key('Enter');
  await page.waitFor(async () => true);
  for (let i = 0; ; i++) {
    const f2 = await api('GET', `flights/${flightId}`);
    if (Object.values(f2.legOverrides).some((o) => o.tasKt === 77)) {
      assert.ok(!Object.values(f2.legOverrides).some((o) => o.altFt != null && o.altFt !== 6500));
      break;
    }
    assert.ok(i < 50, 'TAS saved');
    await sleep(200);
  }
  // cleared: back to the default
  await page.type('tr[data-testid=navlog-row] ~ tr[data-testid=navlog-row] [data-testid=navlog-alt]', '');
  await page.blur();
  await page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', {
    timeout: 10000,
  });
  await page.waitFor(() => ![...document.querySelectorAll('.pgf-leg-alt')].some((b) => b.textContent === 'FL065'));
  const g = await api('GET', `flights/${flightId}`);
  assert.ok(!Object.values(g.legOverrides).some((o) => o.altFt === 6500), JSON.stringify(g.legOverrides));
  assert.deepEqual(page.errors, []);
});

test('the start-up, taxi, take-off and landing fuel is edited per flight in the Fuel section', async () => {
  await page.goto(`${server.url}/flights/${flightId}`);
  await page.waitFor(
    () =>
      !!document.querySelector('[data-testid=taxi-allowance]') &&
      !!document.querySelector('[data-testid=fuel-required]'),
    {
      timeout: 20000,
    },
  );
  const required = () =>
    page.eval(() => parseInt(document.querySelector('[data-testid=fuel-required]').textContent, 10));
  const field = () =>
    page.eval(() => {
      const i = document.querySelector('[data-testid=taxi-allowance]');
      return [i.value, i.placeholder, i.classList.contains('is-set')];
    });
  assert.deepEqual(await field(), ['', '4', false]);
  await stage('plan');
  // the required fuel changes once the winds arrive: read it when it has stopped changing
  const settled = async () => {
    let last = await required();
    for (let same = 0; same < 4;) {
      await page.idle(250);
      const v = await required();
      same = v === last ? same + 1 : 0;
      last = v;
    }
    return last;
  };
  const before = await settled();
  await page.type('[data-testid=taxi-allowance]', '10');
  await page.blur();
  await page.waitFor((b) => parseInt(document.querySelector('[data-testid=fuel-required]').textContent, 10) === b + 6, {
    args: [before],
  });
  assert.deepEqual(await field(), ['10', '4', true]);
  await page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', {
    timeout: 10000,
  });
  assert.equal((await api('GET', `flights/${flightId}`)).options.taxiAllowanceL, 10);
  // kept after a reload
  await page.goto(`${server.url}/flights/${flightId}`);
  await page.waitFor(() => document.querySelector('[data-testid=taxi-allowance]')?.value === '10', { timeout: 20000 });
  await page.waitFor((b) => parseInt(document.querySelector('[data-testid=fuel-required]').textContent, 10) === b + 6, {
    args: [before],
    timeout: 15000,
  });
  // cleared: the aircraft's value again
  await page.type('[data-testid=taxi-allowance]', '');
  await page.blur();
  await page.waitFor((b) => parseInt(document.querySelector('[data-testid=fuel-required]').textContent, 10) === b, {
    args: [before],
  });
  await page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', {
    timeout: 10000,
  });
  assert.equal((await api('GET', `flights/${flightId}`)).options.taxiAllowanceL, null);
  assert.deepEqual(page.errors, []);
});

test('a leg flown less than 1000 ft above the ground is flagged under its row; not the legs to and from aerodromes', async () => {
  const ac = (await api('GET', 'aircraft'))[0];
  const custom = (uid, lat, lon) => ({ uid, kind: 'custom', name: uid, lat, lon });
  // P1 → P2 crosses Parnitha (1413 m, 4636 ft)
  const f = await api('POST', 'flights', {
    route: [ad('LGTT'), custom('P1', 38.17, 23.6), custom('P2', 38.17, 23.85), ad('LGTT')],
    date,
    blockOff: '09:00',
    aircraftId: ac.id,
  });
  const terrainRows = () =>
    page.eval(() =>
      [...document.querySelectorAll('[data-testid=navlog-leg-warnings]')]
        .filter((r) => /above the ground|below the ground/.test(r.textContent))
        .map((r) => Number(r.dataset.leg)),
    );
  await page.goto(`${server.url}/flights/${f.id}`);
  await page.waitFor(() => document.querySelectorAll('[data-testid=navlog-alt]').length === 3, { timeout: 20000 });
  const mid = 'tr[data-testid=navlog-row] ~ tr[data-testid=navlog-row] [data-testid=navlog-alt]';
  await page.type(mid, '5500');
  await page.key('Enter');
  await page.waitFor(
    () =>
      [...document.querySelectorAll('[data-testid=navlog-leg-warnings]')].some((r) =>
        /Less than 1000 ft above the ground \(terrain up to 4\d{3} ft\)/.test(r.textContent),
      ),
    { timeout: 20000 },
  );
  assert.deepEqual(await terrainRows(), [1]);
  // high enough: gone
  await page.type(mid, '6500');
  await page.key('Enter');
  await page.waitFor(
    () =>
      ![...document.querySelectorAll('[data-testid=navlog-leg-warnings]')].some((r) =>
        /above the ground/.test(r.textContent),
      ),
  );
  assert.deepEqual(page.errors, []);
});
