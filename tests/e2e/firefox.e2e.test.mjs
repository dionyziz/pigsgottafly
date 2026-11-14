// The same end-to-end checks in Firefox (WebDriver BiDi). Skipped when Firefox is not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';
import { launchFirefox, firefoxPath } from './firefox.mjs';
import { freshApp, pasteRoute, setAlts, setFlight, readSheet, v, terminalRows, chips, layoutAudit, windyUrl, gotoSheet } from './app.mjs';
import * as O from './oracle.mjs';

const skip = !firefoxPath() && 'Firefox not installed';
const LGMG = { lat: 37.98139, lon: 23.36611 }, LGEL = { lat: 38.06361, lon: 23.55583 };
let server;
before(async () => { server = await startServer(); });
after(() => server && server.close());

test('Firefox: complete flight plan with real typing, layout, totals, PDF', { skip }, async () => {
  const page = await launchFirefox();
  try {
    await freshApp(page, server, O.openMeteoResponder(() => ({ dir: 250, spd: 12, temp: 8 })));
    const pts = [LGMG, LGEL, { lat: 38.25, lon: 23.40 }, { lat: 38.10, lon: 23.20 }, LGMG];
    const alts = [2000, 3500, 4500, 2500];
    await setFlight(page, { block: '09:30' });
    await pasteRoute(page, windyUrl(pts, '2026-11-17', 9), 5);
    await setAlts(page, alts); // typed key by key: crossing a TMA lower limit mid-typing must not drop digits
    await page.idle(300);
    const s = await readSheet(page);
    const exp = O.navlog(pts.slice(0, -1).map((a, i) => ({ a, b: pts[i + 1], tas: [80, 92, 92, 80][i], wd: 250, ws: 12 })), { card: O.CARDS['SX-ASV']['Magnetic compass'] });
    exp.cells.forEach((c, i) => { for (const [f, val] of Object.entries({ ...c, alt: String(alts[i]) })) assert.equal(v(s, `L${i}.${f}`), val, `leg ${i + 1} ${f}`); });
    assert.equal(v(s, 'T.fuel'), String(exp.totals.fuel));
    assert.ok((await terminalRows(page)).some((r) => r.field === 'ATHINAI TMA'));
    assert.deepEqual((await chips(page)).map((c) => c.text), ['Winds ✓']);
    for (const [w, h] of [[1600, 1000], [1280, 720]]) { await page.viewport(w, h); await page.idle(200); assert.deepEqual(await layoutAudit(page), [], `Firefox ${w}x${h}`); }
    await page.screenshot('firefox-flight');
    const pdf = await page.pdf('firefox-flight');
    assert.equal(pdf.pages, 1, 'one A4 page');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

test('Firefox: a saved 16-leg round trip (LGTT–LGMG–LGTT) renders both sheets with totals on each', { skip }, async () => {
  const page = await launchFirefox();
  try {
    await freshApp(page, server, O.openMeteoResponder(() => ({ dir: 250, spd: 12, temp: 8 })));
    const url = 'https://www.windy.com/route-planner/vfr/38.1156,23.7883;38.0009,23.8082;37.8897,23.7321;37.9363,23.6484;37.8755,23.7411;37.7649,23.5613;37.5201,23.5206;37.3638,23.5765;37.2574,23.1553;37.5584,22.7998;37.6387,23.1590;37.8159,23.2593;37.9344,22.9254;37.9815,23.3679;38.0631,23.5565;38.0782,23.6787;38.1014,23.7791?850h,37.346,23.042,9,p:favs';
    await setFlight(page, { date: '2026-11-14', block: '10:30' });
    await pasteRoute(page, url, 17);
    await setAlts(page, [1800, 2500, 5000, 3500, 3500, 3500, 3500, 3500, 3500, 3500, 3500, 3500, 3000, 2000, 2000, 1800]);
    const s = await readSheet(page);
    assert.equal(v(s, 'dep'), 'LGTT');
    assert.equal(v(s, 'cp15'), 'LGTT');
    assert.equal(await page.eval(() => document.querySelectorAll('#sheet > .sheet').length), 2);
    const totals = await page.eval(() => [...document.querySelectorAll('#sheet > .sheet')].map((sh) => sh.querySelector('[data-key="T.fuel"]').value));
    assert.equal(totals[0], totals[1]);
    assert.ok(+totals[0] > 0);
    assert.deepEqual(await layoutAudit(page), []);
    await gotoSheet(page, 1);
    assert.deepEqual(await layoutAudit(page), []);
    await page.screenshot('firefox-16legs-sheet2');
    assert.equal((await page.pdf('firefox-16legs')).pages, 2);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
