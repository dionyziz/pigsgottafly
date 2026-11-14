// End-to-end tests: complete flight plans driven through the real UI in headless Chrome,
// every cell checked against an independent oracle, winds served by a mocked Open-Meteo.
// Run: node --test --test-concurrency=1 tests/e2e/
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launch, ARTIFACTS } from './harness.mjs';
import { menuItem, openRouteDialog, freshApp, pasteRoute, setAlts, setFlight, readSheet, v, terminalRows, chips, layoutAudit, windyUrl, expectWindFetch, gotoSheet, settings } from './app.mjs';
import * as O from './oracle.mjs';
import { decodePng } from './png.mjs';

const LGMG = { lat: 37.98139, lon: 23.36611 };
const LGEL = { lat: 38.06361, lon: 23.55583 };
const LGTS = { lat: 40.51972, lon: 22.97092 };
const DATE = '2026-11-17';
const UNIFORM = () => ({ dir: 250, spd: 12, temp: 8 });
// surface weather that changes with time, so the header proves which time it was sampled at
const SURFACE = ({ hour }) => ({ temp: 10 + hour / 2, dew: 8, dir: 230, spd: 6 + hour / 4, low: 25, mid: 0, high: 0 });
const surfAt = (hour) => O.metar({ ...O.SURFACE_DEFAULT, ...SURFACE({ hour }) });
const BLANK_LEG_FIELDS = ['eta', 'ata', 'fuelrem', 'gsact', 'vfreq', 'vident', 'vbrg', 'vtofrom', 'sqk'];
const LEG_FIELDS = ['tc', 'alt', 'wd', 'ws', 'temp', 'tas', 'wca', 'th', 'var', 'mh', 'dev', 'ch', 'dist', 'rem', 'gs', 'ete', 'ate', 'fuel'];

let server, browser, page;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); server.close(); });
beforeEach(async () => { page = await browser.newPage(); });
afterEach(async (t) => {
  try { await page.screenshot('last-' + t.name.replace(/\W+/g, '-').slice(0, 60), { fullPage: false }); } catch { /* ignore */ }
  const errors = page.errors.slice();
  await page.close();
  assert.deepEqual(errors, [], 'no page errors / console errors');
});

const legsOf = (pts, alts, tas, wind) => pts.slice(0, -1).map((a, i) => ({ a, b: pts[i + 1], alt: alts[i], tas: tas[i], ...wind(i) }));
const defaultTas = (n) => Array.from({ length: n }, (_, i) => (i === 0 || i === n - 1 ? 80 : 92));

function assertLeg(sheet, i, exp, extra = {}) {
  const want = { ...exp, ...extra };
  for (const [f, val] of Object.entries(want)) assert.equal(v(sheet, `L${i}.${f}`), val, `leg ${i + 1} ${f}`);
}
async function assertCleanLayout(label, { print = false } = {}) {
  const issues = await layoutAudit(page);
  assert.deepEqual(issues, [], `${label}: layout issues`);
  if (print) {
    await page.media('print');
    await page.idle(200);
    const p = await layoutAudit(page);
    await page.media('');
    await page.idle(200);
    assert.deepEqual(p, [], `${label} (print): layout issues`);
  }
}

// ------------------------------------------------------------------------------------------------
test('complete flight plan: every cell, terminal info, notes, totals, sunset, print', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM, { surfaceFn: SURFACE }));
  const pts = [LGMG, LGEL, { lat: 38.25, lon: 23.40 }, { lat: 38.10, lon: 23.20 }, LGMG];
  const alts = [2000, 3500, 4500, 2500];
  await setFlight(page, { block: '09:30' });
  await pasteRoute(page, windyUrl(pts, DATE, 9), 5);
  await setAlts(page, alts);
  await page.idle(200);
  const s = await readSheet(page);

  const tas = defaultTas(4);
  assert.deepEqual(tas, [80, 92, 92, 80]);
  const exp = O.navlog(legsOf(pts, alts, tas, () => ({ wd: 250, ws: 12 })), { card: O.CARDS['SX-ASV']['Magnetic compass'] });
  exp.cells.forEach((c, i) => {
    assertLeg(s, i, c, { alt: String(alts[i]), wd: '250', ws: '12', temp: '8', tas: String(tas[i]) });
    for (const f of BLANK_LEG_FIELDS) assert.equal(v(s, `L${i}.${f}`), '', `leg ${i + 1} ${f} blank`);
  });
  assert.equal(v(s, 'L3.rem'), '0');
  assert.equal(v(s, 'L3.ate'), '0:00');
  for (let i = 4; i < 9; i++) for (const f of [...LEG_FIELDS, ...BLANK_LEG_FIELDS]) assert.equal(v(s, `L${i}.${f}`), '', `unused row ${i + 1} ${f}`);
  assert.equal(s['L1.alt'].user, true, 'typed altitude marked as typed');
  assert.equal(s['L1.tc'].user, false);

  assert.equal(v(s, 'T.dist'), String(exp.totals.dist));
  assert.equal(v(s, 'T.ete'), O.hmm(exp.totals.ete));
  assert.equal(v(s, 'T.fuel'), String(exp.totals.fuel));
  assert.equal(exp.totals.fuel, exp.totals.trip + 4);
  const ss = v(s, 'T.sunset').match(/^SUNSET (\d\d):(\d\d)Z$/);
  assert.ok(ss, 'sunset format');
  // AIP GEN 2.7, LGMG table, 17 November: SS 15:13
  assert.equal(v(s, 'T.sunset'), 'SUNSET 15:13Z');
  const want = O.sunsetMinutes(DATE, LGMG.lat, LGMG.lon);
  assert.ok(Math.abs(+ss[1] * 60 + +ss[2] - want) <= 2, `AIP table agrees with an independent computation: ${v(s, 'T.sunset')} vs ${want.toFixed(1)} min`);

  assert.equal(v(s, 'H.date'), DATE);
  assert.equal(v(s, 'H.aircraft'), 'SX-ASV');
  assert.equal(v(s, 'H.blockstart'), '09:30Z');
  for (const k of ['H.takeoff', 'H.blockend', 'H.atis']) assert.equal(v(s, k), '', k);
  assert.equal(v(s, 'H.qnh'), '1013', 'QNH from forecast sea-level pressure');
  // surface wind 230° true = 225° magnetic at LGMG (08R/26L): runway 26L has the headwind
  assert.equal(v(s, 'H.runway'), '26L');
  // single sheet: TEMP / WIND / SKY of the departure field at block start (09:30Z)
  const dep = surfAt(9.5);
  assert.deepEqual([v(s, 'H.temp'), v(s, 'H.wind'), v(s, 'H.sky')], [dep.temp, dep.wind, dep.sky]);
  assert.deepEqual([dep.temp, dep.wind, dep.sky], ['15/08', '23008KT', 'FEW027'], 'sanity of the oracle values');
  assert.equal(await page.eval(() => [...document.querySelectorAll('.pgno')].map((e) => e.textContent).join()), '1');
  assert.deepEqual(['dep', 'cp0', 'cp1', 'cp2', 'cp3', 'cp4', 'arr'].map((k) => v(s, k)), ['LGMG', 'LGEL', 'WP2', 'WP3', 'LGMG', '', 'LGMG']);

  const rows = await terminalRows(page);
  assert.deepEqual(rows[0], { id: 'ad-LGMG', field: 'LGMG', elev: '12', rwy: '08R / 26L', freq: 'TWR 130.875 122.100' });
  assert.deepEqual(rows.find((r) => r.field === 'LGEL'), { id: 'ad-LGEL', field: 'LGEL', elev: '144', rwy: '18 / 36', freq: 'TWR 120.150 133.825' });
  assert.deepEqual(rows.find((r) => r.field === 'ATHINAI TMA'), { id: 'as-ATHINAI-TMA', field: 'ATHINAI TMA', elev: '', rwy: '', freq: 'INFO 124.025 131.175 · APP 126.575 130.025' });
  assert.ok(rows.some((r) => r.field === 'TANAGRA MTMA' && r.freq === 'APP 120.250'));
  const real = rows.filter((r) => r.field);
  assert.deepEqual(real[real.length - 1], { id: 'fis', field: 'FIS', elev: '', rwy: '', freq: 'ATHINAI/MAKEDONIA INFO 130.925 130.700 119.750' });
  assert.equal(rows.filter((r) => r.field.startsWith('LGMG')).length, 1, 'round trip lists LGMG once');
  assert.ok(!rows.some((r) => r.field.startsWith('LGAV')), 'distant aerodromes not listed');

  assert.equal(v(s, 'notes'), 'Taxi fuel 4 L');
  assert.deepEqual((await chips(page)).map((c) => [c.kind, c.text]), [['ok', 'Winds ✓']]);

  const req = new URL(page.requests[page.requests.length - 1]);
  assert.equal(req.searchParams.get('models'), 'ecmwf_ifs025');
  assert.equal(req.searchParams.get('start_date'), DATE);
  assert.equal(req.searchParams.get('end_date'), '2026-11-18');
  assert.equal(req.searchParams.get('wind_speed_unit'), 'kn');
  const lats = req.searchParams.get('latitude').split(',').map(Number), lons = req.searchParams.get('longitude').split(',').map(Number);
  pts.slice(0, -1).forEach((a, i) => { const m = O.midpoint(a, pts[i + 1]); assert.ok(Math.abs(lats[i] - m.lat) < 2e-4 && Math.abs(lons[i] - m.lon) < 2e-4, `midpoint ${i}`); });

  assert.equal(await page.eval(() => document.querySelector('#btn-open-windy').href.includes('37.9814,23.3661;38.0636,23.5558;38.2500,23.4000')), true);

  for (const [w, h] of [[1600, 1000], [1280, 720], [1920, 1080], [1024, 700]]) {
    await page.viewport(w, h); await page.idle(150);
    await assertCleanLayout(`${w}x${h}`);
    await page.screenshot(`flight-${w}x${h}`, { fullPage: false });
  }
  await assertCleanLayout('print', { print: true });
  const pdf = await page.pdf('flight');
  assert.equal(pdf.pages, 1);
  assert.ok(Math.abs(pdf.width - 841.9) < 2 && Math.abs(pdf.height - 595.3) < 2, `A4 landscape, got ${pdf.width}x${pdf.height}`);

  await page.reload();
  await page.waitFor(() => document.body.dataset.wx === 'ok');
  await page.idle(150);
  assert.deepEqual(await readSheet(page), s, 'everything survives a reload');
});

