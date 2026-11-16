// End-to-end smoke test of the v3 shell: onboarding → lobby → new flight → editor → export page.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { launch, startServer } from './harness.mjs';

let server, browser, page;
before(async () => {
  server = await startServer();
  browser = await launch();
  page = await browser.newPage();
});
after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

test('first use asks for the profile, then the lobby, a new flight and the editor work', async () => {
  await page.goto(server.url + '/');
  await page.waitFor(() => location.pathname === '/profile' && !!document.querySelector('[data-testid=profile-form]'));
  await page.type('input[name=fullName]', 'Test Pilot');
  await page.type('input[name=phone]', '+30 690 000 0000');
  await page.type('input[name=homeAerodrome]', 'LGTT');
  await page.click('[data-testid=profile-form] button[type=submit]');
  await page.waitFor(() => location.pathname === '/' && !!document.querySelector('[data-testid=new-flight]'));

  await page.click('[data-testid=new-flight]');
  await page.waitFor(
    () => /^\/flights\/[\w-]+$/.test(location.pathname) && !!document.querySelector('[data-testid=editor]'),
  );
  await page.waitFor(() => !!document.querySelector('[data-testid=map] canvas'));
  const title = await page.eval(() => document.querySelector('[data-testid=flight-title]').textContent);
  assert.equal(title, 'LGTT → LGTT');

  // an edit is saved to the server
  await page.type('[data-testid=flight-panel] input[placeholder="HH:MM"]', '09:30');
  await page.blur();
  await page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', {
    timeout: 10000,
  });
  const id = await page.eval(() => location.pathname.split('/').pop());
  const f = await (await fetch(`${server.url}/api/flights/${id}`)).json();
  assert.equal(f.blockOff, '09:30');

  // the lobby lists it; the export route renders
  await page.goto(server.url + '/');
  await page.waitFor((id) => !!document.querySelector(`[data-flight-id="${id}"]`), { args: [id] });
  await page.goto(`${server.url}/flights/${id}/export/navlog`);
  await page.waitFor(() => document.querySelector('[data-testid=export-page]')?.dataset.kind === 'navlog');
  assert.deepEqual(page.errors, []);
});

const postFlight = async (body) =>
  (
    await fetch(`${server.url}/api/flights`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();

test('origin and destination are fields in the editor, kept in sync with the route', async () => {
  const f0 = await postFlight({});
  await page.goto(`${server.url}/flights/${f0.id}`);
  await page.waitFor(() => !!document.querySelector('[data-testid=route-destination] input'));
  assert.equal(await page.eval(() => document.querySelector('[data-testid=route-origin] input').value), 'LGTT');
  await page.type('[data-testid=route-destination] input', 'LGMG');
  await page.blur();
  await page.waitFor(() => document.querySelector('[data-testid=flight-title]').textContent === 'LGTT → LGMG');
  await page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', {
    timeout: 10000,
  });
  const f = await (await fetch(`${server.url}/api/flights/${f0.id}`)).json();
  assert.deepEqual(
    f.route.map((p) => [p.name, p.kind]),
    [
      ['LGTT', 'aerodrome'],
      ['LGMG', 'aerodrome'],
    ],
  );
  if (process.env.SHOTS) await page.screenshot('smoke-route-ends', { fullPage: false });
});

