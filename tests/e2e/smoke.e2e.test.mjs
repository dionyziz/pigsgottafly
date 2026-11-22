// End-to-end smoke test of the v3 shell: sign-up → lobby → new flight → editor → export page.
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

/** Opens a stage of the flight panel (plan, brief, file): only its sections are shown. */
const stage = async (s) => {
  await page.click(`[data-testid=stage-${s}]`);
  await page.waitFor((s) => document.querySelector(`[data-testid=stage-body-${s}]`)?.hidden === false, { args: [s] });
};

test('a new account lands in the lobby; its first flight asks for the home aerodrome; the papers ask for the PIC details', async () => {
  // sign-up asks for nothing: the lobby, with only the e-mail
  await page.goto(server.url + '/');
  await page.waitFor(() => location.pathname === '/' && !!document.querySelector('[data-testid=new-flight]'));
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=profile-form]')), false);
  const me0 = await (await fetch(`${server.url}/api/me`)).json();
  assert.deepEqual([me0.fullName, me0.phone, me0.homeAerodrome], ['', '', null]);

  // the first flight asks for the home aerodrome (only that), which the flight then starts from
  await page.click('[data-testid=new-flight]');
  await page.waitFor(() => !!document.querySelector('[data-testid=home-form]'));
  assert.equal(await page.eval(() => !!document.querySelector('input[name=from]')), false);
  await page.type('input[name=home]', 'LGTT');
  await page.click('h1');
  await page.waitFor(() => !document.querySelector('[data-testid=create-flight]').disabled);
  await page.click('[data-testid=create-flight]');
  await page.waitFor(
    () => /^\/flights\/[\w-]+$/.test(location.pathname) && !!document.querySelector('[data-testid=editor]'),
  );
  await page.waitFor(async () => (await (await fetch('/api/me')).json()).homeAerodrome === 'LGTT');
  const first = await page.eval(() => location.pathname);

  // Ready to fly says what the papers need from the PIC, and its link comes back to the flight
  await stage('plan');
  await page.waitFor(() => !!document.querySelector('[data-testid=ready-item][data-id=profile]'));
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=ready-item][data-id=profile]').textContent),
    'Your detailsThe flight plan and Form 731 need your name, phone and ID or passport number.Add your name, phone and ID number →',
  );
  await page.click('[data-testid=ready-item][data-id=profile] a.rd-act');
  await page.waitFor(
    () => !!document.querySelector('[data-testid=pilot-dialog]') && document.activeElement?.name === 'fullName',
  );
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=flow-back]')?.textContent),
    'Back to the flight',
  );
  await page.key('Escape');
  await page.waitFor((p) => location.pathname === p && !!document.querySelector('[data-testid=editor]'), {
    args: [first],
  });

  // the flight plan: the PIC's name and phone are missing, each with its fix; Done comes back
  const fpl = `${first}/export/fpl`;
  await page.goto(server.url + fpl);
  await page.waitFor(() =>
    /name not set/.test(document.querySelector('[data-testid=fpl-warnings]')?.textContent || ''),
  );
  const hrefs = await page.eval(() =>
    [...document.querySelectorAll('[data-testid=fpl-warnings] a')].map((a) => a.getAttribute('href')),
  );
  const back = `&back=${encodeURIComponent(fpl)}`;
  assert.ok(hrefs.includes(`/passengers?edit=me&fields=fullName${back}`), hrefs.join(' '));
  assert.ok(hrefs.includes(`/passengers?edit=me&fields=phone${back}`), hrefs.join(' '));
  await page.eval(
    (h) => document.querySelector(`[data-testid=fpl-warnings] a[href="${h}"]`).click(),
    `/passengers?edit=me&fields=fullName${back}`,
  );
  await page.waitFor(() => !!document.querySelector('[data-testid=pilot-dialog]'));
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=flow-back]')?.textContent),
    'Back to Flight plan (AFTN)',
  );
  await page.type('[data-testid=pilot-dialog] input[name=fullName]', 'Test Pilot');
  await page.type('[data-testid=pilot-dialog] input[name=phone]', '+30 690 000 0000');
  await page.click('[data-testid=dialog-done]');
  await page.waitFor(
    (p) =>
      location.pathname === p &&
      !!document.querySelector('[data-testid=fpl-warnings]') &&
      !/name not set|phone number not set/.test(document.querySelector('[data-testid=fpl-warnings]').textContent),
    { args: [fpl] },
  );
  const me = await (await fetch(`${server.url}/api/me`)).json();
  assert.deepEqual([me.fullName, me.phone], ['Test Pilot', '+30 690 000 0000']);

  // the next new flight starts at home without asking
  await page.goto(server.url + '/');
  await page.waitFor(() => !!document.querySelector('[data-testid=new-flight]'));
  await page.click('[data-testid=new-flight]');
  await page.waitFor(
    () => /^\/flights\/[\w-]+$/.test(location.pathname) && !!document.querySelector('[data-testid=editor]'),
  );
  await page.waitFor(() => !!document.querySelector('[data-testid=map] canvas'));
  const title = await page.eval(() => document.querySelector('[data-testid=flight-title]').textContent);
  assert.match(title, /^\d{4}-\d{2}-\d{2}$/, 'a new flight is titled with its date');

  // an edit is saved to the server
  await stage('plan');
  await page.type('[data-testid=flight-panel] input[placeholder="HH:MM"]', '09:30');
  await page.blur();
  await page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', {
    timeout: 10000,
  });
  const id = await page.eval(() => location.pathname.split('/').pop());
  const f = await (await fetch(`${server.url}/api/flights/${id}`)).json();
  assert.equal(f.blockOff, '09:30');

  // the lobby lists it; the export route renders (home → home is a local flight: no navlog, its flight plan)
  await page.goto(server.url + '/');
  await page.waitFor((id) => !!document.querySelector(`[data-flight-id="${id}"]`), { args: [id] });
  await page.goto(`${server.url}/flights/${id}/export/navlog`);
  await page.waitFor(() => document.querySelector('[data-testid=export-page]')?.dataset.kind === 'fpl');
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
  await stage('plan');
  await page.type('[data-testid=route-destination] input', 'LGMG');
  await page.blur();
  let f;
  for (let i = 0; i < 100; i++) {
    f = await (await fetch(`${server.url}/api/flights/${f0.id}`)).json();
    if (f.route[f.route.length - 1]?.name === 'LGMG') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(
    f.route.map((p) => [p.name, p.kind]),
    [
      ['LGTT', 'aerodrome'],
      ['LGMG', 'aerodrome'],
    ],
  );
  if (process.env.SHOTS) await page.screenshot('smoke-route-ends', { fullPage: false });
});