// ------------------------------------------------------------------------------------------------
test('winds are interpolated in height and in time, including after midnight', async () => {
  const dirs = { 1000: 180, 925: 220, 850: 260, 700: 300, 600: 320 }, temps = { 1000: 15, 925: 10, 850: 5, 700: -2, 600: -8 };
  const fn = ({ level, hour }) => ({ dir: dirs[level], spd: 5 + hour, temp: temps[level] });
  await freshApp(page, server, O.openMeteoResponder(fn));
  const pts = [LGMG, { lat: 38.30, lon: 23.10 }, LGMG];
  const alts = [3000, 5500];
  await setFlight(page, { block: '23:40' });
  await pasteRoute(page, windyUrl(pts, DATE, 23), 3);
  await setAlts(page, alts);
  await page.idle(200);
  const s = await readSheet(page);

  // oracle timeline: start = block + 10 min; winds at mid-leg time; iterate to a fixed point
  const tas = [80, 80];
  let mins = [20, 20], winds;
  for (let it = 0; it < 30; it++) {
    let t = 23 * 60 + 40 + 10;
    winds = alts.map((alt, i) => { const mid = t + mins[i] / 2; const w = O.windAt(fn, alt, mid / 60, 0, 0); t += mins[i]; return w; });
    const exp = O.navlog(legsOf(pts, alts, tas, (i) => ({ wd: Math.round(winds[i].dir) % 360 || 360, ws: Math.round(winds[i].spd) })));
    mins = exp.rows.map((r) => r.min);
  }
  const exp = O.navlog(legsOf(pts, alts, tas, (i) => ({ wd: Math.round(winds[i].dir) % 360 || 360, ws: Math.round(winds[i].spd) })), { card: O.CARDS['SX-ASV']['Magnetic compass'] });
  exp.cells.forEach((c, i) => assertLeg(s, i, c, {
    wd: O.hdg(winds[i].dir), ws: String(Math.round(winds[i].spd)), temp: String(Math.round(winds[i].temp)),
  }));
  // the second leg is flown after midnight: its wind must come from the next day's data, not the last hour of the first day
  assert.ok(winds[1].spd > O.windAt(fn, alts[1], 23.99).spd, 'mid-leg time is after midnight');
  assert.notEqual(v(s, 'L1.ws'), String(Math.round(O.windAt(fn, alts[1], 23).spd)), 'not clamped to 23Z');
  assert.notEqual(v(s, 'L0.wd'), v(s, 'L1.wd'), 'different altitudes give different winds');
});

// ------------------------------------------------------------------------------------------------
test('SX-ASG: magnetic and GMU deviation cards, expiry reminders', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  const pts = [LGMG, { lat: 38.20, lon: 23.70 }, { lat: 37.80, lon: 23.90 }, { lat: 37.85, lon: 23.30 }, LGMG];
  const alts = [2500, 3500, 3500, 2500];
  await setFlight(page, { block: '10:00', aircraft: 'SX-ASG' });
  await pasteRoute(page, windyUrl(pts, DATE, 10), 5);
  await setAlts(page, alts);
  let s = await readSheet(page);
  const legs = legsOf(pts, alts, defaultTas(4), () => ({ wd: 250, ws: 12 }));
  O.navlog(legs, { card: O.CARDS['SX-ASG']['Magnetic compass'] }).cells.forEach((c, i) => assertLeg(s, i, c));
  assert.equal(v(s, 'H.aircraft'), 'SX-ASG');
  assert.deepEqual((await chips(page)).map((c) => [c.kind, c.text]), [['ok', 'Winds ✓'], ['warn', 'Card exp. 2027-02-06']]);
  assert.match((await chips(page))[1].tip, /81 days left/);
  assert.match(v(s, 'notes'), /\nCompass swing due: card expires 2027-02-06$/);

  await setFlight(page, { card: 'GMU (G1000 heading)' });
  s = await readSheet(page);
  const gmu = O.navlog(legs, { card: O.CARDS['SX-ASG']['GMU (G1000 heading)'] });
  gmu.cells.forEach((c, i) => assertLeg(s, i, c));
  assert.ok(gmu.cells.some((c, i) => c.dev !== O.navlog(legs, { card: O.CARDS['SX-ASG']['Magnetic compass'] }).cells[i].dev), 'cards differ on this route');
  assert.equal(await page.eval(() => document.querySelector('#card-info').textContent), 'Swung 2025-02-06 · valid to 2027-02-06');

  await expectWindFetch(page, () => page.type('#date', '2027-03-01'));
  s = await readSheet(page);
  assert.equal(v(s, 'H.date'), '2027-03-01');
  assert.deepEqual((await chips(page)).map((c) => [c.kind, c.text]), [['ok', 'Winds ✓'], ['err', 'Compass card expired']]);
  assert.match(v(s, 'notes'), /Compass card expired 2027-02-06/);

  await page.type('#date', '2027-02-30');
  assert.equal(await page.eval(() => document.querySelector('#date').classList.contains('invalid')), true);
  assert.equal(v(await readSheet(page), 'H.date'), '2027-03-01', 'invalid date is ignored');

  await setFlight(page, { aircraft: 'SX-ASV' });
  s = await readSheet(page);
  O.navlog(legs, { card: O.CARDS['SX-ASV']['Magnetic compass'] }).cells.forEach((c, i) => assertLeg(s, i, c));
  assert.deepEqual((await chips(page)).map((c) => c.text), ['Winds ✓']);
});