test('editor boxes: header toggles, ATC reorder by keyboard on the drag handle, a warning fixed in place', async () => {
  const ads = await (await fetch(`${server.url}/api/ref/aerodromes`)).json();
  const at = (icao) => {
    const a = ads.find((x) => x.icao === icao);
    return { uid: `w3-${icao}`, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
  };
  const f0 = await postFlight({ route: [at('LGTT'), at('LGMG')] });
  await page.goto(`${server.url}/flights/${f0.id}`);
  await page.waitFor(() => document.querySelectorAll('[data-testid=atc-row]').length >= 2);
  const saved = () =>
    page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', { timeout: 10000 });

  // a click anywhere on a box's header closes and opens it
  await page.click('[data-testid=section-when] .collapsible-title');
  await page.waitFor(() => document.querySelector('[data-testid=section-when]').classList.contains('collapsed'));
  await page.click('[data-testid=section-when] .collapsible-badge');
  await page.waitFor(() => !document.querySelector('[data-testid=section-when]').classList.contains('collapsed'));
  // the navlog strip's header too
  await page.click('.ns-title');
  await page.waitFor(() => document.querySelector('[data-testid=navlog-strip]').classList.contains('closed'));
  await page.click('.ns-title');
  await page.waitFor(() => !document.querySelector('[data-testid=navlog-strip]').classList.contains('closed'));

  // ATC: ↓ on the first row's handle moves it down; the list is saved on the flight
  const names = () =>
    page.eval(() =>
      [...document.querySelectorAll('[data-testid=atc-row] .ep-atc-cs')].map((e) => e.firstChild.textContent),
    );
  const before = await names();
  await page.eval(() => document.querySelector('[data-testid=atc-row] .drag-handle').focus());
  await page.key('ArrowDown');
  await page.waitFor(
    (b) => {
      const n = [...document.querySelectorAll('[data-testid=atc-row] .ep-atc-cs')].map((e) => e.firstChild.textContent);
      return n[0] === b[1] && n[1] === b[0];
    },
    { args: [before] },
  );
  await saved();
  const f = await (await fetch(`${server.url}/api/flights/${f0.id}`)).json();
  assert.deepEqual(
    f.atc.slice(0, 2).map((e) => e.callsign),
    [before[1], before[0]],
  );
  // a click on a row edits it; a bad frequency says the format
  await page.click('[data-testid=atc-row-edit]');
  await page.waitFor(() => !!document.querySelector('[data-testid=atc-primary]'));
  await page.type('[data-testid=atc-primary]', '1234');
  await page.waitFor(() =>
    /Format 123\.450/.test(document.querySelector('[data-testid=atc-freq-format]')?.textContent || ''),
  );
  await page.key('Escape');

  // "No aircraft chosen" → Fix: the Aircraft box opens (it was collapsed) and its field is highlighted (the hangar is empty here)
  await page.click('[data-testid=section-aircraft] .collapsible-title');
  await page.waitFor(() => document.querySelector('[data-testid=section-aircraft]').classList.contains('collapsed'));
  await page.click('[data-testid=navlog-warn-toggle]');
  await page.waitFor(() =>
    [...document.querySelectorAll('[data-testid=navlog-warnings] li')].some((li) =>
      /No aircraft chosen/.test(li.textContent),
    ),
  );
  await page.eval(() =>
    [...document.querySelectorAll('[data-testid=navlog-warnings] li')]
      .find((li) => /No aircraft chosen/.test(li.textContent))
      .querySelector('[data-testid=warning-fix]')
      .click(),
  );
  await page.waitFor(() => !!document.querySelector('[data-testid=section-aircraft] [data-focus=aircraft].attention'));
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=section-aircraft]').classList.contains('collapsed')),
    false,
  );
  await page.click('[data-testid=navlog-warn-toggle]');
});

