// Edits made in one tab show up in the others without a reload (src/data/entityStore.ts:
// BroadcastChannel 'pgf'): the profile's licence number clears the passengers page's
// "Missing … licence number" in another tab, and a flight renamed in one lobby is renamed in the other.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { launch, startServer } from './harness.mjs';

let server, browser, a, b;
before(async () => {
  server = await startServer();
  browser = await launch();
  a = await browser.newPage();
  b = await browser.newPage();
});
after(async () => {
  await a?.close();
  await b?.close();
  await browser?.close();
  await server?.close();
});

const api = async (method, p, body) => {
  const r = await fetch(`${server.url}/api/${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status === 204 ? null : r.json();
};
/** SHOTS=<dir>: screenshots of each step there. */
const shot = async (page, name) => {
  if (!process.env.SHOTS) return;
  const f = await page.screenshot(name, { fullPage: false });
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  fs.copyFileSync(f, path.join(process.env.SHOTS, name + '.png'));
};
/** Switch to this tab (the other one becomes hidden, as in a real browser). */
const front = async (page) => {
  await page.send('Page.bringToFront');
  await page.waitFor(() => document.visibilityState === 'visible');
};
const missingText = (page) =>
  page.eval(() => document.querySelector('[data-testid=pilot-row] .hint')?.textContent ?? '');

test('a profile edit in one tab clears the warning in another', async () => {
  await api('PUT', 'me', {
    fullName: 'Test Pilot',
    phone: '+30 690 000 0000',
    homeAerodrome: 'LGTT',
    licenceNo: '',
    nationality: 'GR',
  });
  await a.viewport(1280, 800);
  await b.viewport(1280, 800);
  await front(a);
  await a.goto(server.url + '/passengers');
  await a.waitFor(() =>
    /licence number/.test(document.querySelector('[data-testid=pilot-row] .hint')?.textContent || ''),
  );
  await shot(a, 'freshness-1-tab-a-missing-licence');

  await front(b);
  await b.goto(server.url + '/profile');
  await b.waitFor(() => !!document.querySelector('input[name=licenceNo]'));
  await b.type('input[name=licenceNo]', 'GR.FCL.PPL.12345');
  await b.waitFor(() =>
    fetch('/api/me')
      .then((r) => r.json())
      .then((m) => m.licenceNo === 'GR.FCL.PPL.12345'),
  );
  assert.equal((await api('GET', 'me')).licenceNo, 'GR.FCL.PPL.12345');

  // back to tab A, not reloaded: what changed while it was hidden is refetched when it is shown
  assert.equal(await a.eval(() => document.visibilityState), 'hidden');
  await front(a);
  await a.waitFor(
    () => !/licence number/.test(document.querySelector('[data-testid=pilot-row] .hint')?.textContent || ''),
  );
  assert.doesNotMatch(await missingText(a), /licence number/);
  await shot(a, 'freshness-2-tab-a-after-tab-b-saved');
});

test('a flight renamed in one lobby is renamed in the other', async () => {
  const f = await api('POST', 'flights', {
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    title: 'Before',
  });
  await a.goto(server.url + '/');
  await b.goto(server.url + '/');
  for (const p of [a, b])
    await p.waitFor((id) => document.querySelector(`[data-flight-id="${id}"] .title`)?.textContent === 'Before', {
      args: [f.id],
    });

  await front(b);
  await b.click(`[data-flight-id="${f.id}"] [data-testid=row-menu]`);
  await b.waitFor(
    (id) =>
      [...document.querySelectorAll(`[data-flight-id="${id}"] .menu button`)].some(
        (e) => e.textContent.trim() === 'Rename',
      ),
    { args: [f.id] },
  );
  await b.eval(
    (id) =>
      [...document.querySelectorAll(`[data-flight-id="${id}"] .menu button`)]
        .find((e) => e.textContent.trim() === 'Rename')
        .click(),
    f.id,
  );
  await b.waitFor(() => !!document.querySelector('[data-testid=rename-dialog] input'));
  await b.type('[data-testid=rename-dialog] input', 'After');
  await b.key('Enter');
  await b.waitFor((id) => document.querySelector(`[data-flight-id="${id}"] .title`)?.textContent === 'After', {
    args: [f.id],
  });

  await front(a);
  await a.waitFor((id) => document.querySelector(`[data-flight-id="${id}"] .title`)?.textContent === 'After', {
    args: [f.id],
  });
  await shot(a, 'freshness-3-lobby-a-after-rename-in-b');
});