// ------------------------------------------------------------------------------------------------
test('typed aircraft without a card: DEV typed per leg, header editable', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  const pts = [LGMG, { lat: 38.10, lon: 23.60 }, LGMG];
  await setFlight(page, { block: '08:00', aircraft: 'OTHER', other: 'sx-xyz' });
  await pasteRoute(page, windyUrl(pts, DATE, 8), 3);
  await setAlts(page, [3000, 3000]);
  let s = await readSheet(page);
  assert.equal(v(s, 'H.aircraft'), 'SX-XYZ');
  const exp = O.navlog(legsOf(pts, [3000, 3000], [80, 80], () => ({ wd: 250, ws: 12 })));
  exp.cells.forEach((c, i) => assertLeg(s, i, { ...c, dev: '', ch: '' }));
  assert.ok((await chips(page)).some((c) => c.text === 'No DEV card'));

  await page.type('.sheet.active [data-key="L0.dev"]', '+3');
  await page.blur();
  s = await readSheet(page);
  assert.equal(v(s, 'L0.ch'), O.hdg(exp.rows[0].mh + 3));
  assert.equal(s['L0.dev'].user, true);
  assert.equal(v(s, 'L1.ch'), '');

  // typing a known registration in the sheet header switches aircraft and card
  await page.type('.sheet.active [data-key="H.aircraft"]', 'SX-ASV');
  await page.blur();
  assert.equal(await page.eval(() => document.querySelector('#aircraft').value), 'SX-ASV');
  s = await readSheet(page);
  assert.equal(v(s, 'L1.ch'), O.navlog(legsOf(pts, [3000, 3000], [80, 80], () => ({ wd: 250, ws: 12 })), { card: O.CARDS['SX-ASV']['Magnetic compass'] }).cells[1].ch);
});

// ------------------------------------------------------------------------------------------------
test('typing over computed cells cascades, and clearing restores', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  const pts = [LGMG, { lat: 38.25, lon: 23.40 }, { lat: 38.10, lon: 23.70 }, { lat: 37.90, lon: 23.60 }, LGMG];
  const alts = [2500, 3500, 3500, 2000];
  await setFlight(page, { block: '12:00' });
  await pasteRoute(page, windyUrl(pts, DATE, 12), 5);
  await setAlts(page, alts);
  const card = O.CARDS['SX-ASV']['Magnetic compass'];

  await page.type('.sheet.active [data-key="L0.wd"]', '090');
  await page.type('.sheet.active [data-key="L0.ws"]', '20');
  await page.type('.sheet.active [data-key="L1.tas"]', '100');
  await page.type('.sheet.active [data-key="H.qnh"]', '1013');
  await page.blur();
  let s = await readSheet(page);
  let exp = O.navlog(legsOf(pts, alts, [80, 100, 92, 80], (i) => (i === 0 ? { wd: 90, ws: 20 } : { wd: 250, ws: 12 })), { card });
  exp.cells.forEach((c, i) => assertLeg(s, i, c));
  assert.equal(v(s, 'T.ete'), O.hmm(exp.totals.ete));
  assert.equal(v(s, 'T.fuel'), String(exp.totals.fuel));
  assert.ok(s['L0.wd'].user && s['L0.ws'].user && s['L1.tas'].user && !s['L0.wca'].user);

  // typed ETE and fuel feed ATE and the totals
  await page.type('.sheet.active [data-key="L2.ete"]', '0:30');
  await page.type('.sheet.active [data-key="L3.fuel"]', '9');
  await page.blur();
  s = await readSheet(page);
  const etes = exp.rows.map((r, i) => (i === 2 ? 30 : r.ete));
  const fuels = exp.rows.map((r, i) => (i === 3 ? 9 : r.fuel));
  assert.equal(v(s, 'T.ete'), O.hmm(etes.reduce((a, b) => a + b)));
  assert.equal(v(s, 'L0.ate'), O.hmm(etes[1] + etes[2] + etes[3]));
  assert.equal(v(s, 'T.fuel'), String(fuels.reduce((a, b) => a + b) + 4));

  // clearing a typed cell restores the computed value
  await page.type('.sheet.active [data-key="L0.wd"]', '');
  await page.blur();
  s = await readSheet(page);
  assert.equal(v(s, 'L0.wd'), '250');
  assert.equal(s['L0.wd'].user, false);

  // "Clear typed-over cells" keeps altitudes and TAS
  await menuItem(page, '#btn-clear-edits');
  s = await readSheet(page);
  exp = O.navlog(legsOf(pts, alts, [80, 100, 92, 80], () => ({ wd: 250, ws: 12 })), { card });
  exp.cells.forEach((c, i) => assertLeg(s, i, c));
  assert.equal(s['L1.tas'].user, true);
  assert.equal(v(s, 'L1.alt'), '3500');
  assert.equal(v(s, 'H.qnh'), '1013', 'typed QNH cleared -> forecast value');
  await assertCleanLayout('after overrides');
});

