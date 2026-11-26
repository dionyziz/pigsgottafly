// End-to-end test of "E-mail me" on the navlog export: the page sends the sheets it shows, the server
// prints them from the built PDF page (dist/pdf.html) in headless Chrome (api/_lib/sheetPdf.ts), as in
// production, and mails the PDF to the pilot (mail transport MOCKED). The page then says where and when
// it went. The e-mailed PDF and the browser's print of the same page are kept in tests/e2e/artifacts
// (navlog-mail-sent.pdf, navlog-mail-print.pdf) to be compared.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { setMailTransport } from '../../api/_lib/mail.ts';
import { chromiumNavlogPdf } from '../../api/_lib/sheetPdf.ts';
import { fleetSeed } from '../../tools/build_seed.ts';
import { ARTIFACTS, launch, ROOT, startServer } from './harness.mjs';
import { refJson } from './refInEffect.mjs';

let server, browser, page;
const sent = [];
before(async () => {
  server = await startServer({ navlogPdf: chromiumNavlogPdf({ distDir: path.join(ROOT, 'dist') }) });
  setMailTransport(async (m) => {
    sent.push(m);
    return { id: `m-${sent.length}` };
  });
  browser = await launch();
  page = await browser.newPage();
});
after(async () => {
  setMailTransport(null);
  await page?.close();
  await browser?.close();
  server?.close();
});

const api = async (method, p, body) => {
  const r = await fetch(`${server.url}/api/${p}`, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status === 204 ? null : r.json();
};
const ADS = refJson('aerodromes.json');
const pt = (icao, uid) => {
  const a = (ADS.aerodromes ?? ADS).find((x) => x.icao === icao);
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const DATE = '2026-12-05';

test('E-mail me sends the navlog as shown, printed as the website prints it', { timeout: 180000 }, async () => {
  await api('PUT', 'me', {
    fullName: 'Test Pilot',
    phone: '+30 690 000 0000',
    homeAerodrome: 'LGTT',
    weightKg: 80,
    settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 },
  });
  // the local pilot has no e-mail address: the button says so until it has one
  const ac = await api('POST', 'aircraft', { ...fleetSeed()[0], registration: 'SX-NAV' });
  const f = await api('POST', 'flights', {
    date: DATE,
    aircraftId: ac.id,
    blockOff: '09:00',
    route: [pt('LGTT', 'a'), pt('LGSY', 'b'), pt('LGMG', 'c')],
  });
  await page.intercept('*/api/weather/metar*', () => ({ body: { stations: {}, fetched: Date.now() } }));
  const ready = () =>
    page.waitFor(
      () =>
        document.querySelector('[data-testid=navlog-export]')?.dataset.ready === 'true' &&
        !!document.querySelector('[data-testid=navlog-mail-button]'),
      { timeout: 20000 },
    );

  await page.goto(`${server.url}/flights/${f.id}/export/navlog`);
  await ready();
  await page.waitFor(() => !!document.querySelector('[data-testid=navlog-mail-reason]'));
  assert.match(
    await page.eval(() => document.querySelector('[data-testid=navlog-mail-reason]').textContent),
    /no e-mail/,
  );
  assert.equal(await page.eval(() => document.querySelector('[data-testid=navlog-mail-button]').disabled), true);

  await server.db.query(`UPDATE pilots SET email = 'pilot@example.com' WHERE id = 'local'`);
  await page.goto(`${server.url}/flights/${f.id}/export/navlog`);
  await ready();
  await page.waitFor(() => document.querySelector('[data-testid=navlog-mail-button]')?.disabled === false, {
    timeout: 10000,
  });
  assert.equal(
    await page.eval(() => document.querySelector('[data-testid=navlog-mail-button]').textContent),
    'E-mail me',
  );
  await page.click('[data-testid=navlog-mail-button]');
  await page.waitFor(() => !!document.querySelector('[data-testid=navlog-mail-sent]'), { timeout: 60000 });
  const shown = await page.eval(() => document.querySelector('[data-testid=navlog-mail-sent]').textContent);
  assert.match(shown, /^Sent to pilot@example\.com at .*\d{2}:\d{2}/);
  assert.equal(await page.eval(() => !!document.querySelector('[data-testid=navlog-mail-error]')), false);

  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.deepEqual(m.to, ['pilot@example.com']);
  assert.equal(m.cc, undefined);
  assert.equal(m.subject, `Navlog ${DATE} LGTT–LGMG`);
  assert.equal(m.attachments.length, 1);
  const a = m.attachments[0];
  assert.equal(a.filename, `${DATE}-navlog.pdf`);
  assert.equal(a.contentType, 'application/pdf');
  const raw = a.content.toString('latin1');
  assert.match(raw, /^%PDF-/);
  assert.match(raw, /Skia\/PDF/);
  const box = raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  assert.ok(box && Math.abs(+box[1] - 841.92) < 2 && Math.abs(+box[2] - 595.92) < 2, `A4 landscape: ${box?.[0]}`);
  fs.writeFileSync(path.join(ARTIFACTS, 'navlog-mail-sent.pdf'), a.content);

  // the browser's print of the same page, to compare with the e-mailed one
  await page.media('print');
  const print = await page.pdf('navlog-mail-print');
  await page.media('');
  const sentPages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(sentPages, print.pages, `e-mailed ${sentPages} pages, printed ${print.pages}`);

  // a second send right away: the pause, said plainly
  await page.click('[data-testid=navlog-mail-button]');
  await page.waitFor(() => !!document.querySelector('[data-testid=navlog-mail-error]'), { timeout: 20000 });
  assert.match(
    await page.eval(() => document.querySelector('[data-testid=navlog-mail-error]').textContent),
    /less than a minute ago/,
  );
  assert.equal(sent.length, 1);
  if (process.env.SHOTS) await page.screenshot('navlog-mail');
});
