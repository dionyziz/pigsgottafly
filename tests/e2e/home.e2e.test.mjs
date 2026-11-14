// End-to-end: the flights app around the sheet — home list, new flights, menus, permalinks,
// server sync between browsers, offline edits, and Google sign-in.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, launch } from './harness.mjs';
import { menuItem, readSheet, v, windyUrl, setAlts, layoutAudit } from './app.mjs';
import * as O from './oracle.mjs';

const UNIFORM = () => ({ dir: 250, spd: 12, temp: 8 });
const LGMG = { lat: 37.98139, lon: 23.36611 }, LGEL = { lat: 38.06361, lon: 23.55583 }, LGTT = { lat: 38.10861, lon: 23.78333 };
const DATE = '2026-11-17';
let server, browser, pages = [];
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); server.close(); });
afterEach(async () => { for (const p of pages) { assert.deepEqual(p.errors, [], 'no page errors'); await p.close(); } pages = []; });
async function newPage(b = browser) { const p = await b.newPage(); p.errors = []; await p.mockOpenMeteo(O.openMeteoResponder(UNIFORM)); pages.push(p); return p; }
const rows = (page) => page.eval(() => [...document.querySelectorAll('.frow')].map((r) => ({ id: r.dataset.id, title: r.querySelector('.ft').textContent, cols: [...r.querySelectorAll('.col')].map((c) => c.textContent) })));
const onFlight = (page) => page.waitFor(() => /^#\/f\//.test(location.hash) && !document.querySelector('#flight').hidden && !!document.querySelector('.sheet'));
const onHome = (page) => page.waitFor(() => !document.querySelector('#home').hidden && !document.body.classList.contains('loading'));
const saved = (page) => page.waitFor(() => document.querySelector('#save-state').textContent === 'Saved', { timeout: 10000 });

test('home: new flight from Windy, list with totals, rename, copy, trash with undo, search', async () => {
  const page = await newPage();
  await page.goto(server.url + '/#/');
  await onHome(page);
  assert.equal(await page.eval(() => document.querySelector('#empty').textContent), 'No flights yet.');
  await page.screenshot('home-empty', { fullPage: false });

  await page.click('#new-windy');
  await page.waitFor(() => document.querySelector('#route-dialog').open);
  await page.paste('#windy-url', windyUrl([LGMG, LGEL, LGMG], DATE, 9));
  await onFlight(page);
  await page.waitFor(() => document.querySelector('.sheet [data-key="dep"]').value === 'LGMG');
  assert.equal(await page.eval(() => document.querySelector('#title').value), 'LGMG → LGEL → LGMG');
  const id = await page.eval(() => location.hash.slice(4));
  await saved(page);

  await page.click('.back');
  await onHome(page);
  await page.waitFor(() => document.querySelectorAll('.frow').length === 1);
  let r = await rows(page);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'LGMG → LGEL → LGMG');
  assert.equal(r[0].id, id);
  assert.equal(r[0].cols[0], DATE);
  assert.match(r[0].cols[1], /^0:\d\d · \d+ NM$/);
  assert.match(r[0].cols[2], /^\d+ L$/);
  assert.equal(await page.eval(() => document.querySelectorAll('.frow .thumb circle').length), 3, 'route thumbnail');

  // ⋮ → Rename
  await page.click('.frow .more');
  await page.click('#row-menu [data-act="rename"]');
  await page.waitFor(() => document.querySelector('#rename-dialog').open);
  await page.type('#rename-input', 'Megara circuit');
  await page.key('Enter');
  await page.waitFor(() => document.querySelector('.frow .ft')?.textContent === 'Megara circuit');
  // ⋮ → Make a copy
  await page.click('.frow .more');
  await page.click('#row-menu [data-act="copy"]');
  await page.waitFor(() => document.querySelectorAll('.frow').length === 2);
  assert.ok((await rows(page)).some((x) => x.title === 'Copy of Megara circuit'));
  // ⋮ → Move to trash, then Undo
  await page.eval(() => [...document.querySelectorAll('.frow')].find((x) => x.querySelector('.ft').textContent.startsWith('Copy')).querySelector('.more').click());
  await page.click('#row-menu [data-act="delete"]');
  await page.waitFor(() => document.querySelectorAll('.frow').length === 1);
  assert.match(await page.eval(() => document.querySelector('#toast-text').textContent), /moved to trash/);
  await page.click('#toast-action');
  await page.waitFor(() => document.querySelectorAll('.frow').length === 2);
  // search
  await page.type('#search', 'copy');
  await page.waitFor(() => document.querySelectorAll('.frow').length === 1);
  await page.type('#search', 'zzz');
  await page.waitFor(() => document.querySelector('#empty').textContent === 'No matching flights.');
  await page.type('#search', '');
  await page.screenshot('home-list', { fullPage: false });
  for (const [w, h] of [[1440, 900], [1024, 700]]) {
    await page.viewport(w, h); await page.idle(150);
    assert.equal(await page.eval(() => document.documentElement.scrollWidth <= innerWidth), true, `no horizontal scroll at ${w}`);
  }
});