// ------------------------------------------------------------------------------------------------
test('terminal information: edit, remove, add, restore, persist', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await setFlight(page, { block: '09:00' });
  await pasteRoute(page, windyUrl([LGMG, LGEL, { lat: 38.25, lon: 23.40 }, LGMG], DATE, 9), 4);
  await setAlts(page, [3000, 3500, 3000]);
  await page.type('.sheet.active [data-key="T.ad-LGMG.freq"]', 'TWR 130.875 (closed SUN)');
  await page.blur();
  await page.eval(() => document.querySelector('[data-del-row="as-ATHINAI-TMA"]').click());
  await page.click('.sheet.active [data-act="add-row"]');
  const manual = (await terminalRows(page)).filter((r) => r.id.startsWith('m'));
  assert.equal(manual.length, 1);
  await page.type(`.sheet.active [data-key="T.${manual[0].id}.field"]`, 'LGXX TEST FIELD');
  await page.type(`.sheet.active [data-key="T.${manual[0].id}.freq"]`, 'A/A 123.450');
  await page.blur();
  let rows = await terminalRows(page);
  assert.ok(!rows.some((r) => r.field === 'ATHINAI TMA'));
  assert.equal(rows.find((r) => r.id === 'ad-LGMG').freq, 'TWR 130.875 (closed SUN)');
  assert.ok(rows.some((r) => r.field === 'LGXX TEST FIELD' && r.freq === 'A/A 123.450'));
  await assertCleanLayout('terminal edited');

  await page.reload();
  rows = await terminalRows(page);
  assert.equal(rows.find((r) => r.id === 'ad-LGMG').freq, 'TWR 130.875 (closed SUN)');
  assert.ok(rows.some((r) => r.field === 'LGXX TEST FIELD'));
  assert.ok(!rows.some((r) => r.field === 'ATHINAI TMA'));

  await menuItem(page, '#btn-restore-rows');
  rows = await terminalRows(page);
  assert.ok(rows.some((r) => r.field === 'ATHINAI TMA'));
  await page.eval((id) => document.querySelector(`[data-del-row="${id}"]`).click(), manual[0].id);
  assert.ok(!(await terminalRows(page)).some((r) => r.field === 'LGXX TEST FIELD'));
});

// ------------------------------------------------------------------------------------------------
test('route: typed URL loads, renames survive re-pasting an edited route, reverse, invalid URL', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  const A = { lat: 38.15, lon: 23.15 }, B = { lat: 38.30, lon: 23.60 }, X = { lat: 38.25, lon: 23.35 };
  await setFlight(page, { block: '09:00' });
  // typed character by character into Flight → Change route…, no paste, no button
  await openRouteDialog(page);
  await expectWindFetch(page, () => page.type('#windy-url', windyUrl([LGMG, A, B, LGMG], DATE, 9)));
  await page.waitFor(() => !document.querySelector('#route-dialog').open);
  await page.waitFor(() => document.querySelector('#windy-url').title.startsWith('4 waypoints'));
  await setAlts(page, [2500, 3500, 2000]);
  await page.type('.sheet.active [data-key="cp0"]', 'KOR');
  await page.type('.sheet.active [data-key="cp1"]', 'TAN');
  await page.blur();
  let s = await readSheet(page);
  assert.deepEqual(['dep', 'cp0', 'cp1', 'cp2', 'arr'].map((k) => v(s, k)), ['LGMG', 'KOR', 'TAN', 'LGMG', 'LGMG']);

  // route edited on Windy (waypoint inserted between KOR and TAN) and pasted again
  await pasteRoute(page, windyUrl([LGMG, A, X, B, LGMG], DATE, 9), 5);
  s = await readSheet(page);
  assert.deepEqual(['dep', 'cp0', 'cp1', 'cp2', 'cp3'].map((k) => v(s, k)), ['LGMG', 'KOR', 'WP2', 'TAN', 'LGMG']);
  // unchanged legs keep their typed altitude; new legs default to the previous leg's altitude
  assert.deepEqual([0, 1, 2, 3].map((i) => v(s, `L${i}.alt`)), ['2500', '2500', '2500', '2000']);
  assert.deepEqual([0, 1, 2, 3].map((i) => s[`L${i}.alt`].user), [true, false, false, true]);
  await setAlts(page, [2500, 3000, 3000, 2000]);

  await expectWindFetch(page, () => menuItem(page, '#btn-reverse'));
  s = await readSheet(page);
  assert.deepEqual(['dep', 'cp0', 'cp1', 'cp2', 'cp3'].map((k) => v(s, k)), ['LGMG', 'TAN', 'WP2', 'KOR', 'LGMG']);
  assert.deepEqual([0, 1, 2, 3].map((i) => v(s, `L${i}.alt`)), ['2000', '3000', '3000', '2500']);
  const exp = O.navlog(legsOf([LGMG, B, X, A, LGMG], [2000, 3000, 3000, 2500], defaultTas(4), () => ({ wd: 250, ws: 12 })), { card: O.CARDS['SX-ASV']['Magnetic compass'] });
  exp.cells.forEach((c, i) => assertLeg(s, i, c));

  const n = page.requests.length;
  await openRouteDialog(page);
  await page.paste('#windy-url', 'https://www.windy.com/?37.9,23.5,8');
  await page.idle(700);
  assert.equal(await page.eval(() => document.querySelector('#windy-url').classList.contains('invalid')), true);
  assert.equal(await page.eval(() => document.querySelector('#route-dialog').open), true, 'dialog stays open');
  await page.key('Escape');
  assert.equal(page.requests.length, n, 'invalid URL does not reload');
  assert.equal(v(await readSheet(page), 'cp0'), 'TAN', 'route unchanged');

  await page.reload();
  s = await readSheet(page);
  assert.deepEqual(['dep', 'cp0', 'cp1', 'cp2', 'cp3'].map((k) => v(s, k)), ['LGMG', 'TAN', 'WP2', 'KOR', 'LGMG']);
});

// ------------------------------------------------------------------------------------------------
test('long route (12 legs) continues on a second sheet; pager and two-page PDF', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM, { surfaceFn: (x) => ({ ...SURFACE(x), qnh: 1010 + x.hour }) }));
  const pts = [LGMG];
  for (let i = 1; i <= 11; i++) pts.push({ lat: +(37.98 + 0.05 * i).toFixed(4), lon: +(23.37 + (i % 2 ? 0.12 : 0.02) * i / 2).toFixed(4) });
  pts.push(LGEL);
  const alts = pts.slice(0, -1).map((_, i) => 2000 + 500 * (i % 4));
  await setFlight(page, { block: '07:15' });
  await pasteRoute(page, windyUrl(pts, DATE, 7), 13);
  await setAlts(page, alts);
  assert.equal(await page.eval(() => !document.querySelector('#pager').hidden && document.querySelector('#pg-label').textContent), '1/2');
  const s = await readSheet(page);
  const exp = O.navlog(legsOf(pts, alts, defaultTas(12), () => ({ wd: 250, ws: 12 })), { card: O.CARDS['SX-ASV']['Magnetic compass'] });
  exp.cells.forEach((c, i) => assertLeg(s, i, c, { alt: String(alts[i]) }));
  assert.equal(v(s, 'T.dist'), String(exp.totals.dist));
  assert.equal(v(s, 'T.fuel'), String(exp.totals.fuel));
  // whole-flight totals appear on every sheet
  const perSheet = await page.eval(() => [...document.querySelectorAll('#sheet > .sheet')].map((sh) => ['T.dist', 'T.ete', 'T.fuel', 'T.sunset'].map((k) => sh.querySelector(`[data-key="${k}"]`)?.value)));
  assert.equal(perSheet.length, 2);
  for (const t of perSheet) assert.deepEqual(t, [String(exp.totals.dist), O.hmm(exp.totals.ete), String(exp.totals.fuel), v(s, 'T.sunset')]);
  assert.match(perSheet[0][3], /^SUNSET \d\d:\d\dZ$/);
  // TEMP / WIND / SKY: departure at block start on sheet 1, destination at the landing time on the last sheet
  const hdr = await page.eval(() => [...document.querySelectorAll('#sheet > .sheet')].map((sh) => ['temp', 'wind', 'sky'].map((f) => sh.querySelector(`[data-key$=".${f}"][data-key^="H"]`).value)));
  const dep = surfAt(7.25);
  const landing = (7 * 60 + 15 + 10 + exp.rows.reduce((a, r) => a + r.min, 0)) / 60;
  const arr = surfAt(landing);
  assert.deepEqual(hdr[0], [dep.temp, dep.wind, dep.sky]);
  assert.deepEqual(hdr[1], [arr.temp, arr.wind, arr.sky]);
  assert.notDeepEqual(hdr[0], hdr[1], 'departure and destination conditions differ (different times)');
  assert.equal(await page.eval(() => [...document.querySelectorAll('.pgno')].map((e) => e.textContent).join()), '1,2');
  // runway in use: take-off at LGMG on sheet 1, landing at LGEL (18/36) on sheet 2, surface wind 230° true
  const rwys = await page.eval(() => [...document.querySelectorAll('#sheet > .sheet')].map((sh) => sh.querySelector('[data-key$=".runway"]').value));
  assert.deepEqual(rwys, ['26L', '18']);
  // QNH at departure (block 07:15Z) and destination (landing time)
  const qnh = await page.eval(() => [...document.querySelectorAll('#sheet > .sheet')].map((sh) => sh.querySelector('[data-key$=".qnh"]').value));
  assert.deepEqual(qnh, [String(Math.round(1010 + 7.25)), String(Math.round(1010 + landing))]);
  await assertCleanLayout('sheet 1');
  await gotoSheet(page, 1);
  assert.equal(await page.eval(() => document.querySelector('.sheet.active [data-key="L9.tc"]').value !== ''), true);
  await assertCleanLayout('sheet 2');
  await page.screenshot('long-sheet2', { fullPage: false });
  const pdf = await page.pdf('long');
  assert.equal(pdf.pages, 2);
});

