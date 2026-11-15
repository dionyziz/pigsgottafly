// End-to-end: the public legal pages (/privacy, /terms: no sign-in), their links on the sign-in
// screen and in the account menu, and the profile's "Your data" / "Delete account" section
// (download, typed confirmation, deletion back to a fresh account). Google's sign-in script is
// stubbed: nothing is fetched from Google.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer } from './harness.mjs';

let local, google, browser, page;
before(async () => {
  local = await startServer();
  google = await startServer({ googleClientId: 'e2e.apps.googleusercontent.com', googleKeys: async () => [] });
  browser = await launch();
  page = await browser.newPage();
});
after(async () => { await page?.close(); await browser?.close(); await local?.close(); await google?.close(); });
const shot = async (name, o) => { if (process.env.SHOTS) await page.screenshot(name, o); };

test('sign-in screen: the consent line and footer link to the terms and privacy policy, readable without signing in', async () => {
  await page.intercept('https://accounts.google.com/gsi/client*', () => ({
    contentType: 'text/javascript',
    body: `window.google = { accounts: { id: { initialize() {}, prompt() {}, disableAutoSelect() {},
      renderButton(el) { el.innerHTML = '<div style="width:260px;height:40px;border:1px solid #dadce0;border-radius:20px;display:flex;align-items:center;justify-content:center;font:14px sans-serif;color:#3c4043">Sign in with Google</div>'; } } } };`,
  }));
  await page.goto(google.url + '/');
  await page.waitFor(() => !!document.querySelector('[data-testid=signin-consent]'));
  assert.equal(await page.eval(() => document.querySelector('[data-testid=signin-consent]').textContent.trim()),
    'By signing in you agree to the Terms and Privacy Policy.');
  assert.deepEqual(await page.eval(() => [...document.querySelectorAll('[data-testid=signin-footer] a')].map((a) => a.getAttribute('href'))), ['/terms', '/privacy']);
  await page.waitFor(() => /Sign in with Google/.test(document.body.textContent));
  await shot('account-signin');

  await page.click('[data-testid=signin-footer] a[href="/privacy"]');
  await page.waitFor(() => location.pathname === '/privacy' && !!document.querySelector('[data-testid=legal-privacy] h1'));
  await page.goto(google.url + '/terms');
  await page.waitFor(() => !!document.querySelector('[data-testid=legal-terms] h1'));
  assert.equal(await page.eval(() => document.querySelector('h1').textContent), 'Terms of Service');
  assert.deepEqual(page.errors, []);
});

test('the privacy policy and terms render with their sections and date', async () => {
  for (const [path, title, sections] of [['/privacy', 'Privacy Policy', 12], ['/terms', 'Terms of Service', 12]]) {
    await page.goto(local.url + path);
    await page.waitFor(() => !!document.querySelector('.legal-doc h1'));
    const doc = await page.eval(() => ({
      h1: document.querySelector('.legal-doc h1').textContent,
      date: document.querySelector('.legal-date').textContent,
      toc: document.querySelectorAll('.legal-toc li').length,
      h2: document.querySelectorAll('.legal-doc h2').length,
      title: document.title,
      contact: !!document.querySelector('a[href="mailto:dionyziz@gmail.com"]'),
    }));
    assert.equal(doc.h1, title);
    assert.equal(doc.date, 'Last updated 16 November 2026');
    assert.equal(doc.toc, sections);
    assert.equal(doc.h2, sections);
    assert.equal(doc.title, `${title} · Pig's Gotta Fly`);
    assert.ok(doc.contact);
    await shot(`account-${path.slice(1)}`);
  }
  // phone width: no horizontal scroll
  await page.viewport(375, 800);
  await page.goto(local.url + '/privacy');
  await page.waitFor(() => !!document.querySelector('.legal-doc h1'));
  assert.ok(await page.eval(() => document.documentElement.scrollWidth <= window.innerWidth));
  await shot('account-privacy-phone', { fullPage: false });
  await page.viewport(1280, 900);
  assert.deepEqual(page.errors, []);
});

test('profile: download my data, then delete the account with a typed confirmation', async () => {
  const api = async (method, path, body) => (await fetch(`${local.url}/api/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })).json();
  await api('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0000', homeAerodrome: 'LGTT', settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 } });
  await api('POST', 'passengers', { fullName: 'Pat Passenger' });
  await api('POST', 'aircraft', { registration: 'SX-BYE' });

  // the account menu links to both documents
  await page.goto(local.url + '/profile');
  await page.waitFor(() => !!document.querySelector('[data-testid=danger-zone]'));
  await page.click('[data-testid=account-button]');
  await page.waitFor(() => !!document.querySelector('.menu a[href="/privacy"]') && !!document.querySelector('.menu a[href="/terms"]'));
  await page.click('[data-testid=account-button]');

  // the download link serves the JSON export
  assert.equal(await page.eval(() => document.querySelector('[data-testid=export-data]').getAttribute('href')), '/api/me/export');
  const x = await page.eval(async () => { const r = await fetch('/api/me/export'); return { cd: r.headers.get('content-disposition'), body: await r.json() }; });
  assert.match(x.cd, /^attachment; filename="pigsgottafly-/);
  assert.deepEqual(x.body.passengers.map((p) => p.fullName), ['Pat Passenger']);
  assert.deepEqual(x.body.aircraft.map((a) => a.registration), ['SX-BYE']);

  await page.click('[data-testid=delete-account]');
  await page.waitFor(() => !!document.querySelector('[data-testid=delete-confirm]'));
  await page.type('[data-testid=delete-confirm]', 'nope');
  assert.equal(await page.eval(() => document.querySelector('[data-testid=delete-account-confirm]').disabled), true);
  await page.type('[data-testid=delete-confirm]', 'delete');
  assert.equal(await page.eval(() => document.querySelector('[data-testid=delete-account-confirm]').disabled), false);
  await page.eval(() => document.querySelector('[data-testid=account-section]').scrollIntoView());
  await shot('account-danger-zone', { fullPage: false });

  await page.eval(() => localStorage.setItem('pgf-e2e-marker', '1'));
  await page.click('[data-testid=delete-account-confirm]');
  // a fresh (local) account: the onboarding again, no data, local storage cleared
  await page.waitFor(() => location.pathname + location.search === '/profile?welcome=1' && !!document.querySelector('[data-testid=profile-form]'), { timeout: 10000 });
  assert.equal(await page.eval(() => document.querySelector('input[name=fullName]').value), '');
  assert.equal(await page.eval(() => localStorage.getItem('pgf-e2e-marker')), null);
  assert.deepEqual(await api('GET', 'passengers'), []);
  assert.deepEqual(await api('GET', 'aircraft'), []);
  assert.deepEqual(page.errors, []);
});
