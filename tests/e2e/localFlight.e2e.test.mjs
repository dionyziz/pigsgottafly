// End-to-end test of a local flight (LGTT → LGTT, nothing between): the new-flight page's Local flight
// box and estimated total time, the editor's Local flight box (destination locked to the origin, the
// map not drawable), the flight plan with route LOCAL and the time as total EET, and no navlog.
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

const text = (sel) => page.eval((s) => document.querySelector(s)?.textContent ?? null, sel);

test('a local flight: chosen on the new-flight page, 1:30 in the editor, LOCAL -LGTT0130 in the flight plan, no navlog', async () => {
  await page.goto(server.url + '/');
  await page.waitFor(() => !!document.querySelector('[data-testid=new-flight]'));
  await page.eval(() =>
    fetch('/api/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeAerodrome: 'LGTT' }),
    }),
  );

  await page.goto(`${server.url}/flights/new?ask=1`);
  await page.waitFor(() => !!document.querySelector('[data-testid=new-flight-form]'));
  await page.type('input[name=from]', 'LGTT');
  await page.click('[data-testid=new-flight-local]');
  await page.waitFor(() => document.querySelector('[data-testid=new-flight-local-to]')?.value === 'LGTT');
  assert.equal(await page.eval(() => document.querySelector('[data-testid=new-flight-duration]').value), '1:00');
  await page.click('[data-testid=create-flight]');
  await page.waitFor(
    () => /^\/flights\/[\w-]+$/.test(location.pathname) && !!document.querySelector('[data-testid=editor]'),
  );
  const id = await page.eval(() => location.pathname.split('/').pop());

  // a new flight opens on Plan even though it is for today: the route section, the duration, no navlog strip
  await page.waitFor(() => document.querySelector('[data-testid=stage-body-plan]')?.hidden === false);
  await page.waitFor(() => document.querySelector('[data-testid=route-local]')?.checked === true);
  const dest = () =>
    page.eval(() => {
      const i = document.querySelector('[data-testid=route-destination] input');
      return { value: i.value, disabled: i.disabled };
    });
  assert.deepEqual(await dest(), { value: 'LGTT', disabled: true });
  assert.equal(await page.eval(() => document.querySelector('[data-testid=local-duration]').value), '1:00');
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=navlog-strip]')), false);
  // nothing to draw on the map
  await page.waitFor(() => document.querySelector('[data-testid=map-draw]')?.disabled === true);
  assert.equal(await page.eval(() => document.querySelector('.pgf-map').classList.contains('is-drawing')), false);

  // unticked: the destination opens (empty), the time goes, the map draws; ticked again: local as before
  await page.click('[data-testid=route-local]');
  await page.waitFor(() => !document.querySelector('[data-testid=route-destination] input').disabled);
  assert.deepEqual(await dest(), { value: '', disabled: false });
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=local-duration]')), false);
  assert.equal(await page.eval(() => document.querySelector('[data-testid=map-draw]').disabled), false);
  await page.click('[data-testid=route-local]');
  await page.waitFor(() => document.querySelector('[data-testid=route-destination] input').disabled);
  assert.deepEqual(await dest(), { value: 'LGTT', disabled: true });

  await page.type('[data-testid=local-duration]', '1:30');
  await page.key('Enter');
  await page.waitFor(async (id) => (await (await fetch(`/api/flights/${id}`)).json()).options.localDurationMin === 90, {
    args: [id],
    timeout: 10000,
  });

  // the flight plan: route LOCAL, the departure as destination with the duration; no Navlog tab
  await page.goto(`${server.url}/flights/${id}/export/fpl`);
  await page.waitFor(
    () => !!document.querySelector('[data-testid=fpl-message]') && !document.querySelector('.fpl-loading'),
  );
  const msg = await text('[data-testid=fpl-message]');
  assert.match(msg, /VFR LOCAL\n-LGTT0130/);
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=export-tab-navlog]')), false);
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=export-tab-fpl]')), true);

  // the navlog's address goes to the flight plan
  await page.goto(`${server.url}/flights/${id}/export/navlog`);
  await page.waitFor(() => location.pathname.endsWith('/export/fpl'));

  // the lobby row
  await page.goto(server.url + '/');
  await page.waitFor(
    (id) => /LGTT local · 1:30/.test(document.querySelector(`[data-flight-id="${id}"] .sub`)?.textContent ?? ''),
    { args: [id], timeout: 10000 },
  );
  assert.deepEqual(page.errors, []);
});