// ------------------------------------------------------------------------------------------------
test('wind source failures: error, no data, typed wind, model switch, refresh', async () => {
  let mode = 'error';
  const ok = O.openMeteoResponder(UNIFORM), nul = O.openMeteoResponder(UNIFORM, { nullAll: true });
  const err = O.openMeteoResponder(UNIFORM, { status: 400, reason: "Parameter 'start_date' is out of allowed range" });
  await freshApp(page, server, (u) => (mode === 'error' ? err(u) : mode === 'null' ? nul(u) : ok(u)));
  const pts = [LGMG, { lat: 38.20, lon: 23.20 }, LGMG];
  await setFlight(page, { block: '09:00' });
  await pasteRoute(page, windyUrl(pts, DATE, 9), 3);
  await setAlts(page, [3000, 3000]);
  let s = await readSheet(page);
  let c = await chips(page);
  assert.equal(c[0].kind, 'err');
  assert.equal(c[0].text, 'Winds ✗');
  assert.match(c[0].tip, /out of allowed range/);
  assert.equal(v(s, 'L0.wd'), '');
  assert.equal(v(s, 'L0.gs'), '80', 'calm wind: GS = TAS');
  assert.equal(await page.eval(() => document.querySelector('.sheet [data-key="L0.wd"]').classList.contains('calm')), true);

  await page.type('.sheet.active [data-key="L0.wd"]', '270');
  await page.type('.sheet.active [data-key="L0.ws"]', '15');
  await page.blur();
  s = await readSheet(page);
  // leg 1 typed wind, leg 2 still calm
  const exp = O.navlog(legsOf(pts, [3000, 3000], [80, 80], (i) => (i === 0 ? { wd: 270, ws: 15 } : { wd: 0, ws: 0 })), { card: O.CARDS['SX-ASV']['Magnetic compass'] });
  assertLeg(s, 0, exp.cells[0]);
  assertLeg(s, 1, { ...exp.cells[1], wd: '', ws: '' });
  assert.equal(await page.eval(() => document.querySelector('.sheet [data-key="L0.wd"]').classList.contains('calm')), false);

  mode = 'null';
  await expectWindFetch(page, () => menuItem(page, '#btn-winds'), { ok: true });
  c = await chips(page);
  assert.deepEqual([c[0].kind, c[0].text], ['err', 'No wind: leg 2']);

  mode = 'ok';
  await expectWindFetch(page, () => settings(page, () => page.select('#model', 'gfs_seamless')), { ok: true });
  assert.equal(new URL(page.requests[page.requests.length - 1]).searchParams.get('models'), 'gfs_seamless');
  assert.deepEqual((await chips(page)).map((x) => x.text), ['Winds ✓']);
  s = await readSheet(page);
  assert.equal(v(s, 'L1.wd'), '250');
});

// ------------------------------------------------------------------------------------------------
test('airspace by altitude, aerodromes without ICAO, Thessaloniki frequencies, long names fit', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  // south of Crete: IRAKLION TMA south sector starts at 5500 ft AGL
  await setFlight(page, { block: '09:00' });
  await pasteRoute(page, windyUrl([{ lat: 34.70, lon: 24.90 }, { lat: 34.75, lon: 25.40 }], DATE, 9), 2);
  await setAlts(page, [4500]);
  let rows = await terminalRows(page);
  assert.deepEqual(rows.filter((r) => r.field).map((r) => r.field), ['DEP', 'ARR', 'FIS']);
  await setAlts(page, [6500]);
  rows = await terminalRows(page);
  assert.deepEqual(rows.find((r) => r.field === 'IRAKLION TMA'), { id: 'as-IRAKLION-TMA', field: 'IRAKLION TMA', elev: '', rwy: '', freq: 'APP 123.975 118.025' });

  // Thessaloniki: ATIS, ground, tower with backup, approach; MAKEDONIA TMA
  await pasteRoute(page, windyUrl([LGTS, { lat: 40.75, lon: 22.95 }], DATE, 9), 2);
  await setAlts(page, [3000]);
  rows = await terminalRows(page);
  const ts = rows.find((r) => r.field === 'LGTS');
  assert.equal(ts.field, 'LGTS');
  assert.equal(ts.rwy, '10 / 28, 16 / 34');
  for (const f of ['ATIS 127.555', 'GND 121.705', 'TWR 118.105 118.055', 'APP 120.800 118.280', 'DEL 118.055']) assert.ok(ts.freq.includes(f), `LGTS has ${f}: ${ts.freq}`);
  assert.equal(rows.find((r) => r.field === 'MAKEDONIA TMA').freq, 'APP 120.800 118.280');

  // CAT B fields without ICAO are named after the field; long names must still fit the hexagon
  await pasteRoute(page, windyUrl([{ lat: 38.45667, lon: 23.13472 }, { lat: 40.98528, lon: 22.62306 }, { lat: 40.21958, lon: 22.45949 }], DATE, 9), 3);
  await setAlts(page, [5500, 4500]);
  const s = await readSheet(page);
  assert.deepEqual([v(s, 'dep'), v(s, 'cp0'), v(s, 'cp1')], ['DIMITRA', 'NEA KAVALA POLYKASTRO', 'KONTARIOTISA']);
  rows = await terminalRows(page);
  assert.equal(rows[0].field, 'KOPAIDA / DIMITRA');
  assert.ok(rows.filter((r) => /TMA|FIS/.test(r.field)).every((r) => r.rwy === '' && r.elev === ''), 'airspace rows: no runways/elevation');
  assert.equal(rows[0].freq, 'A/A 119.700');
  await assertCleanLayout('long names', { print: true });
});