test('navlog over two sheets: checkpoints evenly spaced, each sheet with its own terminal information', async () => {
  const ads = await (await fetch(`${server.url}/api/ref/aerodromes`)).json();
  const at = (icao) => {
    const a = ads.find((x) => x.icao === icao);
    return { uid: `u-${icao}`, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
  };
  const pt = (name, lat, lon) => ({ uid: `u-${name}`, kind: 'custom', refId: null, name, lat, lon });
  // LGTT → 8 points → LGMG (9 legs: sheet 1 ends at LGMG) → 3 points → LGKL
  const route = [at('LGTT')];
  for (let i = 0; i < 8; i++) route.push(pt(`W${i + 1}`, 38.1 - 0.02 * i, 23.7 - 0.04 * i));
  route.push(at('LGMG'));
  for (let i = 0; i < 3; i++) route.push(pt(`S${i + 1}`, 37.9 - 0.15 * i, 22.9 - 0.25 * i));
  route.push(at('LGKL'));
  const f = await postFlight({ route, blockOff: '09:00' });
  await page.goto(`${server.url}/flights/${f.id}/export/navlog`);
  await page.waitFor(() => document.querySelector('[data-testid=navlog-export]')?.dataset.ready === 'true', {
    timeout: 20000,
  });
  assert.equal(await page.eval(() => document.querySelector('[data-testid=navlog-export]').dataset.sheets), '2');
  const sheets = await page.eval(() =>
    [...document.querySelectorAll('.md42')].map((s) => ({
      // vertical centre of every checkpoint name box, in sheet units, top to bottom
      cps: [...s.querySelectorAll('.cpn')]
        .filter((e) => e.textContent.trim())
        .map((e) => {
          const r = e.getBoundingClientRect();
          return {
            name: e.textContent.trim(),
            y: (r.top + r.height / 2 - s.getBoundingClientRect().top) / (s.offsetWidth / 1145),
          };
        })
        .sort((a, b) => a.y - b.y),
      arrival: s.querySelector('.end-lbl-bottom')?.textContent ?? '',
      fields: [...s.querySelectorAll('.foot .ti [data-fit-ti=field]')].map((e) => e.textContent.trim()).filter(Boolean),
    })),
  );
  const [a, b] = sheets;
  assert.deepEqual(
    a.cps.map((c) => c.name),
    ['LGTT', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'LGMG'],
  );
  const gaps = a.cps.slice(1).map((c, i) => c.y - a.cps[i].y);
  for (const g of gaps)
    assert.ok(Math.abs(g - 54) < 0.5, `checkpoint spacing ${gaps.map((x) => x.toFixed(1)).join(', ')}`);
  assert.equal(a.arrival, '');
  assert.deepEqual(
    b.cps.map((c) => c.name),
    ['LGMG', 'S1', 'S2', 'S3', 'LGKL'],
  );
  assert.ok(
    a.fields.includes('LGTT') && a.fields.includes('LGMG') && !a.fields.includes('LGKL'),
    `sheet 1: ${a.fields}`,
  );
  assert.ok(!b.fields.includes('LGTT') && b.fields.includes('LGKL'), `sheet 2: ${b.fields}`);
  if (process.env.SHOTS) await page.screenshot('smoke-navlog-sheets');
  assert.deepEqual(page.errors, []);
});

test('new flight asks for the ends: an unknown aerodrome says so and blocks Create; About names the sources', async () => {
  await page.goto(`${server.url}/flights/new?ask=1`);
  await page.waitFor(() => !!document.querySelector('[data-testid=new-flight-form]'));
  await page.type('input[name=from]', 'LGMG');
  await page.type('input[name=to]', 'XXQQ');
  await page.click('h1');
  await page.waitFor(() =>
    /Not an aerodrome/.test(document.querySelectorAll('[data-testid=aerodrome-status]')[1]?.textContent || ''),
  );
  assert.equal(await page.eval(() => document.querySelector('[data-testid=create-flight]').disabled), true);
  await page.type('input[name=to]', 'LGSY');
  await page.click('h1');
  await page.waitFor(() => !document.querySelector('[data-testid=create-flight]').disabled);
  await page.click('[data-testid=create-flight]');
  await page.waitFor(
    () =>
      /^\/flights\/[\w-]+$/.test(location.pathname) &&
      document.querySelector('[data-testid=flight-title]')?.textContent === 'LGMG → LGSY',
  );

  await page.goto(`${server.url}/about`);
  await page.waitFor(
    () => document.querySelector('[data-testid=about-weather-model]')?.textContent === 'ECMWF IFS 0.25°',
  );
});
