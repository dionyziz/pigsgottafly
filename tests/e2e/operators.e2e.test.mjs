// End-to-end test of operators: create one on the Operators page (it asks for the W&B and
// performance sheets, to an e-mail address), assign an aircraft to it on the aircraft page, then on
// the flight's W&B and performance export send the sheets to it (mail transport MOCKED: the PDF is
// kept in tests/e2e/artifacts), see "Sent", change the flight and see "Changed since it was sent".
// The PDF is the website's own print of the sheets: the server prints the built PDF page (dist/pdf.html)
// in headless Chrome (api/_lib/sheetPdf.ts), as in production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { setMailTransport } from '../../api/_lib/mail.ts';
import { chromiumSheetPdf } from '../../api/_lib/sheetPdf.ts';
import { fleetSeed } from '../../tools/build_seed.ts';
import { ARTIFACTS, launch, ROOT } from './harness.mjs';
import { refJson } from './refInEffect.mjs';

let server, db, url, browser, page;
const sent = [];
before(async () => {
  const { createServer } = await import('../../server/server.ts');
  server = createServer({ db: 'memory://', sheetPdf: chromiumSheetPdf({ distDir: path.join(ROOT, 'dist') }) });
  ({ db } = await server.ready);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
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
  const r = await fetch(`${url}/api/${p}`, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status === 204 ? null : r.json();
};
const shot = async (name) => {
  if (process.env.SHOTS) await page.screenshot(name);
};
const ADS = refJson('aerodromes.json');
const pt = (icao, uid) => {
  const a = (ADS.aerodromes ?? ADS).find((x) => x.icao === icao);
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};

test(
  'an operator that asks for the W&B and performance sheets gets them from the export',
  { timeout: 120000 },
  async () => {
    await api('PUT', 'me', {
      fullName: 'Test Pilot',
      phone: '+30 690 000 0000',
      homeAerodrome: 'LGTT',
      weightKg: 80,
      settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 },
    });
    // the local pilot has no e-mail; the declarations copy the pilot, so give it one
    await db.query(`UPDATE pilots SET email = 'pilot@example.com' WHERE id = 'local'`);
    const ac = await api('POST', 'aircraft', {
      ...fleetSeed()[0],
      registration: 'SX-OPS',
      operator: '',
      operatorId: null,
    });
    assert.equal(ac.operatorId, null);
    await page.intercept('*/api/weather/metar*', () => ({ body: { stations: {}, fetched: Date.now() } }));

    // ---- create the operator
    await page.goto(`${url}/operators`);
    await page.click('[data-testid=add-operator]');
    await page.waitFor(() => !!document.querySelector('[data-testid=new-operator-dialog] input'));
    await page.type('[data-testid=new-operator-dialog] input', 'Test Aero Club');
    await page.click('[data-testid=new-operator-create]');
    await page.waitFor(
      () =>
        /^\/operators\/op_/.test(location.pathname) &&
        !!document.querySelector('[data-testid=operator-page] input[name=phone]'),
    );
    const opId = await page.eval(() => location.pathname.split('/').pop());
    // Share sits at the right of the title row, a plain button as on the aircraft page
    const share = await page.eval(() => {
      const h = document.querySelector('[data-testid=operator-page] h1').getBoundingClientRect();
      const b = document.querySelector('[data-testid=share-operator]').getBoundingClientRect();
      return {
        hTop: h.top,
        hBottom: h.bottom,
        hRight: h.right,
        top: b.top,
        bottom: b.bottom,
        left: b.left,
        w: b.width,
      };
    });
    assert.ok(share.left > share.hRight, 'Share is right of the title');
    assert.ok(share.top < share.hBottom && share.bottom > share.hTop, 'Share is on the title row');
    assert.ok(share.w < 150, `Share is a button, not a bar (${share.w}px)`);
    // no Save button: edits save on their own
    assert.equal(await page.eval(() => !!document.querySelector('[data-testid=operator-save], .ac-savebar')), false);
    await page.type('input[name=phone]', '+30 210 000 0000');
    await page.waitFor(() => document.querySelector('[data-testid=save-status]')?.textContent === 'Saved', {
      timeout: 10000,
    });
    assert.equal((await api('GET', `operators/${opId}`)).phone, '+30 210 000 0000');
    // asking for the sheets without an address: held back, the field says why
    await page.click('[data-testid=operator-requires]');
    await page.waitFor(() => !!document.querySelector('input[name=declarationsEmail]'));
    await page.waitFor(
      () =>
        document.querySelector('[data-testid=save-status]')?.textContent === 'Not saved' &&
        !!document.querySelector('.field.invalid input[name=declarationsEmail]'),
    );
    await page.idle(1200);
    assert.equal((await api('GET', `operators/${opId}`)).requiresWbPerf, false);
    await page.type('input[name=declarationsEmail]', 'ops@club.example');
    await page.waitFor(() => document.querySelector('[data-testid=save-status]')?.textContent === 'Saved', {
      timeout: 10000,
    });
    // kept across a reload
    await page.reload();
    await page.waitFor(() => document.querySelector('input[name=declarationsEmail]')?.value === 'ops@club.example');
    const op = await api('GET', `operators/${opId}`);
    assert.deepEqual(
      [op.name, op.phone, op.requiresWbPerf, op.declarationsEmail],
      ['Test Aero Club', '+30 210 000 0000', true, 'ops@club.example'],
    );
    // who has access: only us
    await page.waitFor(() => document.querySelectorAll('[data-testid=operator-people] li').length === 1);
    await shot('operator-page');

    // ---- assign the aircraft to it
    await page.goto(`${url}/hangar/${ac.id}`);
    await page.waitFor((id) => !!document.querySelector(`[data-testid=aircraft-operator] option[value="${id}"]`), {
      args: [opId],
    });
    await page.select('[data-testid=aircraft-operator]', opId);
    // the aircraft page saves on its own
    await page.waitFor(() => document.querySelector('[data-testid=save-status]')?.textContent === 'Saved', {
      timeout: 10000,
    });
    const linked = await api('GET', `aircraft/${ac.id}`);
    assert.deepEqual([linked.operatorId, linked.operator], [opId, 'Test Aero Club']);
    // the operator lists it
    await page.goto(`${url}/operators`);
    await page.waitFor((id) => /SX-OPS/.test(document.querySelector(`[data-operator-id="${id}"]`)?.textContent || ''), {
      args: [opId],
    });

    // ---- the flight's W&B and performance export sends the sheets
    const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
    const f = await api('POST', 'flights', {
      aircraftId: ac.id,
      date: tomorrow,
      blockOff: '08:00',
      route: [pt('LGTT', 'a'), pt('LGSY', 'b')],
    });
    await page.goto(`${url}/flights/${f.id}/export/wbperf`);
    await page.waitFor(
      () =>
        document.querySelector('[data-testid=wbperf-export]')?.dataset.ready === 'true' &&
        !!document.querySelector('[data-testid=operator-send-button]'),
      { timeout: 20000 },
    );
    assert.equal(
      await page.eval(() => document.querySelector('[data-testid=wb-operator]')?.textContent),
      'Test Aero Club',
    );
    assert.equal(
      await page.eval(() => document.querySelector('[data-testid=operator-send-status]').textContent),
      'Not sent',
    );
    await shot('operator-send');
    await page.click('[data-testid=operator-send-button]');
    await page.waitFor(() => document.querySelector('[data-testid=operator-send-status]')?.textContent === 'Sent');
    assert.equal(await page.eval(() => document.querySelector('[data-testid=operator-send-button]').disabled), true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['ops@club.example']);
    assert.deepEqual(sent[0].cc, ['pilot@example.com']);
    const pdf = sent[0].attachments[0];
    assert.equal(pdf.content.subarray(0, 5).toString(), '%PDF-');
    fs.writeFileSync(path.join(ARTIFACTS, 'operator-wbperf.pdf'), pdf.content);
    // Chromium's print (Skia), not the server's own writer: the loading sheet and one performance page,
    // with the website's envelope chart and performance cards
    const raw = pdf.content.toString('latin1');
    assert.match(raw, /Skia\/PDF/);
    assert.match(raw, /\/Type\s*\/Pages[\s\S]{0,200}?\/Count 2\b/);
    assert.match(raw, /\/FontName\s*\/[A-Z]{6}\+HomemadeApple/);

    // ---- a change after sending: "Changed since it was sent", then "Re-send"
    const g = await api('GET', `flights/${f.id}`);
    await api('PUT', `flights/${f.id}`, { flight: { fobL: 100 }, version: g.version });
    await page.reload();
    await page.waitFor(
      () =>
        document.querySelector('[data-testid=wbperf-export]')?.dataset.ready === 'true' &&
        document.querySelector('[data-testid=operator-send-status]')?.textContent === 'Changed since it was sent',
      { timeout: 20000 },
    );
    assert.equal(
      await page.eval(() => document.querySelector('[data-testid=operator-send-button]').textContent),
      'Re-send',
    );
    // a flight's form goes out at most once every 10 minutes (api/_lib/sendCaps.ts): that pause, passed
    await db.query('UPDATE mail_log SET at = at - 660000 WHERE flight_id = $1', [f.id]);
    await page.click('[data-testid=operator-send-button]');
    await page.waitFor(() => document.querySelector('[data-testid=operator-send-status]')?.textContent === 'Sent');
    assert.equal(sent.length, 2);
    assert.deepEqual(page.errors, []);
  },
);