// ------------------------------------------------------------------------------------------------
test('export, new flight, import restores the whole sheet', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await setFlight(page, { block: '11:20', aircraft: 'SX-ASG' });
  await pasteRoute(page, windyUrl([LGMG, LGEL, { lat: 38.25, lon: 23.40 }, LGMG], DATE, 11), 4);
  await setAlts(page, [2500, 3500, 2500]);
  await page.type('.sheet.active [data-key="cp1"]', 'OINOI');
  await page.type('.sheet.active [data-key="L0.sqk"]', '7000');
  await page.blur();
  const before = await readSheet(page);

  await page.eval(() => { window.__exported = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then((t) => { window.__exported = t; }); return orig.call(URL, b); }; });
  await menuItem(page, '#btn-export');
  const json = await page.waitFor(() => window.__exported);
  const file = path.join(ARTIFACTS, 'export.json');
  fs.writeFileSync(file, json);
  assert.equal(JSON.parse(json).waypoints[2].name, 'OINOI');

  const firstUrl = await page.eval(() => location.hash);
  await menuItem(page, '#btn-new');
  await page.waitFor((u) => location.hash !== u && /^#\/f\//.test(location.hash) && !!document.querySelector('.sheet'), { args: [firstUrl] });
  await page.idle(200);
  let s = await readSheet(page);
  assert.equal(v(s, 'dep'), '');
  assert.equal(v(s, 'L0.tc'), '');
  assert.equal(await page.eval(() => document.querySelector('#aircraft').value), 'SX-ASG', 'aircraft carried over to the new flight');
  await assertCleanLayout('empty sheet');

  // File → Open file… creates a flight from the file
  const doc = await page.send('DOM.getDocument');
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-import' });
  await page.send('DOM.setFileInputFiles', { files: [file], nodeId });
  await page.waitFor(() => document.querySelector('.sheet [data-key="dep"]').value === 'LGMG' && document.body.dataset.wx === 'ok');
  await page.idle(200);
  s = await readSheet(page);
  assert.deepEqual(s, before, 'import restores every cell');
});

// ------------------------------------------------------------------------------------------------
test('bar and header stay in sync; block time formats; no route shows a clean empty sheet', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await assertCleanLayout('empty');
  assert.deepEqual(await chips(page), []);
  await pasteRoute(page, windyUrl([LGMG, LGEL], DATE, 9), 2);
  assert.equal(await page.eval(() => document.querySelector('#block-start').value), '09:00Z', 'block start taken from the Windy URL hour');
  assert.equal(v(await readSheet(page), 'H.blockstart'), '09:00Z');
  await page.type('#block-start', '0945');
  await page.blur();
  assert.equal(v(await readSheet(page), 'H.blockstart'), '09:45Z');
  assert.equal(await page.eval(() => document.querySelector('#block-start').value), '09:45Z');
  await page.type('.sheet.active [data-key="H.blockstart"]', '10:15');
  await page.blur();
  assert.equal(await page.eval(() => document.querySelector('#block-start').value), '10:15Z');
  await page.type('.sheet.active [data-key="H.date"]', '2026-11-18');
  await page.blur();
  assert.equal(await page.eval(() => document.querySelector('#date').value), '2026-11-18');
  await page.type('#block-start', '');
  await page.blur();
  assert.equal(await page.eval(() => document.querySelector('#block-start').classList.contains('empty-req')), true);
});

// ------------------------------------------------------------------------------------------------
test('clicking a cell selects its value; Ctrl+Z undoes and Ctrl+Shift+Z redoes', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await setFlight(page, { block: '09:00' });
  await pasteRoute(page, windyUrl([LGMG, LGEL, LGMG], DATE, 9), 3);
  await setAlts(page, [2000, 2500]);
  await page.idle(1600); // separate history steps

  await page.click('.sheet.active [data-key="L0.alt"]');
  const sel = await page.eval(() => { const e = document.activeElement; return [e.dataset.key, e.selectionStart, e.selectionEnd, e.value]; });
  assert.deepEqual(sel, ['L0.alt', 0, 4, '2000'], 'whole value selected on click');
  for (const ch of '3500') await page.insert(ch);
  assert.equal(v(await readSheet(page), 'L0.alt'), '3500', 'typing replaces the selected value');
  await page.click('.sheet.active [data-key="L0.wd"]');
  assert.deepEqual(await page.eval(() => { const e = document.activeElement; return [e.selectionStart, e.selectionEnd]; }), [0, 3]);
  for (const ch of '090') await page.insert(ch);
  await page.blur();
  let s = await readSheet(page);
  assert.equal(v(s, 'L0.wd'), '090');

  await page.key('z', 2); // Ctrl+Z: undo the wind
  s = await readSheet(page);
  assert.equal(v(s, 'L0.wd'), '250');
  assert.equal(v(s, 'L0.alt'), '3500');
  await page.key('z', 2); // undo the altitude (all four keystrokes were one step)
  s = await readSheet(page);
  assert.equal(v(s, 'L0.alt'), '2000');
  assert.equal(s['L0.alt'].user, true);
  await page.key('z', 2 | 8); // Ctrl+Shift+Z: redo
  assert.equal(v(await readSheet(page), 'L0.alt'), '3500');
  await page.key('y', 2); // Ctrl+Y: redo
  assert.equal(v(await readSheet(page), 'L0.wd'), '090');
  await page.key('z', 4); // Cmd+Z works too
  assert.equal(v(await readSheet(page), 'L0.wd'), '250');
  await assertCleanLayout('after undo');
});