test('flight: permalink, title, menus, back/forward, and sync to another browser', async () => {
  const page = await newPage();
  await page.goto(server.url + '/#/');
  await onHome(page);
  await page.click('#new-blank');
  await onFlight(page);
  const url = await page.eval(() => location.href);
  assert.equal(await page.eval(() => document.querySelector('#title').value), 'Untitled flight');
  await menuItem(page, '#btn-route');
  await page.paste('#windy-url', windyUrl([LGTT, LGMG], DATE, 10));
  await page.waitFor(() => document.querySelector('.sheet [data-key="cp0"]').value === 'LGMG');
  await page.type('#title', 'Tatoi to Megara');
  await page.key('Enter');
  await page.type('.sheet.active [data-key="H.qnh"]', '1018');
  await page.key('Enter');
  await saved(page);
  assert.equal(await page.eval(() => document.title), 'Tatoi to Megara · Navlog');

  // the menus show only what is available
  await page.click('.menu-btn[data-menu="edit"]');
  assert.equal(await page.eval(() => document.querySelector('#btn-undo').disabled), false);
  assert.equal(await page.eval(() => document.querySelector('#btn-restore-rows').hidden), true, 'no removed rows -> no restore item');
  await page.screenshot('menu-edit', { fullPage: false });
  await page.key('Escape');
  assert.equal(await page.eval(() => document.querySelector('.menu[data-menu="edit"]').hidden), true);

  // reload the permalink
  await page.reload();
  await onFlight(page);
  assert.equal(await page.eval(() => document.querySelector('#title').value), 'Tatoi to Megara');
  assert.equal(v(await readSheet(page), 'H.qnh'), '1018');
  // back to the list and forward again
  await page.eval(() => history.back());
  await onHome(page);
  await page.eval(() => history.forward());
  await onFlight(page);

  // a different browser (own storage): the link opens the same flight from the server
  const other = await launch();
  try {
    const p2 = await newPage(other);
    await p2.goto(url);
    await onFlight(p2);
    assert.equal(await p2.eval(() => document.querySelector('#title').value), 'Tatoi to Megara');
    assert.equal(v(await readSheet(p2), 'H.qnh'), '1018');
    assert.equal(v(await readSheet(p2), 'dep'), 'LGTT');
    // an edit there shows up here after reopening
    await p2.type('.sheet.active [data-key="H.runway"]', '21');
    await p2.key('Enter');
    await saved(p2);
    await page.reload();
    await onFlight(page);
    assert.equal(v(await readSheet(page), 'H.runway'), '21');
    pages = pages.filter((p) => p !== p2); await p2.close();
  } finally { await other.close(); }

  // File → Make a copy opens the copy; File → Move to trash returns to the list with Undo
  await menuItem(page, '#btn-copy');
  await page.waitFor((u) => location.href !== u && !!document.querySelector('.sheet'), { args: [url] });
  await page.waitFor(() => document.querySelector('#title').value === 'Copy of Tatoi to Megara');
  await menuItem(page, '#btn-delete');
  await onHome(page);
  await page.waitFor(() => document.querySelectorAll('.frow').length > 0 && ![...document.querySelectorAll('.frow .ft')].some((e) => e.textContent === 'Copy of Tatoi to Megara'));
  await page.click('#toast-action');
  await onFlight(page);
  assert.equal(await page.eval(() => document.querySelector('#title').value), 'Copy of Tatoi to Megara');
  assert.deepEqual(await layoutAudit(page), []);
  await page.screenshot('flight-doc', { fullPage: false });

  // unknown permalink
  await page.goto(server.url + '/#/f/doesnotexist');
  await onHome(page);
  assert.match(await page.eval(() => document.querySelector('#toast-text').textContent), /not found/);
});

test('offline: edits are kept on this device and synced when the server is back', async () => {
  const page = await newPage();
  let down = false;
  await page.intercept(server.url + '/api/*', () => (down ? { status: 503, body: { error: 'down' } } : null));
  await page.goto(server.url + '/#/');
  await onHome(page);
  await page.click('#new-blank');
  await onFlight(page);
  const url = await page.eval(() => location.href);
  await saved(page);
  down = true;
  await page.type('.sheet.active [data-key="H.atis"]', 'K');
  await page.key('Enter');
  await page.waitFor(() => /Offline/.test(document.querySelector('#save-state').textContent), { timeout: 10000 });
  down = false;
  await saved(page);
  const other = await launch();
  try {
    const p2 = await newPage(other);
    await p2.goto(url);
    await onFlight(p2);
    assert.equal(v(await readSheet(p2), 'H.atis'), 'K', 'the offline edit reached the server');
    pages = pages.filter((p) => p !== p2); await p2.close();
  } finally { await other.close(); }
});

