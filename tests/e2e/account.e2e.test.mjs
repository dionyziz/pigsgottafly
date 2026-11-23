// End-to-end: the public legal pages (/privacy, /terms: no sign-in), their links on the sign-in
// screen and in the account menu, the profile's licence and medical PDFs (upload, view, replace,
// remove), and its "Your data" / "Delete account" section
// (download, typed confirmation, deletion back to a fresh account). Google's sign-in script is
// stubbed: nothing is fetched from Google.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { launch, startServer } from './harness.mjs';

let local, google, browser, page, tmp;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgf-account-'));
  local = await startServer();
  google = await startServer({
    googleClientId: 'e2e.apps.googleusercontent.com',
    googleKeys: async () => [],
    appleClientId: 'com.example.e2e.web',
    appleKeys: async () => [],
  });
  browser = await launch();
  page = await browser.newPage();
});
after(async () => {
  await page?.close();
  await browser?.close();
  await local?.close();
  await google?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
/** Puts a file on disk into an <input type=file> (CDP) and fires change. */
async function setFile(selector, file) {
  const { root } = await page.send('DOM.getDocument', {});
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await page.send('DOM.setFileInputFiles', { nodeId, files: [file] });
}
/** A valid one-page PDF on disk, padded to about `bytes`. */
function pdfFile(name, bytes) {
  const head =
    '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >> endobj\n';
  const buf = Buffer.concat([
    Buffer.from(head, 'latin1'),
    Buffer.alloc(bytes, 0x25),
    Buffer.from('\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
  const f = path.join(tmp, name);
  fs.writeFileSync(f, buf);
  return { f, buf };
}
const shot = async (name, o) => {
  if (process.env.SHOTS) await page.screenshot(name, o);
};

test('sign-in screen: the consent line and footer link to the terms and privacy policy, readable without signing in', async () => {
  await page.intercept('https://accounts.google.com/gsi/client*', () => ({
    contentType: 'text/javascript',
    body: `window.google = { accounts: { id: { initialize() {}, prompt() {}, disableAutoSelect() {},
      renderButton(el) { el.innerHTML = '<div style="width:260px;height:40px;border:1px solid #dadce0;border-radius:20px;display:flex;align-items:center;justify-content:center;font:14px sans-serif;color:#3c4043">Sign in with Google</div>'; } } } };`,
  }));
  // Sign in with Apple JS (allowed by the CSP the local server sends), set up for a popup
  await page.intercept('https://appleid.cdn-apple.com/appleauth/*', () => ({
    contentType: 'text/javascript',
    body: `window.AppleID = { auth: { init(o) { window.__appleInit = o; }, signIn() { return new Promise(() => {}); } } };`,
  }));
  await page.goto(google.url + '/');
  await page.waitFor(() => !!document.querySelector('[data-testid=signin-consent]'));
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=signin-consent]').textContent.trim()),
    'By signing in you agree to the Terms and Privacy Policy.',
  );
  assert.deepEqual(
    await page.eval(() =>
      [...document.querySelectorAll('[data-testid=signin-footer] a')].map((a) => a.getAttribute('href')),
    ),
    ['/terms', '/privacy'],
  );
  await page.waitFor(() => /Sign in with Google/.test(document.body.textContent));
  // Apple's button under Google's, as wide, once Apple's script is set up
  await page.waitFor(() => document.querySelector('[data-testid=apple-signin]')?.disabled === false);
  assert.deepEqual(
    await page.eval(() => ({
      text: document.querySelector('[data-testid=apple-signin]').textContent,
      width: Math.round(document.querySelector('[data-testid=apple-signin]').getBoundingClientRect().width),
      init: window.__appleInit,
    })),
    {
      text: 'Sign in with Apple',
      width: 260,
      init: { clientId: 'com.example.e2e.web', scope: 'name email', redirectURI: google.url + '/', usePopup: true },
    },
  );
  await shot('account-signin');

  await page.click('[data-testid=signin-footer] a[href="/privacy"]');
  await page.waitFor(
    () => location.pathname === '/privacy' && !!document.querySelector('[data-testid=legal-privacy] h1'),
  );
  await page.goto(google.url + '/terms');
  await page.waitFor(() => !!document.querySelector('[data-testid=legal-terms] h1'));
  assert.equal(await page.eval(() => document.querySelector('h1').textContent), 'Terms of Service');
  assert.deepEqual(page.errors, []);
});

test('the privacy policy and terms render with their sections and date', async () => {
  for (const [path, title, sections] of [
    ['/privacy', 'Privacy Policy', 12],
    ['/terms', 'Terms of Service', 12],
  ]) {
    await page.goto(local.url + path);
    await page.waitFor(() => !!document.querySelector('.legal-doc h1'));
    const doc = await page.eval(() => ({
      h1: document.querySelector('.legal-doc h1').textContent,
      date: document.querySelector('.legal-date').textContent,
      toc: document.querySelectorAll('.legal-toc li').length,
      h2: document.querySelectorAll('.legal-doc h2').length,
      title: document.title,
      contact: !!document.querySelector('a[href="mailto:dionyziz@commonprefix.com"]'),
    }));
    assert.equal(doc.h1, title);
    assert.equal(doc.date, 'Last updated 21 November 2026');
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
  const api = async (method, path, body) =>
    (
      await fetch(`${local.url}/api/${path}`, {
        method,
        headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      })
    ).json();
  await api('PUT', 'me', {
    fullName: 'Test Pilot',
    phone: '+30 690 000 0000',
    homeAerodrome: 'LGTT',
    settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 },
  });
  await api('POST', 'passengers', { fullName: 'Pat Passenger' });
  await api('POST', 'aircraft', { registration: 'SX-BYE' });

  // the account menu links to both documents
  await page.goto(local.url + '/profile');
  await page.waitFor(() => !!document.querySelector('[data-testid=danger-zone]'));
  await page.click('[data-testid=account-button]');
  await page.waitFor(
    () => !!document.querySelector('.menu a[href="/privacy"]') && !!document.querySelector('.menu a[href="/terms"]'),
  );
  await page.click('[data-testid=account-button]');

  // licence and medical: optional PDFs, uploaded, opened in the viewer, replaced and removed
  const me = await api('GET', 'me');
  await page.waitFor(() => !!document.querySelector('[data-testid=licence-pick]'));
  assert.equal(await page.eval(() => document.querySelector('[data-testid=licence-pick]').textContent), 'Add PDF');
  const lic = pdfFile('licence.pdf', 2 * 1024 * 1024 + 500);
  await setFile('[data-testid=licence-file]', lic.f);
  await page.waitFor(
    () => document.querySelector('[data-testid=pilot-doc-licence] [data-testid=pilot-doc-name]')?.textContent,
    { timeout: 20000 },
  );
  assert.match(
    await page.eval(
      () => document.querySelector('[data-testid=pilot-doc-licence] [data-testid=pilot-doc-name]').textContent,
    ),
    /^licence\.pdf · /,
  );
  await setFile('[data-testid=medical-file]', pdfFile('medical.pdf', 1000).f);
  await page.waitFor(() => !!document.querySelector('[data-testid=pilot-doc-medical] [data-testid=pilot-doc-name]'), {
    timeout: 20000,
  });
  await page.eval(() => document.querySelector('[data-testid=pilot-documents]').scrollIntoView({ block: 'center' }));
  await shot('account-licence-medical', { fullPage: false });
  await page.click('[data-testid=pilot-doc-licence] [data-testid=pilot-doc-open]');
  await page.waitFor(() => /^blob:/.test(document.querySelector('[data-testid=pdf-frame]')?.src || ''), {
    timeout: 15000,
  });
  const first = await api('GET', `pilots/${me.id}/files`);
  assert.deepEqual([first.licence.size, first.licence.chunks], [lic.buf.length, 2]);
  await page.key('Escape');
  await page.waitFor(() => !document.querySelector('[data-testid=pdf-viewer]'));
  // replace the licence: the new one is the only one kept
  assert.equal(await page.eval(() => document.querySelector('[data-testid=licence-pick]').textContent), 'Replace');
  await setFile('[data-testid=licence-file]', pdfFile('licence-2027.pdf', 800).f);
  await page.waitFor(
    () =>
      /^licence-2027\.pdf/.test(
        document.querySelector('[data-testid=pilot-doc-licence] [data-testid=pilot-doc-name]')?.textContent || '',
      ),
    { timeout: 20000 },
  );
  await page.click('[data-testid=pilot-doc-medical] button[aria-label="Remove medical certificate"]');
  await page.waitFor(() => !document.querySelector('[data-testid=pilot-doc-medical] [data-testid=pilot-doc-name]'));
  const stored = await api('GET', `pilots/${me.id}/files`);
  assert.equal(stored.licence.name, 'licence-2027.pdf');
  assert.equal(stored.medical, null);

  // the download link serves the JSON export
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=export-data]').getAttribute('href')),
    '/api/me/export',
  );
  const x = await page.eval(async () => {
    const r = await fetch('/api/me/export');
    return { cd: r.headers.get('content-disposition'), body: await r.json() };
  });
  assert.match(x.cd, /^attachment; filename="pigsgottafly-/);
  assert.deepEqual(
    x.body.passengers.map((p) => p.fullName),
    ['Pat Passenger'],
  );
  assert.deepEqual(
    x.body.aircraft.map((a) => a.registration),
    ['SX-BYE'],
  );
  assert.deepEqual(
    x.body.documents.map((f) => [f.kind, f.name]),
    [['licence', 'licence-2027.pdf']],
  );

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
  // a fresh (local) account: straight to the empty lobby, no data, local storage cleared
  await page.waitFor(() => location.pathname === '/' && !!document.querySelector('[data-testid=new-flight]'), {
    timeout: 10000,
  });
  assert.equal((await api('GET', 'me')).fullName, '');
  assert.equal(await page.eval(() => localStorage.getItem('pgf-e2e-marker')), null);
  assert.deepEqual(await api('GET', 'passengers'), []);
  assert.deepEqual(await api('GET', 'aircraft'), []);
  const fresh = await api('GET', 'me');
  assert.deepEqual(await api('GET', `pilots/${fresh.id}/files`), { licence: null, medical: null });
  assert.deepEqual(page.errors, []);
});