// ------------------------------------------------------------------------------------------------
test('VFR reporting points name the waypoints and charted VFR route altitudes fill the legs', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  // clicked roughly on the chart points (a few hundred metres off, as with Windy clicks)
  const KINETA = { lat: 37.9661, lon: 23.2238 }, KORINTHOS = { lat: 37.9281, lon: 22.9391 }, DAPORI = { lat: 37.8154, lon: 23.2625 }, EGN = { lat: 37.7639, lon: 23.4290 };
  await setFlight(page, { block: '09:00' });
  await pasteRoute(page, windyUrl([LGMG, KINETA, KORINTHOS, DAPORI, EGN, LGMG], DATE, 9), 6);
  let s = await readSheet(page);
  assert.deepEqual(['dep', 'cp0', 'cp1', 'cp2', 'cp3', 'cp4'].map((k) => v(s, k)), ['LGMG', 'KINETA', 'KORINTHOS', 'DAPORI', 'EGN', 'LGMG']);
  // LGAV VFR chart: MEGARA–KINETA–KORINTHOS 3500, KORINTHOS–DAPORI 3500, DAPORI→EGN 2000 (one-way), EGN→MEGARA 2500 (one-way)
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => v(s, `L${i}.alt`)), ['3500', '3500', '3500', '2000', '2500']);
  assert.ok([0, 1, 2, 3, 4].every((i) => !s[`L${i}.alt`].user), 'charted altitudes are computed values, not typed');
  const pts = [LGMG, KINETA, KORINTHOS, DAPORI, EGN, LGMG];
  const exp = O.navlog(pts.slice(0, -1).map((a, i) => ({ a, b: pts[i + 1], tas: defaultTas(5)[i], wd: 250, ws: 12 })), { card: O.CARDS['SX-ASV']['Magnetic compass'] });
  exp.cells.forEach((c, i) => assertLeg(s, i, c));
  assert.ok((await terminalRows(page)).some((r) => r.field === 'ATHINAI TMA'), 'charted altitudes feed the airspace check');

  // typing over a charted altitude wins; clearing it brings the charted value back
  await page.type('.sheet.active [data-key="L2.alt"]', '4500');
  await page.blur();
  assert.equal(v(await readSheet(page), 'L2.alt'), '4500');
  await page.type('.sheet.active [data-key="L2.alt"]', '');
  await page.blur();
  assert.equal(v(await readSheet(page), 'L2.alt'), '3500');

  // flown against the one-way direction (MEGARA→EGN is only charted EGN→MEGARA): no charted altitude,
  // no previous leg, destination not an aerodrome -> departure pattern altitude (LGMG 12 ft + 1000)
  await pasteRoute(page, windyUrl([LGMG, EGN], DATE, 9), 2);
  s = await readSheet(page);
  assert.equal(v(s, 'cp0'), 'EGN');
  assert.equal(v(s, 'L0.alt'), '1000');
  assert.equal(s['L0.alt'].user, false);

  // altitude chain: charted route (highest), else previous leg, final leg = destination pattern altitude
  const OFFROUTE = { lat: 37.75, lon: 22.80 };
  await pasteRoute(page, windyUrl([LGEL, KINETA, KORINTHOS, OFFROUTE, { lat: 37.60, lon: 22.95 }, LGMG], DATE, 9), 6);
  s = await readSheet(page);
  // LGEL→KINETA: no route, first leg -> LGEL pattern (144+1000 -> 1100); KINETA→KORINTHOS charted 3500;
  // KORINTHOS→off-route and on: previous (3500); last leg into LGMG -> 1000
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => v(s, `L${i}.alt`)), ['1100', '3500', '3500', '3500', '1000']);
  await page.type('.sheet.active [data-key="L2.alt"]', '4500');
  await page.blur();
  s = await readSheet(page);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => v(s, `L${i}.alt`)), ['1100', '3500', '4500', '4500', '1000'], 'typed altitude carries forward');
});

// ------------------------------------------------------------------------------------------------
test('other TMAs: Rodos direction-specific VFR altitudes, out and back', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  const LINDOS = { lat: 36.0703, lon: 28.0753 }, NOVEMBER = { lat: 35.7236, lon: 28.2428 }, AFANTOU = { lat: 36.2950, lon: 28.1653 };
  await setFlight(page, { block: '09:00' });
  await pasteRoute(page, windyUrl([AFANTOU, LINDOS, NOVEMBER, LINDOS, AFANTOU], DATE, 9), 5);
  const s = await readSheet(page);
  assert.deepEqual(['dep', 'cp0', 'cp1', 'cp2', 'cp3'].map((k) => v(s, k)), ['AFANTOU', 'LINDOS', 'NOVEMBER', 'LINDOS', 'AFANTOU']);
  // AD 2-LGRP-VFR: AFANTOU→LINDOS 3500, LINDOS→NOVEMBER 5500, NOVEMBER→LINDOS 4500, LINDOS→AFANTOU 3000
  assert.deepEqual([0, 1, 2, 3].map((i) => v(s, `L${i}.alt`)), ['3500', '5500', '4500', '3000']);
  assert.ok((await terminalRows(page)).some((r) => r.field === 'RODOS TMA'));
});

// ------------------------------------------------------------------------------------------------
test('Enter commits a typed cell (and keeps new lines in Notes)', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await setFlight(page, { block: '09:00' });
  await pasteRoute(page, windyUrl([LGMG, LGEL], DATE, 9), 2);
  await page.type('.sheet.active [data-key="L0.alt"]', '2500');
  await page.key('Enter');
  assert.equal(await page.eval(() => document.activeElement.dataset.key || null), null, 'cell left after Enter');
  let s = await readSheet(page);
  assert.equal(v(s, 'L0.alt'), '2500');
  assert.equal(s['L0.alt'].user, true);
  await page.type('.sheet.active [data-key="T.ad-LGMG.freq"]', 'TWR 130.875');
  await page.key('Enter');
  assert.equal(v(await readSheet(page), 'T.ad-LGMG.freq'), 'TWR 130.875', 'no newline added to terminal cell');
  await page.type('#block-start', '0930');
  await page.key('Enter');
  assert.equal(v(await readSheet(page), 'H.blockstart'), '09:30Z');
  await page.type('.sheet.active [data-key="notes"]', 'line one');
  await page.key('Enter');
  await page.insert('line two');
  await page.blur();
  assert.match(v(await readSheet(page), 'notes'), /line one\s*\n?line two/);
  await page.reload();
  assert.equal(v(await readSheet(page), 'L0.alt'), '2500', 'saved across reload');
});

// ------------------------------------------------------------------------------------------------
test('UTC times are written with Z; elevation and runways fill their cells', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await setFlight(page, { block: '0915' });
  await pasteRoute(page, windyUrl([LGMG, LGTS], DATE, 9), 2);
  for (const [k, typed, want] of [['H.takeoff', '0927', '09:27Z'], ['H.blockend', '11:05', '11:05Z'], ['L0.eta', '9:58', '09:58Z'], ['L0.ata', '10:02z', '10:02Z']]) {
    await page.type(`.sheet.active [data-key="${k}"]`, typed);
    await page.blur();
    assert.equal(v(await readSheet(page), k), want, k);
  }
  assert.equal(v(await readSheet(page), 'H.blockstart'), '09:15Z');
  assert.match(v(await readSheet(page), 'T.sunset'), /Z$/);
  const sizes = await page.eval(() => Object.fromEntries(['elev', 'rwy', 'freq'].map((c) => [c, parseFloat(getComputedStyle(document.querySelector(`.sheet.active textarea[data-key$=".${c}"]`)).fontSize)])));
  const u = await page.eval(() => document.querySelector('.sheet.active').offsetWidth / 1145);
  assert.ok(sizes.elev >= sizes.freq && sizes.rwy >= sizes.freq && sizes.elev > 14 * u, JSON.stringify(sizes));
  await assertCleanLayout('Z times', { print: true });
});

// ------------------------------------------------------------------------------------------------
test('long checkpoint names never run onto the hexagon arrows (screen and print)', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  const P = [{ lat: 37.8897, lon: 23.7342 }, { lat: 37.7689, lon: 23.5683 }, { lat: 37.5269, lon: 23.5325 }, { lat: 37.9814, lon: 23.3661 }];
  await setFlight(page, { block: '09:00' });
  await pasteRoute(page, windyUrl(P, DATE, 9), 4);
  const s = await readSheet(page);
  assert.deepEqual([v(s, 'dep'), v(s, 'cp0'), v(s, 'cp1')], ['HELLINIKON', 'EAST AIGINA', 'EAST POROS']);
  await page.type('.sheet.active [data-key="cp2"]', 'NTAOU PENTELIS WEST');
  await page.blur();
  for (const [w, h] of [[1440, 900], [1280, 720], [1024, 700], [1920, 1080]]) {
    await page.viewport(w, h); await page.idle(150);
    await assertCleanLayout(`names ${w}x${h}`, { print: true });
  }
  await page.screenshot('long-names', { fullPage: false });
});

