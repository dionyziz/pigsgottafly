// End-to-end test of the whole flight workflow, in headless Chrome against the local server
// (in-memory PGlite) with Open-Meteo (behind the API's GET /api/weather/grid) and the METAR proxy
// answered by mocks:
//   1. create a flight from the lobby;
//   2. draw a route on the map by clicking near LGTT, a VFR point and an aerodrome (snapping),
//      add a custom named waypoint, edit an altitude on the map;
//   3. set date/time, aircraft, fuel on board, add a passenger to the manifest;
//   4. check the navlog against the independent oracle (tests/e2e/oracle.mjs);
//   5. open every export, check key fields and the printed page size (PDF);
//   6. check W&B against an independent sum and take-off performance against the club calculator.
// Screenshots go to tests/e2e/artifacts/flight-*.png.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { fleetSeed } from '../../tools/build_seed.ts';
import { launch, openMeteoFetch, ROOT, startServer } from './harness.mjs';
import * as O from './oracle.mjs';

let server, browser, page;
/** Open-Meteo requests the API made (the browser makes none). */
const openMeteoCalls = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, p, body) => {
  const r = await fetch(`${server.url}/api/${p}`, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
const REF = {
  aerodromes: JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ref/aerodromes.json'), 'utf8')),
  vfr: JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ref/vfr-points.json'), 'utf8')),
  runways: JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ref/runways.json'), 'utf8')),
};
const AD = (id) => REF.aerodromes.find((a) => a.id === id);
const VFR = (id) => REF.vfr.find((p) => p.id === id);
const LGTT = AD('LGTT'),
  LGMG = AD('LGMG'),
  ABLONAS = VFR('LGAV/ABLONAS');
const ZOFRI = { lat: 38.045, lon: 23.47 };

// ---- time: the flight leaves about 20 minutes from now, so the mocked METARs are current
const now = new Date();
const blockOffMs = Math.ceil((now.getTime() + 20 * 60000) / 300000) * 300000;
const blockOff = new Date(blockOffMs);
const DATE = blockOff.toISOString().slice(0, 10);
const BLOCK_OFF = blockOff.toISOString().slice(11, 16);
const pad = (n) => String(n).padStart(2, '0');
const obs = new Date(now.getTime() - 10 * 60000);
const metarTime = `${pad(obs.getUTCDate())}${pad(obs.getUTCHours())}${pad(obs.getUTCMinutes())}Z`;

// ---- weather mocks. Winds aloft vary with height and time (oracle.windAt predicts the displayed
// wind); surface fields come from the METARs below (current), so take-off conditions are exact.
const windFn = ({ level, hour }) => ({
  dir: 250 + (1000 - level) / 10 + hour,
  spd: 8 + (1000 - level) / 25,
  temp: 15 - (1000 - level) / 25,
});
// Club case 60: LGTT RWY 03, 030/05, QNH 1013, 15 °C, 2 % upslope, paved.
const METARS = {
  LGTT: `LGTT ${metarTime} 03005KT CAVOK 15/05 Q1013`,
  LGMG: `LGMG ${metarTime} 26008KT 9999 FEW030 17/07 Q1014`,
};

before(async () => {
  const forecast = O.openMeteoResponder(windFn);
  server = await startServer({
    openMeteo: {
      fetch: openMeteoFetch((u) => {
        openMeteoCalls.push(u.href);
        if (u.pathname.endsWith('/meta.json'))
          return {
            body: {
              last_run_initialisation_time: Math.floor(now.getTime() / 21600000) * 21600,
              last_run_availability_time: Math.floor(now.getTime() / 21600000) * 21600 + 7200,
            },
          };
        return forecast(u);
      }),
    },
  });
  browser = await launch();
  page = await browser.newPage();
  await page.viewport(1600, 1000);
  await page.intercept('*/api/weather/metar*', (u) => {
    const ids = (u.searchParams.get('ids') || '').split(',');
    const stations = {};
    for (const id of ids)
      if (METARS[id])
        stations[id] = { metar: METARS[id], taf: null, observed: obs.getTime() - (obs.getTime() % 60000) };
    return { body: { stations, fetched: Date.now() } };
  });
});
after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

const shot = (name) => page.screenshot('flight-' + name, { fullPage: false });
/** Page coordinates of a lat/lon on the map, once the layout has settled. The navlog strip below
 *  grows a row per leg, which shrinks the map; MapLibre picks the new size up from a ResizeObserver
 *  (throttled to 50 ms) that only runs at a rendering opportunity, and with SwiftShader WebGL on a
 *  busy machine frames can be hundreds of ms apart. So each sample waits for real animation frames
 *  and the 50 ms throttle, and only counts when MapLibre's own size matches its container; the
 *  position must then read the same on consecutive samples. */
const mapPx = async (lat, lon) => {
  const at = () =>
    page.eval(
      async (lat, lon) => {
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        await frame();
        await new Promise((r) => setTimeout(r, 60));
        await frame();
        await frame();
        const c = document.querySelector('.pgf-map-canvas');
        const m = c.__pgfMap;
        const r = c.getBoundingClientRect();
        const sized =
          Math.abs(m.getCanvas().width / m.getPixelRatio() - c.clientWidth) < 1 &&
          Math.abs(m.getCanvas().height / m.getPixelRatio() - c.clientHeight) < 1;
        const p = m.project([lon, lat]);
        return { sized, x: Math.round((r.left + p.x) * 10) / 10, y: Math.round((r.top + p.y) * 10) / 10 };
      },
      lat,
      lon,
    );
  let prev = await at(),
    same = 0;
  for (let i = 0; i < 60 && same < 2; i++) {
    const cur = await at();
    same = cur.sized && prev.sized && cur.x === prev.x && cur.y === prev.y ? same + 1 : 0;
    prev = cur;
  }
  assert.ok(prev.sized, 'map size settled');
  return { x: prev.x, y: prev.y };
};
async function mouse(type, x, y, { modifiers = 0, clickCount = 1, button = 'left' } = {}) {
  await page.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    modifiers,
    clickCount,
    button: type === 'mouseMoved' ? 'none' : button,
  });
}
async function hover(x, y) {
  await mouse('mouseMoved', x - 3, y - 3);
  await mouse('mouseMoved', x, y);
  await sleep(120);
}
async function clickAt(x, y, opts) {
  await hover(x, y);
  await mouse('mousePressed', x, y, opts);
  await mouse('mouseReleased', x, y, opts);
  await sleep(150);
}
/** Sets an input's value the way React sees it (date inputs cannot be typed into reliably). */
const setValue = (sel, v) =>
  page.eval(
    (sel, v) => {
      const e = document.querySelector(sel);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    sel,
    v,
  );
/** Prints the page to PDF (tests/e2e/artifacts/flight-<name>.pdf) and checks the page count and A4 size. */
async function pdfCheck(name, pages, orientation) {
  await page.media('print');
  const r = await page.pdf('flight-' + name);
  await page.media('');
  const [w, h] = orientation === 'landscape' ? [841.92, 595.92] : [595.92, 841.92];
  assert.equal(r.pages, pages, `${name}: ${r.pages} PDF pages`);
  assert.ok(
    Math.abs(r.width - w) < 2 && Math.abs(r.height - h) < 2,
    `${name}: page ${r.width}×${r.height} pt, expected A4 ${orientation}`,
  );
  return r;
}
/** Hovers (x, y) and returns the snap tip's name once the tip shows this cursor position. Mouse
 *  moves are handled on the next animation frame and then rendered by React, so right after another
 *  interaction (e.g. the name prompt closing) the tip can still show the previous hover for a while:
 *  wait until the tip sits at this position (it is drawn 16 px right of the cursor) instead of
 *  reading it after a fixed delay. */
async function hoverSnap(x, y) {
  await hover(x, y);
  const r = await page.waitFor(
    (x, y) => {
      const tip = document.querySelector('[data-testid=snap-tip]');
      if (!tip) return null;
      const c = document.querySelector('.pgf-map-canvas').getBoundingClientRect();
      if (
        Math.abs(parseFloat(tip.style.left) - (x - c.left + 16)) > 1 ||
        Math.abs(parseFloat(tip.style.top) - (y - c.top + 14)) > 1
      )
        return null;
      return { name: tip.querySelector('b')?.textContent || '' };
    },
    { args: [x, y], timeout: 5000 },
  );
  return r.name;
}
const flightId = () => page.eval(() => location.pathname.split('/')[2]);
const waitSaved = () =>
  page.waitFor(() => document.querySelector('[data-testid=save-state]')?.textContent === 'Saved', { timeout: 15000 });
const text = (sel) => page.eval((s) => document.querySelector(s)?.textContent ?? null, sel);

test('plan a flight end to end: map, panels, navlog, exports, W&B and performance', { timeout: 240000 }, async () => {
  // ---- pilot profile, hangar (SX-ASV from the seed), one passenger: through the API
  const [asv] = fleetSeed().filter((a) => a.registration === 'SX-ASV');
  const ac = await api('POST', 'aircraft', asv);
  await api('PUT', 'me', {
    fullName: 'Test Pilot',
    phone: '+30 690 000 0000',
    homeAerodrome: 'LGTT',
    weightKg: 80,
    relation: 'AM-001',
    idType: 'ID',
    idNumber: 'AB 123456',
    nationality: 'GR',
    defaultAircraftId: null,
    settings: { taxiOutMin: 15, taxiInMin: 15, reserveMin: 60 },
  });
  const pax = await api('POST', 'passengers', {
    fullName: 'Maria Papadopoulou',
    phone: '+30 690 111 2222',
    dateOfBirth: '1990-04-02',
    weightKg: 62,
    idType: 'ID',
    idNumber: 'AK 765432',
    nationality: 'GR',
    relation: 'Guest',
    notes: '',
  });

  // ---- 1. lobby → new flight → editor
  await page.goto(server.url + '/');
  await page.waitFor(() => !!document.querySelector('[data-testid=new-flight]'));
  await page.click('[data-testid=new-flight]');
  await page.waitFor(
    () => /^\/flights\/[\w-]+$/.test(location.pathname) && !!document.querySelector('[data-testid=editor]'),
  );
  await page.waitFor(() => document.querySelector('[data-testid=map]')?.dataset.ready === '1', { timeout: 20000 });
  const id = await flightId();
  assert.equal(await text('[data-testid=flight-title]'), 'LGTT → LGTT');

  // frame the area of the route
  await page.eval(() => {
    const m = document.querySelector('.pgf-map-canvas').__pgfMap;
    m.fitBounds(
      [
        [23.3, 37.94],
        [23.85, 38.21],
      ],
      { padding: 60, animate: false },
    );
  });
  await sleep(600);

  // ---- 2. remove the default LGTT → LGTT points: select a point, Backspace
  for (let i = 0; i < 2; i++) {
    const p = await mapPx(LGTT.lat, LGTT.lon);
    await clickAt(p.x, p.y);
    await page.key('Backspace');
    await sleep(200);
  }
  await page.waitFor(() => document.querySelectorAll('[data-testid=leg-label]').length === 0);
  let f = await api('GET', `flights/${id}`);
  // the map starts drawing when the route has fewer than 2 points
  if (
    !(await page.eval(() => document.querySelector('[data-testid=map-draw]')?.getAttribute('aria-pressed') === 'true'))
  )
    await page.key('d');

  // LGTT: click 6 px off the aerodrome: it snaps
  let p = await mapPx(LGTT.lat, LGTT.lon);
  assert.match(await hoverSnap(p.x + 5, p.y - 4), /LGTT/);
  await clickAt(p.x + 5, p.y - 4);
  // ABLONAS (VFR point)
  p = await mapPx(ABLONAS.lat, ABLONAS.lon);
  assert.match(await hoverSnap(p.x - 4, p.y + 5), /ABLONAS/);
  await clickAt(p.x - 4, p.y + 5);
  await shot('1-drawing');
  // custom point ZOFRI: Shift-click, name it
  p = await mapPx(ZOFRI.lat, ZOFRI.lon);
  await clickAt(p.x, p.y, { modifiers: 8 });
  await page.waitFor(() => !!document.querySelector('[data-testid=name-prompt] input'));
  await page.type('[data-testid=name-prompt] input', 'zofri');
  await page.key('Enter');
  await page.waitFor(() => !document.querySelector('[data-testid=name-prompt]'));
  // LGMG (aerodrome; the MEGARA reporting point shares its position: the aerodrome wins)
  p = await mapPx(LGMG.lat, LGMG.lon);
  assert.match(await hoverSnap(p.x + 6, p.y + 3), /LGMG|MEGARA/);
  await clickAt(p.x + 6, p.y + 3);
  await page.key('Enter'); // stop drawing
  await page.waitFor(() => document.querySelectorAll('[data-testid=leg-label]').length === 3);
  await waitSaved();
  f = await api('GET', `flights/${id}`);
  assert.deepEqual(
    f.route.map((r) => [r.kind, r.refId, r.name]),
    [
      ['aerodrome', 'LGTT', 'LGTT'],
      ['vfr', 'LGAV/ABLONAS', 'ABLONAS'],
      ['custom', null, 'ZOFRI'],
      ['aerodrome', 'LGMG', 'LGMG'],
    ],
  );
  // snapped points take the reference position exactly; the custom point is where we clicked (± 1 px)
  assert.deepEqual([f.route[0].lat, f.route[0].lon], [LGTT.lat, LGTT.lon]);
  assert.deepEqual([f.route[1].lat, f.route[1].lon], [ABLONAS.lat, ABLONAS.lon]);
  assert.deepEqual([f.route[3].lat, f.route[3].lon], [LGMG.lat, LGMG.lon]);
  assert.ok(O.haversineNm(f.route[2], ZOFRI) < 0.2, 'ZOFRI placed where clicked');

  // leg labels: magnetic course and distance (read-only), altitude (editable)
  const labels = await page.eval(() =>
    [...document.querySelectorAll('[data-testid=leg-label]')].map((e) => ({ key: e.dataset.leg, text: e.textContent })),
  );
  assert.equal(labels.length, 3);
  const legKey = (a, b) => `${a.uid}>${b.uid}`;
  const keys = [0, 1, 2].map((i) => legKey(f.route[i], f.route[i + 1]));
  for (let i = 0; i < 3; i++) {
    const l = labels.find((x) => x.key === keys[i]);
    assert.ok(l, 'label for leg ' + i);
    const dist = O.haversineNm(f.route[i], f.route[i + 1]);
    const m = /(\d{3})°\s*([\d.]+)\s*NM/.exec(l.text);
    assert.ok(m, `label "${l.text}" shows course and distance`);
    assert.ok(
      Math.abs(+m[2] - dist) <= (dist >= 10 ? 0.5 : 0.05) + 1e-9,
      `label distance ${m[2]} vs ${dist.toFixed(2)}`,
    );
    const mcOracle = O.course(f.route[i], f.route[i + 1]) - 5.2; // WMM2025 ≈ 5.2°E around Athens (unit-tested vs NOAA)
    const dmc = Math.abs(((+m[1] - mcOracle + 540) % 360) - 180);
    assert.ok(dmc <= 1.5, `label course ${m[1]} vs ${mcOracle.toFixed(1)}`);
  }

  // edit the altitude of ABLONAS → ZOFRI on the map
  await page.eval((k) => document.querySelector(`[data-leg="${k}"] [data-testid=leg-alt]`).scrollIntoView(), keys[1]);
  await page.click(`[data-leg="${keys[1]}"] [data-testid=leg-alt]`);
  await page.waitFor(() => !!document.querySelector('[data-testid=leg-alt-input]'));
  await page.type('[data-testid=leg-alt-input]', '4500');
  await page.key('Enter');
  await page.waitFor((k) => /(^|\D)4500(\D|$)/.test(document.querySelector(`[data-leg="${k}"]`)?.textContent || ''), {
    args: [keys[1]],
  });
  await waitSaved();
  f = await api('GET', `flights/${id}`);
  assert.equal(f.legOverrides[keys[1]].altFt, 4500);
  await shot('2-route');
  // hovering an aerodrome shows its hours on the flight's date
  p = await mapPx(LGMG.lat, LGMG.lon);
  await hover(p.x, p.y);
  await page.waitFor(() => /LGMG/.test(document.querySelector('[data-testid=aerodrome-tip]')?.textContent || ''), {
    timeout: 5000,
  });
  assert.match(await text('[data-testid=aerodrome-tip-hours]'), /HO: hours published by NOTAM/);
  await hover(p.x + 200, p.y + 150);

  // ---- 3. date and block-off, aircraft, fuel on board (PIC alone first: club case 60)
  await setValue('[data-testid=flight-date]', DATE);
  await page.type('[data-testid=block-off]', BLOCK_OFF);
  await page.blur();
  await page.select('[data-testid=aircraft-select]', ac.id);
  await page.waitFor(() => !!document.querySelector('[data-testid=fob]'));
  await page.type('[data-testid=fob]', '144');
  await page.key('Enter');
  await page.blur();
  await waitSaved();
  f = await api('GET', `flights/${id}`);
  assert.equal(f.date, DATE);
  assert.equal(f.blockOff, BLOCK_OFF);
  assert.equal(f.aircraftId, ac.id);
  assert.equal(f.fobL, 144);
  assert.deepEqual(
    f.crew.map((c) => [c.role, c.seat, c.snapshot.fullName, c.snapshot.weightKg]),
    [['PIC', f.crew[0].seat, 'Test Pilot', 80]],
  );
  await page.waitFor(() => document.querySelectorAll('[data-testid=navlog-row]').length === 3, { timeout: 15000 });
  // aerodrome hours on the flight's date: LGTT HJ (AIP AD 1.6.5.3), no handling
  await page.waitFor(() => document.querySelectorAll('[data-testid=aerodrome-hours-item]').length === 2);
  assert.deepEqual(
    await page.eval(() =>
      [...document.querySelectorAll('[data-testid=aerodrome-hours-item]')].map((e) => e.dataset.icao),
    ),
    ['LGTT', 'LGMG'],
  );
  assert.match(
    await text('[data-testid=aerodrome-hours-item][data-icao=LGTT] [data-testid=ad-hours-day]'),
    /Open \d\d:\d\d–\d\d:\d\dZ \(HJ\)/,
  );
  assert.match(
    await text('[data-testid=aerodrome-hours-item][data-icao=LGTT] [data-testid=ad-hours-handling]'),
    /Closed \(NIL\)/,
  );
  // a click on an aerodrome off the route (LGEL) opens its hours
  const lgel = AD('LGEL');
  p = await mapPx(lgel.lat, lgel.lon);
  await clickAt(p.x, p.y);
  await page.waitFor(() => /LGEL/.test(document.querySelector('[data-testid=aerodrome-pop]')?.textContent || ''), {
    timeout: 5000,
  });
  assert.match(await text('[data-testid=aerodrome-pop] [data-testid=ad-hours-handling]'), /HJ|Open|Closed/);
  await page.eval(() => document.querySelector('[data-testid=section-aerodromes]').scrollIntoView());
  await shot('3b-aerodromes');
  await page.key('Escape');
  await page.waitFor(() => !document.querySelector('[data-testid=aerodrome-pop]'));
  await shot('3-panels');

  // ---- 6a. take-off performance at LGTT against the club calculator (case 60). The old
  // /export/performance link redirects to the merged W&B and performance export.
  await page.goto(`${server.url}/flights/${id}/export/performance`);
  await page.waitFor(
    () =>
      location.pathname.endsWith('/export/wbperf') &&
      document.querySelector('[data-testid=wbperf-export]')?.dataset.ready === 'true',
    { timeout: 20000 },
  );
  await sleep(300);
  const perfRow = (phase, key) =>
    page.eval(
      (ph, k) => document.querySelector(`[data-testid=perf-${ph}] tr[data-row="${k}"] td`)?.textContent.trim() ?? null,
      phase,
      key,
    );
  const club60 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/club-wbp-cases.json'), 'utf8')).cases[60];
  assert.equal(club60.input.RWY, '03');
  // documented differences (tests/unit/calc/club.test.ts): SX-ASV empty mass 691.2 (2024 weighing) vs the
  // club's 691.0, fuel arm 1.215 vs 1.21539; slope 1.92 % from the AIP thresholds vs the club's 2 % (×1.096 vs ×1.10)
  assert.equal(await perfRow('takeoff', 'mass'), `${(club60.club.takeoff.massKg + 0.2).toFixed(1)} kg`);
  assert.equal(await perfRow('takeoff', 'rwy'), '03');
  assert.equal(await perfRow('takeoff', 'head'), '5 kt');
  const todr = parseFloat(await perfRow('takeoff', 'todr')),
    torr = parseFloat(await perfRow('takeoff', 'torr'));
  assert.ok(
    Math.abs(todr / club60.club.takeoff.todrM - 1) <= 0.03,
    `TODR ${todr} vs club ${club60.club.takeoff.todrM}`,
  );
  assert.ok(
    Math.abs(torr / club60.club.takeoff.torrM - 1) <= 0.03,
    `TORR ${torr} vs club ${club60.club.takeoff.torrM}`,
  );
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=wbperf-export]').dataset.perfVerdict),
    'pass',
  );
  await page.eval(() => document.querySelector('.perf-sheet').scrollIntoView());
  await page.screenshot('flight-export-performance');

  // ---- 3b. back in the editor: add the passenger by type-ahead, seat her rear left
  await page.goto(`${server.url}/flights/${id}`);
  await page.waitFor(() => !!document.querySelector('[data-testid=pax-search]'));
  await page.type('[data-testid=pax-search]', 'mari');
  await sleep(200);
  await page.key('Enter');
  await page.waitFor(() => !!document.querySelector('[data-testid=crew-pax]'));
  const rearLeft = await page.eval(
    () =>
      [...document.querySelector('[data-testid=crew-pax] [data-testid=crew-seat]').options].find((o) =>
        /rear left/i.test(o.textContent),
      )?.value,
  );
  assert.ok(rearLeft, 'the aircraft has a rear left seat');
  await page.select('[data-testid=crew-pax] [data-testid=crew-seat]', rearLeft);
  await waitSaved();
  f = await api('GET', `flights/${id}`);
  assert.deepEqual(
    f.crew.map((c) => [c.role, c.passengerId, c.seat, c.snapshot.weightKg]),
    [
      ['PIC', null, f.crew[0].seat, 80],
      ['PAX', pax.id, rearLeft, 62],
    ],
  );
  // manifest rows line up: role tags, seat selects and the reset buttons share their columns; edit sits by the name
  const cols = await page.eval(() =>
    [...document.querySelectorAll('[data-testid=manifest] > li')].map((li) => {
      const x = (sel) => Math.round(li.querySelector(sel).getBoundingClientRect().left);
      const name = li.querySelector('.ep-crew-fullname').getBoundingClientRect();
      const edit = li.querySelector('[data-testid$=-edit]').getBoundingClientRect();
      return [
        x('.ep-role'),
        Math.round(li.querySelector('.ep-role').getBoundingClientRect().width),
        x('[data-testid=crew-seat]'),
        x('.ep-row-actions button'),
        Math.round(edit.left - name.right) < 12,
      ];
    }),
  );
  assert.equal(cols.length, 2);
  assert.deepEqual(cols[0], cols[1]);
  assert.equal(cols[0][4], true);
  await page.waitFor(() => document.querySelectorAll('[data-testid=navlog-row]').length === 3, { timeout: 15000 });
  await sleep(500);
  await shot('4-editor');
  // ---- 4. navlog: the editor's strip and the MD 4.2 sheet against the independent oracle
  const strip = await page.eval(() =>
    [...document.querySelectorAll('[data-testid=navlog-row]')].map((r) =>
      [...r.cells].map((c) => c.textContent.trim()),
    ),
  );
  const num = (t) => +t.replace('\u2212', '-').replace('+', '');
  const alts = strip.map((r) => +r[1]);
  assert.deepEqual(
    strip.map((r) => +r[2]),
    [80, 92, 80],
    'pattern TAS on the first and last legs, cruise between',
  );
  assert.equal(alts[1], 4500, 'the altitude set on the map');
  assert.equal(alts[2], 1000, 'pattern altitude into LGMG (elevation 12 ft)');
  // variation: TC − MC (WMM2025 ≈ 5.2°E here; the model itself is unit-tested against NOAA's test values)
  for (const r of strip) assert.equal((num(r[3]) - num(r[4]) + 360) % 360, 5);
  const winds = strip.map((r) => r[5].split('/').map(Number));
  const legsIn = [0, 1, 2].map((i) => ({
    a: f.route[i],
    b: f.route[i + 1],
    alt: alts[i],
    tas: +strip[i][2],
    wd: winds[i][0],
    ws: winds[i][1],
  }));
  const card = O.CARDS['SX-ASV']['Magnetic compass'];
  const exp = O.navlog(legsIn, { variation: 5.2, card, flow: 30, extra: 4 });
  // times: take-off = block-off + taxi; each leg's wind at its altitude and mid-leg time
  const d0 = Date.parse(DATE + 'T00:00:00Z');
  let t = blockOffMs + 15 * 60000;
  for (let i = 0; i < 3; i++) {
    const L = legsIn[i];
    const minExact = (O.haversineNm(L.a, L.b) / exp.rows[i].gs) * 60;
    const w = O.windAt(windFn, L.alt, (t + (minExact / 2) * 60000 - d0) / 3600000);
    assert.ok(
      Math.abs(((L.wd - w.dir + 540) % 360) - 180) <= 2 && Math.abs(L.ws - w.spd) <= 1,
      `leg ${i} wind ${L.wd}/${L.ws} vs ${w.dir.toFixed(0)}/${w.spd.toFixed(1)}`,
    );
    assert.ok(Math.abs(parseFloat(strip[i][6]) - w.temp) <= 1, `leg ${i} temperature`);
    t += minExact * 60000;
    const c = exp.cells[i],
      r = strip[i];
    assert.deepEqual(
      [r[3], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[15]],
      [c.tc, c.wca, c.mh, c.dev, c.ch, c.gs, c.dist, O.legTime(exp.rows[i].ete), c.fuel],
      `strip leg ${i}`,
    );
  }
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
  const landing = strip[2][14];
  assert.ok([hhmm(t - 60000), hhmm(t), hhmm(t + 60000)].includes(landing), `landing ${landing} vs ${hhmm(t)}`);
  assert.equal(await text('[data-testid=fuel-required]'), `${exp.totals.fuel} L`);

  await page.goto(`${server.url}/flights/${id}/export/navlog`);
  await page.waitFor(() => document.querySelector('[data-testid=navlog-export]')?.dataset.ready === 'true', {
    timeout: 20000,
  });
  assert.equal(await page.eval(() => document.querySelector('[data-testid=navlog-export]').dataset.sheets), '1');
  const cells = await page.eval(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.md42 .tbl > div')].map((d) => [
        d.style.gridArea.split(' / ').slice(0, 2).join(','),
        d.textContent.trim(),
      ]),
    ),
  );
  for (let i = 0; i < 3; i++) {
    const r = 4 + 2 * i,
      c = exp.cells[i],
      at = (row, col) => cells[`${row},${col}`];
    assert.deepEqual(
      [
        at(r, 1),
        at(r, 2),
        at(r, 3),
        at(r, 4),
        at(r, 6),
        at(r, 7),
        at(r, 8),
        at(r + 1, 8),
        at(r, 9),
        at(r + 1, 9),
        at(r, 11),
        at(r, 12),
        at(r + 1, 12),
        at(r, 13),
        at(r, 14),
        at(r + 1, 14),
        at(r, 16),
      ],
      [
        c.tc,
        String(alts[i]),
        String(winds[i][0]),
        String(winds[i][1]),
        String(legsIn[i].tas),
        c.wca,
        c.th,
        c.var,
        c.mh,
        c.dev,
        c.ch,
        c.dist,
        c.rem,
        c.gs,
        c.ete,
        c.ate,
        c.fuel,
      ],
      `MD 4.2 leg ${i}`,
    );
  }
  assert.equal(cells['5,10'], 'ABLONAS');
  assert.equal(cells['9,10'], 'LGMG');
  assert.equal(cells['22,12'], String(exp.totals.dist));
  assert.equal(cells['22,14'], O.legTime(exp.totals.ete));
  assert.equal(cells['22,16'], String(exp.totals.fuel));
  const sunset = O.sunsetMinutes(DATE, LGMG.lat, LGMG.lon);
  const shownSunset = /SUNSET (\d\d):(\d\d)Z/.exec(cells['22,17']);
  assert.ok(
    shownSunset && Math.abs(+shownSunset[1] * 60 + +shownSunset[2] - sunset) <= 2,
    `sunset ${cells['22,17']} vs ${sunset.toFixed(1)} min`,
  );
  const hdr = await page.eval(() => [...document.querySelectorAll('.md42 .hdr > *')].map((e) => e.textContent.trim()));
  const after = (l) => hdr[hdr.indexOf(l) + 1];
  assert.equal(after('AIRCRAFT'), 'SX-ASV');
  assert.equal(after('BLOCK START'), BLOCK_OFF + 'Z');
  assert.equal(after('WIND'), '03005KT');
  assert.equal(after('QNH'), '1013');
  assert.equal(after('RUNWAY'), '03');
  await page.screenshot('flight-export-navlog');
  await pdfCheck('navlog', 1, 'landscape');

  // ---- 5/6. W&B (MD 4.3): every row and total against an independent sum of mass × arm (the old
  // /export/wb link redirects to the merged export: loading sheet first, then performance)
  await page.goto(`${server.url}/flights/${id}/export/wb`);
  await page.waitFor(
    () =>
      location.pathname.endsWith('/export/wbperf') &&
      document.querySelector('[data-testid=wbperf-export]')?.dataset.ready === 'true',
    { timeout: 20000 },
  );
  const wb = Object.fromEntries(
    await page.eval(() =>
      [...document.querySelectorAll('[data-line]')].map((r) => [
        r.dataset.line,
        [...r.cells].slice(1).map((c) => c.textContent.trim()),
      ]),
    ),
  );
  const mb = asv.massBalance,
    arm = (id) => mb.stations.find((s) => s.id === id).armM;
  const fuelKg = 144 * asv.fuel.types[0].densityKgPerL,
    burnKg = (4 + exp.totals.trip) * asv.fuel.types[0].densityKgPerL;
  const rowsExp = {
    empty: [mb.emptyMassKg, mb.emptyMassKg * mb.emptyArmM],
    fuel: [fuelKg, fuelKg * arm('fuel')],
    front: [80, 80 * arm('front')],
    rear: [62, 62 * arm('rear')],
    bag1: [0, 0],
    bag2: [0, 0],
  };
  rowsExp.empty[1] = mb.emptyMomentKgM; // the weighing report's moment (719.12) is the one used
  const toM = Object.values(rowsExp).reduce((a, r) => [a[0] + r[0], a[1] + r[1]], [0, 0]);
  const ldgM = [toM[0] - burnKg, toM[1] - burnKg * arm('fuel')];
  const fmt = ([m, mo]) => [m.toFixed(1), mo.toFixed(2)];
  for (const [k, v] of Object.entries(rowsExp)) assert.deepEqual([wb[k][0], wb[k][2]], fmt(v), `W&B row ${k}`);
  assert.deepEqual([wb.to[0], wb.to[2]], fmt(toM), 'take-off total');
  assert.equal(wb.to[1], (toM[1] / toM[0]).toFixed(3), 'take-off CG');
  assert.deepEqual([wb.burn[0], wb.burn[2]], fmt([-burnKg, -burnKg * arm('fuel')]), 'fuel burn');
  assert.deepEqual([wb.ldg[0], wb.ldg[2]], fmt(ldgM), 'landing total');
  assert.equal(await page.eval(() => document.querySelector('[data-testid=wbperf-export]').dataset.wbVerdict), 'pass');
  assert.equal(
    await perfRow('landing', 'mass'),
    `${ldgM[0].toFixed(1)} kg`,
    'landing mass on MD 4.4 = W&B landing mass',
  );
  // one document: the loading sheet, then the performance log, each signed by the PIC
  assert.deepEqual(
    await page.eval(() =>
      [...document.querySelectorAll('.xp-sheet')].map((s) => (s.classList.contains('wb-sheet') ? 'wb' : 'perf')),
    ),
    ['wb', 'perf'],
  );
  const sigs = await page.eval(() =>
    [...document.querySelectorAll('.xp-sheet .xp-sigline')].map((l) => l.innerText.replace(/\s+/g, ' ').trim()),
  );
  assert.equal(sigs.length, 2);
  for (const t of sigs) assert.match(t, /T\. Pilot Electronically signed \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z/);
  await page.screenshot('flight-export-wb');
  await pdfCheck('wbperf', 2, 'portrait');

  // ---- 5. the other exports: key fields and print layout

  const pageText = () => page.eval(() => document.querySelector('[data-testid=export-page]').innerText);

  await page.goto(`${server.url}/flights/${id}/export/form731`);
  await page.waitFor(() => !!document.querySelector('[data-testid=form731]'));
  let tx = await pageText();
  assert.match(tx, new RegExp(`AIRPORT\\s*DEKELIA / TATOI \\(LGTT\\)\\s*DATE\\s*${DATE}`));
  assert.match(tx, /registration SX-ASV\s+and operating the route LGTT – LGMG/);
  assert.match(tx, /1\.\s+Test Pilot\s+PIC\s+AB 123456\s+\+30 690 000 0000/);
  assert.match(tx, /2\.\s+Maria Papadopoulou\s+PAX\s+AK 765432\s+\+30 690 111 2222/);
  await page.screenshot('flight-export-form731');
  await pdfCheck('form731', 1, 'landscape');

  await page.goto(`${server.url}/flights/${id}/export/gendec`);
  await page.waitFor(() => !!document.querySelector('[data-testid=gendec]'));
  tx = await pageText();
  assert.match(tx, /Registration: SXASV\s+Flight No\.: PVT\s+Date: \d{4}-\d{2}-\d{2}/);
  assert.match(tx, /Departure from: LGTT\s+\(Place\)\s+Arrival at: LGMG\s+\(Place\)/);
  // routing: origin with the PIC, the arrow, destination; no intermediate points
  assert.deepEqual(
    await page.eval(() =>
      [...document.querySelectorAll('.gd-routing tbody tr')]
        .slice(0, 3)
        .map((r) =>
          [...r.cells].map((c) => (c.querySelector('[data-testid=gendec-arrow]') ? '⇩' : c.textContent.trim())),
        ),
    ),
    [
      ['LGTT', 'TEST PILOT'],
      ['⇩', ''],
      ['LGMG', ''],
    ],
  );
  assert.doesNotMatch(await page.eval(() => document.querySelector('.gd-routing').innerText), /ABLONAS|ZOFRI/);
  assert.match(tx, /Departure place:\s+Embarking\s+1\s+Through on same flight\s+0\s+Arrival place:\s+Disembarking\s+1/);
  assert.ok(
    await page.eval(() => !!document.querySelector('[data-testid=gendec-nil]')),
    'Declaration of Health struck through NIL',
  );
  assert.match(tx, /If no disinsecting has been carried out during the flight/);
  // the PIC's e-signature on the declaration's signature line (as on Form 731)
  await page.waitFor(() => !!document.querySelector('.gd-sigline [data-testid=signature]'));
  assert.match(
    await page.eval(() => document.querySelector('.gd-sigline').innerText),
    /T\. Pilot\s*Electronically signed \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z/,
  );
  // who sends it: neither LGTT nor LGMG has a handler (AIP AD 1.6), so the PIC does; the per-flight override
  await page.waitFor(() => !!document.querySelector('[data-testid=gendec-handling-departure]'));
  assert.match(await text('[data-testid=gendec-handling-departure]'), /LGTT: no handling \(AIP AD 1\.6\.5\.4\)/);
  assert.match(await text('[data-testid=gendec-handling-destination]'), /LGMG: no handling \(AIP AD 1\.6\.18\.4\)/);
  assert.equal(await page.eval(() => document.querySelector('[data-testid=gendec-handled]').checked), false);
  await page.click('[data-testid=gendec-handled]');
  await page.waitFor(() => /^Handled/.test(document.querySelector('[data-testid=gendec-status]')?.textContent || ''));
  assert.equal((await api('GET', `flights/${id}`)).options.genDecHandled, true);
  await page.click('[data-testid=gendec-handled-auto]');
  await page.waitFor(
    () =>
      document.querySelector('[data-testid=gendec-handled]')?.checked === false &&
      !document.querySelector('[data-testid=gendec-handled-auto]'),
  );
  assert.equal((await api('GET', `flights/${id}`)).options.genDecHandled, null);
  await page.screenshot('flight-export-gendec');
  await pdfCheck('gendec', 1, 'portrait');

  await page.goto(`${server.url}/flights/${id}/export/fpl`);
  await page.waitFor(
    () => !!document.querySelector('[data-testid=fpl-message]') && !document.querySelector('.fpl-loading'),
    { timeout: 20000 },
  );
  const msg = await text('[data-testid=fpl-message]');
  const eet = O.hmm(exp.totals.ete).replace(':', '').padStart(4, '0');
  const end = O.hmm(Math.floor((144 / 30) * 60))
    .replace(':', '')
    .padStart(4, '0');
  // the route by point names in item 15 (as EuroFPL), not in RMK/
  const expected = [
    '(FPL-SXASV-VG',
    '-C172/L-S/C',
    `-LGTT${BLOCK_OFF.replace(':', '')}`,
    '-N0092VFR ABLONAS ZOFRI',
    `-LGMG${eet}`,
  ];
  assert.deepEqual(msg.split('\n').slice(0, 5), expected);
  // Item 18 without REG/ (it equals item 7), DOF/ last; item 19 follows, C/ = SURNAME INITIAL +CC NUMBER
  assert.match(msg, new RegExp(`DOF/${DATE.slice(2).replace(/-/g, '')}\\n-E/${end} P/002 `));
  assert.doesNotMatch(msg, /REG\/|VFR VIA|PIC TEL/);
  assert.match(msg, /C\/PILOT\s+T\s+\+30\s+6900000000\)$/);
  const endCells = await page.eval(
    () => document.querySelector('[data-testid=fpl-form] [aria-label=Endurance]').textContent,
  );
  assert.equal(endCells, end);
  assert.ok(
    msg.split('\n').every((l) => l.length <= 69),
    'AFTN lines of at most 69 characters',
  );
  // the form is signed by the PIC in FILED BY
  assert.ok(
    await page.eval(() => !!document.querySelector('[data-testid=fpl-filed-by] [data-testid=signature]')),
    'FILED BY e-signature',
  );
  await page.screenshot('flight-export-fpl');
  await pdfCheck('fpl', 1, 'portrait'); // the filled form on one page

  // a warning links to where it is fixed: the editor opens with the input focused and highlighted
  await page.goto(`${server.url}/flights/${id}?focus=blockOff`);
  await page.waitFor(
    () =>
      document.activeElement?.getAttribute('data-focus') === 'blockOff' &&
      document.activeElement.classList.contains('attention'),
    { timeout: 15000 },
  );
  await page.goto(`${server.url}/flights/${id}?focus=remarks`);
  await page.waitFor(
    () =>
      document.activeElement?.getAttribute('data-testid') === 'fpl-remarks' &&
      document.activeElement.classList.contains('attention'),
    { timeout: 15000 },
  );
  await shot('focus-remarks');
  await page.goto(`${server.url}/hangar/${ac.id}?focus=colours`);
  await page.waitFor(
    () =>
      document.activeElement?.closest('[data-focus=colours]') && document.activeElement.classList.contains('attention'),
    { timeout: 15000 },
  );

  // the lobby lists the flight with the navlog's totals (written by the editor as derived values)
  // the summary is saved by the editor in the background: poll until it matches the saved route
  // (distance: Σ rounded legs of the route as saved; time and fuel: the navlog's, ±1 for the winds
  // refetched since step 4)
  const distOf = (r) => r.slice(1).reduce((t, p, i) => t + Math.round(O.haversineNm(r[i], p)), 0);
  let ok = false;
  for (let k = 0; k < 40 && !ok; k++) {
    f = await api('GET', `flights/${id}`);
    ok =
      f.summary.distNm === distOf(f.route) &&
      Math.abs(f.summary.eteMin - exp.totals.ete) <= 1 &&
      Math.abs(f.summary.fuelL - exp.totals.fuel) <= 1;
    if (!ok) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(
    ok,
    `lobby summary ${JSON.stringify([f.summary.distNm, f.summary.eteMin, f.summary.fuelL])} vs route ${distOf(f.route)} NM, navlog ${exp.totals.ete} min ${exp.totals.fuel} L`,
  );
  await page.goto(server.url + '/');
  await page.waitFor((id) => !!document.querySelector(`[data-flight-id="${id}"]`), { args: [id] });
  const row = await page.eval((id) => document.querySelector(`[data-flight-id="${id}"]`).innerText, id);
  assert.match(row, /LGTT → LGMG/);
  assert.match(row, new RegExp(`${exp.totals.dist} NM`));
  await shot('5-lobby');
  await page.goto(server.url + '/hangar');
  await page.waitFor(() => document.body.innerText.includes('SX-ASV'));
  await shot('6-hangar');
  await page.goto(`${server.url}/hangar/${ac.id}`);
  await page.waitFor(
    () => document.body.innerText.includes('Mass and balance') || document.body.innerText.includes('Mass & balance'),
  );
  await shot('7-aircraft');

  assert.deepEqual(page.errors, []);
  // forecasts came through the API (GET /api/weather/grid), which asked Open-Meteo for grid nodes
  assert.ok(
    openMeteoCalls.some((u) => u.includes('/v1/forecast')),
    'the API fetched the forecast',
  );
});