test('editor boxes: header toggles, ATC rows removable, not reorderable, a warning fixed in place', async () => {
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
  await stage('plan');
  await page.click('[data-testid=section-when] .collapsible-title');
  await page.waitFor(() => document.querySelector('[data-testid=section-when]').classList.contains('collapsed'));
  await page.click('[data-testid=section-when] .collapsible-badge');
  await page.waitFor(() => !document.querySelector('[data-testid=section-when]').classList.contains('collapsed'));
  // the navlog strip's header too
  await page.click('.ns-title');
  await page.waitFor(() => document.querySelector('[data-testid=navlog-strip]').classList.contains('closed'));
  await page.click('.ns-title');
  await page.waitFor(() => !document.querySelector('[data-testid=navlog-strip]').classList.contains('closed'));

  // ATC: rows have no drag handle; removing one saves the list on the flight
  await stage('brief');
  const names = () =>
    page.eval(() =>
      [...document.querySelectorAll('[data-testid=atc-row] .ep-atc-cs')].map((e) => e.firstChild.textContent),
    );
  assert.equal(await page.eval(() => document.querySelectorAll('[data-testid=atc-row] .drag-handle').length), 0);
  const before = await names();
  await page.click('[data-testid=atc-remove]');
  await page.waitFor((b) => document.querySelectorAll('[data-testid=atc-row]').length === b.length - 1, {
    args: [before],
  });
  await saved();
  const f = await (await fetch(`${server.url}/api/flights/${f0.id}`)).json();
  assert.deepEqual(
    f.atc.map((e) => e.callsign),
    before.slice(1),
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
  await stage('plan');
  await page.click('[data-testid=section-aircraft] .collapsible-title');
  await page.waitFor(() => document.querySelector('[data-testid=section-aircraft]').classList.contains('collapsed'));
  // from another stage: the Fix switches to Plan, which holds the Aircraft box
  await stage('brief');
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
  assert.equal(await page.eval(() => document.querySelector('[data-testid=stage-body-plan]').hidden), false);
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
      /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector('[data-testid=flight-title]')?.textContent ?? ''),
  );

  await page.goto(`${server.url}/about`);
  await page.waitFor(
    () => document.querySelector('[data-testid=about-weather-model]')?.textContent === 'ECMWF IFS 0.25°',
  );
});