// ------------------------------------------------------------------------------------------------
test('notes print as a ruled area to write on in flight', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await pasteRoute(page, windyUrl([LGMG, LGEL], DATE, 9), 2);
  await page.media('print');
  await page.idle(150);
  const lines = await page.eval(() => {
    const box = document.querySelector('.sheet .notes').getBoundingClientRect();
    return [...document.querySelectorAll('.sheet .note-lines div')].map((d) => d.getBoundingClientRect())
      .filter((r) => r.bottom <= box.bottom + 1 && getComputedStyle(document.querySelector('.sheet .note-lines div')).borderBottomStyle === 'solid').length;
  });
  await page.media('');
  assert.ok(lines >= 4, `ruled lines in print: ${lines}`);
  const pdf = await page.pdf('notes-lines');
  assert.equal(pdf.pages, 1);
});

// ------------------------------------------------------------------------------------------------
test('runway in use follows the wind; calm keeps the first runway; parallel runways', async () => {
  let dir = 30, spd = 12;
  await freshApp(page, server, O.openMeteoResponder(UNIFORM, { surfaceFn: () => ({ dir, spd }) }));
  await setFlight(page, { block: '09:00' });
  await pasteRoute(page, windyUrl([{ lat: 37.9367, lon: 23.9445 }, LGMG], DATE, 9), 2);   // LGAV 03L/21R 03R/21L
  assert.equal(v(await readSheet(page), 'H.runway'), '03R/L');
  dir = 200;
  await expectWindFetch(page, () => menuItem(page, '#btn-winds'), { ok: true });
  assert.equal(v(await readSheet(page), 'H.runway'), '21L/R');
  spd = 0;
  await expectWindFetch(page, () => menuItem(page, '#btn-winds'), { ok: true });
  assert.equal(v(await readSheet(page), 'H.runway'), '03R/L', 'calm: first listed runway');
  await page.type('.sheet.active [data-key="H.runway"]', '21L');
  await page.blur();
  assert.equal(v(await readSheet(page), 'H.runway'), '21L', 'typed value wins');
});

// ------------------------------------------------------------------------------------------------
test('settings: variation entered as degrees E/W changes the magnetic headings', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await pasteRoute(page, windyUrl([LGMG, LGEL], DATE, 9), 2);
  const th = +v(await readSheet(page), 'L0.th');
  assert.equal(v(await readSheet(page), 'L0.var'), '\u22125');
  await settings(page, async () => { await page.type('#variation', '3'); await page.select('#variation-ew', 'W'); });
  const s = await readSheet(page);
  assert.equal(v(s, 'L0.var'), '+3');
  assert.equal(v(s, 'L0.mh'), O.hdg(th + 3));
  await settings(page, async () => { assert.equal(await page.eval(() => [document.querySelector('#variation').value, document.querySelector('#variation-ew').value].join()), '3,W'); });
});

// ------------------------------------------------------------------------------------------------
test('date: clicking opens a calendar; picking a day or typing both work', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await page.type('#date', '2026-11-17');
  await page.blur();
  await page.click('#date');
  await page.waitFor(() => !document.querySelector('#cal').hidden);
  assert.equal(await page.eval(() => document.querySelector('#cal-title').textContent), 'November 2026');
  assert.equal(await page.eval(() => document.querySelector('#cal .sel').dataset.date), '2026-11-17');
  await page.screenshot('calendar', { fullPage: false });
  await page.click('#cal .cal-nav[data-step="1"]');
  assert.equal(await page.eval(() => document.querySelector('#cal-title').textContent), 'December 2026');
  await page.click('#cal [data-date="2026-12-03"]');
  await page.waitFor(() => document.querySelector('#cal').hidden);
  assert.equal(await page.eval(() => document.querySelector('#date').value), '2026-12-03');
  assert.equal(v(await readSheet(page), 'H.date'), '2026-12-03');
  // typing still works while the calendar is open; the calendar follows
  await page.click('#date');
  await page.type('#date', '2027-01-15');
  assert.equal(await page.eval(() => document.querySelector('#cal-title').textContent), 'January 2027');
  await page.key('Escape');
  assert.equal(await page.eval(() => document.querySelector('#cal').hidden), true);
  await page.blur();
  assert.equal(v(await readSheet(page), 'H.date'), '2027-01-15');
  // the date on the sheet opens it too
  await page.click('.sheet.active [data-key="H.date"]');
  await page.waitFor(() => !document.querySelector('#cal').hidden);
  await page.click('#cal [data-date="2027-01-20"]');
  assert.equal(v(await readSheet(page), 'H.date'), '2027-01-20');
  assert.equal(await page.eval(() => document.querySelector('#date').value), '2027-01-20');
});

// ------------------------------------------------------------------------------------------------
// Pixel check: the ink of every filled number cell is centred in its cell (measured on a screenshot).
test('numbers are optically centred in their cells', async () => {
  await freshApp(page, server, O.openMeteoResponder(UNIFORM));
  await setFlight(page, { block: '09:30' });
  await pasteRoute(page, windyUrl([LGMG, LGEL, { lat: 38.25, lon: 23.40 }, { lat: 38.10, lon: 23.20 }, LGMG], DATE, 9), 5);
  await page.viewport(1440, 1000);
  await page.eval(() => document.activeElement && document.activeElement.blur());
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });   // no hover tint
  await page.idle(300);
  const cells = await page.eval(() => [...document.querySelectorAll('.sheet.active .tbl input, .sheet.active .hdr input')]
    .filter((e) => e.value && /^[\d+\u2212:/ ]+[A-Z]?$/.test(e.value) && !e.closest('.cpn, .dep'))
    .map((e) => { const r = e.getBoundingClientRect(); return { key: e.dataset.key, v: e.value, x: r.left, y: r.top, w: r.width, h: r.height, align: getComputedStyle(e).textAlign }; }));
  assert.ok(cells.length > 60, `cells checked: ${cells.length}`);
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  const img = decodePng(Buffer.from(shot.data, 'base64'));
  const bad = [];
  for (const c of cells) {
    const inset = 3;   // stay off the cell rules
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    for (let y = Math.ceil(c.y + inset); y < Math.floor(c.y + c.h - inset); y++) {
      for (let x = Math.ceil(c.x + inset); x < Math.floor(c.x + c.w - inset); x++) {
        const i = (y * img.width + x) * 4, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (b - r > 40 && r < 170) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }   // blue ink
      }
    }
    if (x1 < 0) { bad.push(`${c.key}: no ink found`); continue; }
    const left = x0 - c.x, right = c.x + c.w - 1 - x1, top = y0 - c.y, bottom = c.y + c.h - 1 - y1;
    if (Math.abs(top - bottom) > 2.5) bad.push(`${c.key} "${c.v}" vertical off by ${(top - bottom).toFixed(1)}px (top ${top.toFixed(1)}, bottom ${bottom.toFixed(1)})`);
    if (c.align === 'center' && Math.abs(left - right) > 2.5) bad.push(`${c.key} "${c.v}" horizontal off by ${(left - right).toFixed(1)}px`);
  }
  assert.deepEqual(bad, []);
});
