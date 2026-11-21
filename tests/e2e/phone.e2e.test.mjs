// At phone width nothing sticks out sideways: a row wider than the screen makes iOS widen the whole
// page (the editor then scrolls sideways), so every element must fit the screen or sit inside
// something that scrolls or clips it (the navlog table scrolls on its own).
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
  server = await startServer();
  await api('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0000', homeAerodrome: 'LGTT' });
  const ac = await api('POST', 'aircraft', fleetSeed()[0]);
  const f = await api('POST', 'flights', {
    route: [ad('LGTT'), ad('LGSR'), ad('LGIR')],
    date: new Date(Date.now() + 86400e3).toISOString().slice(0, 10),
    blockOff: '09:00',
    aircraftId: ac.id,
  });
  flightId = f.id;
  browser = await launch();
  page = await browser.newPage();
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
});
after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

/** Elements reaching past the screen's right edge that nothing scrolls or clips. */
const sticking = () =>
  page.eval(() => {
    const W = document.documentElement.clientWidth;
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (
          (o === 'auto' || o === 'scroll') && // only containers that scroll sideways on purpose: iOS widened the page past clipped ones
          p.getBoundingClientRect().right <= W + 1
        )
          return true;
      }
      return false;
    };
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > W + 1 && !clipped(el);
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')}`)
      .slice(0, 10);
  });

test('phone width: the flights, the editor (each stage and the navlog) and File & forms fit the screen', async () => {
  for (const path of [
    '/',
    `/flights/${flightId}`,
    `/flights/${flightId}/export/fpl`,
    `/flights/${flightId}/export/navlog`,
  ]) {
    await page.goto(server.url + path);
    await new Promise((r) => setTimeout(r, 2500));
    assert.deepEqual(await sticking(), [], `${path}: elements wider than the screen`);
    if (path === `/flights/${flightId}`)
      for (const s of ['plan', 'brief']) {
        await page.click(`[data-testid=stage-${s}]`);
        assert.deepEqual(await sticking(), [], `${path}, stage ${s}: elements wider than the screen`);
      }
  }
});
