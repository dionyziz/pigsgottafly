// End-to-end smoke test of the v3 shell: onboarding → lobby → new flight → editor → export page.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer } from './harness.mjs';

let server, browser, page;
before(async () => {
  server = await startServer();
  browser = await launch();
  page = await browser.newPage();
});
after(async () => { await page?.close(); await browser?.close(); await server?.close(); });

test('first use asks for the profile, then the lobby, a new flight and the editor work', async () => {
  await page.goto(server.url + '/');
  await page.waitFor(() => location.pathname === '/profile' && !!document.querySelector('[data-testid=profile-form]'));
  await page.type('input[name=fullName]', 'Test Pilot');
  await page.type('input[name=phone]', '+30 690 000 0000');
  await page.type('input[name=homeAerodrome]', 'LGTT');
  await page.click('[data-testid=profile-form] button[type=submit]');
  await page.waitFor(() => location.pathname === '/' && !!document.querySelector('[data-testid=new-flight]'));

  await page.click('[data-testid=new-flight]');
  await page.waitFor(() => /^\/flights\/[\w-]+$/.test(location.pathname) && !!document.querySelector('[data-testid=editor]'));
  await page.waitFor(() => !!document.querySelector('[data-testid=map] canvas'));
  const title = await page.eval(() => document.querySelector('[data-testid=flight-title]').textContent);
  assert.equal(title, 'LGTT → LGTT');

  // an edit is saved to the server
  await page.type('[data-testid=flight-panel] input[placeholder="HH:MM"]', '09:30');
  await page.blur();
  await page.waitFor(() => document.querySelector('[data-testid=save-state]').textContent === 'Saved', { timeout: 10000 });
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