test('Google sign-in: only the allowed account gets in, once per browser', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const CID = 'navlog-test.apps.googleusercontent.com';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 't1', alg: 'RS256', use: 'sig' };
  const sign = (email) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 't1' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CID, email, name: 'Test Pilot', email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
  };
  const secure = await startServer({ googleClientId: CID, allowedEmails: ['pilot@example.com'], googleKeys: async () => [jwk] });
  try {
    const page = await newPage();
    let credential = sign('someone@example.com');
    // stand-in for https://accounts.google.com/gsi/client: renders a button that "signs in"
    await page.intercept('https://accounts.google.com/gsi/client*', () => ({ contentType: 'text/javascript', body: `
      window.google = { accounts: { id: {
        initialize(c) { window.__gcfg = c; },
        renderButton(el) { const b = document.createElement('button'); b.id = 'fake-google'; b.textContent = 'Sign in with Google'; b.onclick = () => window.__gcfg.callback({ credential: window.__cred }); el.appendChild(b); },
        prompt() {} } } };` }));
    await page.goto(secure.url + '/#/');
    await page.waitFor(() => !document.querySelector('#login').hidden && !!document.querySelector('#fake-google'));
    assert.equal((await page.eval(() => fetch('api/flights').then((r) => r.status))), 401, 'API closed before sign-in');
    assert.equal(await page.eval(() => window.__gcfg.client_id), CID);
    await page.screenshot('login', { fullPage: false });

    await page.eval((c) => { window.__cred = c; }, credential);
    await page.click('#fake-google');
    await page.waitFor(() => !document.querySelector('#login-error').hidden);
    assert.match(await page.eval(() => document.querySelector('#login-error').textContent), /can’t open/);

    credential = sign('pilot@example.com');
    await page.eval((c) => { window.__cred = c; }, credential);
    await page.click('#fake-google');
    await page.waitFor(() => document.querySelector('#login').hidden && !document.querySelector('#home').hidden);
    await page.click('#new-blank');
    await onFlight(page);
    await page.reload();          // the session cookie keeps us signed in
    await onFlight(page);
    assert.equal(await page.eval(() => document.querySelector('#login').hidden), true);
    // signed-in account at the top right, with Sign out
    assert.equal(await page.eval(() => !document.querySelector('#flight .account').hidden && document.querySelector('#flight .avatar').textContent.trim()), 'T');
    await page.click('#flight .avatar');
    assert.match(await page.eval(() => document.querySelector('#flight .account-menu').textContent), /Test Pilot\s*pilot@example\.com/);
    await page.screenshot('account-menu', { fullPage: false });
    const loaded = new Promise((r) => page.on('Page.loadEventFired', r));
    await page.click('#flight .sign-out');
    await loaded;
    await page.waitFor(() => !document.querySelector('#login').hidden);
  } finally { secure.close(); }
});

test('route dialog: OK and Enter create the flight, even for a route opened before; bad links explain themselves', async () => {
  const page = await newPage();
  await page.goto(server.url + '/#/');
  await onHome(page);
  const url = windyUrl([LGMG, LGEL], DATE, 9);
  for (const how of ['ok', 'enter']) {
    await page.click('#new-windy');
    await page.waitFor(() => document.querySelector('#route-dialog').open);
    assert.equal(await page.eval(() => document.querySelector('#route-ok').textContent), 'Create flight');
    await page.eval((u) => { const e = document.querySelector('#windy-url'); e.focus(); e.value = u; }, url);   // set without an input event
    if (how === 'ok') await page.click('#route-ok'); else await page.key('Enter');
    await onFlight(page);
    await page.waitFor(() => document.querySelector('.sheet [data-key="cp0"]').value === 'LGEL');
    await page.click('.back');
    await onHome(page);
  }
  await page.waitFor(() => document.querySelectorAll('.frow').length >= 2);
  await page.click('#new-windy');
  await page.paste('#windy-url', 'https://www.windy.com/?37.9,23.5,8');
  await page.click('#route-ok');
  await page.waitFor(() => document.querySelector('#route-hint').classList.contains('err'));
  assert.equal(await page.eval(() => document.querySelector('#route-dialog').open), true);
  await page.screenshot('route-dialog-error', { fullPage: false });
});