test('flight plan requests: a touch-and-go and a stop at one aerodrome, stops at both ends, their remarks; ticking moves no row', async () => {
  const ads = await (await fetch(`${server.url}/api/ref/aerodromes`)).json();
  const at = (icao, uid) => {
    const a = ads.find((x) => x.icao === icao);
    return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
  };
  const f0 = await postFlight({ route: [at('LGTT', 'r-a'), at('LGMG', 'r-b'), at('LGTT', 'r-c')], blockOff: '09:00' });
  await page.goto(`${server.url}/flights/${f0.id}`);
  await page.waitFor(() => !!document.querySelector('[data-testid=fpl-request-2]'));
  const box = (sel) =>
    page.eval((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { top: r.top, left: r.left, height: r.height };
    }, sel);
  const click = (sel) => page.eval((s) => document.querySelector(s).click(), sel);

  // the columns line up across the rows (the departure's "Touch-and-go first" included)
  const tngLeft = [];
  for (const i of [0, 1, 2]) tngLeft.push((await box(`[data-testid=fpl-tng-${i}]`)).left);
  assert.ok(
    tngLeft.every((x) => Math.abs(x - tngLeft[0]) < 0.5),
    `touch-and-go column ${tngLeft}`,
  );
  // Stop at the departure and the destination too, in one column
  const stopLeft = [];
  for (const i of [0, 1, 2]) stopLeft.push((await box(`[data-testid=fpl-stop-${i}]`)).left);
  assert.ok(
    stopLeft.every((x) => Math.abs(x - stopLeft[0]) < 0.5),
    `stop column ${stopLeft}`,
  );
  // the minutes field keeps its place while Stop is off, so ticking Stop moves nothing
  const minVisibility = () =>
    page.eval(() => getComputedStyle(document.querySelector('[data-testid=fpl-stop-min-1]')).visibility);
  assert.equal(await minVisibility(), 'hidden');
  await page.eval(() => document.querySelector('[data-testid=fpl-requests]').scrollIntoView({ block: 'center' }));
  const rowBefore = await box('[data-testid=fpl-request-2]');
  const remarksBefore = await box('[data-testid=fpl-remarks]');
  await click('[data-testid=fpl-tng-1]');
  await click('[data-testid=fpl-stop-1]');
  await click('[data-testid=fpl-stop-0]');
  await click('[data-testid=fpl-stop-2]');
  await page.waitFor(() =>
    [0, 1, 2].every(
      (i) => getComputedStyle(document.querySelector(`[data-testid=fpl-stop-min-${i}]`)).visibility === 'visible',
    ),
  );
  // (the boxes above that grow with the requests are absorbed by the panel's scroll anchoring)
  for (const [sel, was] of [
    ['[data-testid=fpl-request-2]', rowBefore],
    ['[data-testid=fpl-remarks]', remarksBefore],
  ]) {
    const now = await box(sel);
    assert.ok(Math.abs(now.top - was.top) < 1 && now.height === was.height, `${sel} moved: ${was.top} → ${now.top}`);
  }
  assert.equal(await page.eval(() => document.querySelector('[data-testid=fpl-tng-1]').checked), true);
  if (process.env.SHOTS) await page.screenshot('smoke-fpl-requests', { fullPage: false });
  assert.doesNotMatch(await page.eval(() => document.querySelector('[data-testid=fpl-requests]').textContent), /RMK/);

  await page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', {
    timeout: 10000,
  });
  const f = await (await fetch(`${server.url}/api/flights/${f0.id}`)).json();
  assert.deepEqual(
    f.options.aerodromeRequests.map((r) => [r.pointUid, r.kind, r.stopMin ?? null]),
    [
      ['r-b', 'touch-and-go', null],
      ['r-b', 'stop', 10],
      ['r-a', 'stop', 10],
      ['r-c', 'stop', 10],
    ],
  );

  // item 18: every remark in the one RMK/, in route order, a point's touch-and-go before its stop
  await page.goto(`${server.url}/flights/${f0.id}/export/fpl`);
  await page.waitFor(
    () => !!document.querySelector('[data-testid=fpl-message]') && !document.querySelector('.fpl-loading'),
    { timeout: 20000 },
  );
  const msg = await page.eval(() => document.querySelector('[data-testid=fpl-message]').textContent);
  assert.match(
    msg.replace(/\s+/g, ' '),
    /RMK\/INITIALLY REQUEST FULL STOP AT LGTT FOR 10 MIN REQUEST TOUCH N GO AT LGMG REQUEST INTERMEDIATE STOP AT LGMG FOR 10 MIN REQUEST FULL STOP AT LGTT FOR 10 MIN THEN CIRCUIT/,
  );
  assert.deepEqual(page.errors, []);
});
