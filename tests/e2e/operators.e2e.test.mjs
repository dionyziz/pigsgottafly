// End-to-end test of operators: create one on the Operators page (it asks for the W&B and
// performance sheets, to an e-mail address), assign an aircraft to it on the aircraft page, then on
// the flight's W&B and performance export send the sheets to it (mail transport MOCKED: the PDF is
// kept in tests/e2e/artifacts), see "Sent", change the flight and see "Changed since it was sent".
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, ARTIFACTS, ROOT } from './harness.mjs';
import { fleetSeed } from '../../tools/build_seed.ts';
import { setMailTransport } from '../../api/_lib/mail.ts';

let server, db, url, browser, page;
const sent = [];
before(async () => {
  const { createServer } = await import('../../server/server.ts');
  server = createServer({ db: 'memory://' });
  ({ db } = await server.ready);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
  setMailTransport(async (m) => { sent.push(m); return { id: `m-${sent.length}` }; });
  browser = await launch();
  page = await browser.newPage();
});
after(async () => { setMailTransport(null); await page?.close(); await browser?.close(); server?.close(); });

const api = async (method, p, body) => {
  const r = await fetch(`${url}/api/${p}`, { method, headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return r.status === 204 ? null : r.json();
};
async function clickText(sel, text) {
  await page.waitFor((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.trim() === t), { args: [sel, text] });
  await page.eval((s, t) => { document.querySelectorAll('[data-e2e-target]').forEach((e) => e.removeAttribute('data-e2e-target')); [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t).setAttribute('data-e2e-target', '1'); }, sel, text);
  await page.click('[data-e2e-target]');
}
const shot = async (name) => { if (process.env.SHOTS) await page.screenshot(name); };
const ADS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ref/aerodromes.json'), 'utf8'));
const pt = (icao, uid) => { const a = (ADS.aerodromes ?? ADS).find((x) => x.icao === icao); return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon }; };

test('an operator that asks for the W&B and performance sheets gets them from the export', { timeout: 120000 }, async () => {
  await api('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0000', homeAerodrome: 'LGTT', weightKg: 80, settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 } });
  // the local pilot has no e-mail; the declarations copy the pilot, so give it one
  await db.query(`UPDATE pilots SET email = 'pilot@example.com' WHERE id = 'local'`);
  const ac = await api('POST', 'aircraft', { ...fleetSeed()[0], registration: 'SX-OPS', operator: '', operatorId: null });
  assert.equal(ac.operatorId, null);
  await page.intercept('*open-meteo.com*', () => ({ status: 503, body: { error: true, reason: 'offline in tests' } }));
  await page.intercept('*/api/weather/metar*', () => ({ body: { stations: {}, fetched: Date.now() } }));

  // ---- create the operator
  await page.goto(`${url}/operators`);
  await page.click('[data-testid=add-operator]');
  await page.waitFor(() => !!document.querySelector('[data-testid=new-operator-dialog] input'));
  await page.type('[data-testid=new-operator-dialog] input', 'Test Aero Club');
  await page.click('[data-testid=new-operator-create]');
  await page.waitFor(() => /^\/operators\/op_/.test(location.pathname) && !!document.querySelector('[data-testid=operator-page] input[name=phone]'));
  const opId = await page.eval(() => location.pathname.split('/').pop());
  await page.type('input[name=phone]', '+30 210 000 0000');
  await page.click('[data-testid=operator-requires]');
  await page.waitFor(() => !!document.querySelector('input[name=declarationsEmail]'));
  await page.type('input[name=declarationsEmail]', 'ops@club.example');
  await page.click('[data-testid=operator-save]');
  await page.waitFor(() => /All changes saved/.test(document.querySelector('.ac-savebar')?.textContent || ''));
  const op = await api('GET', `operators/${opId}`);
  assert.deepEqual([op.name, op.phone, op.requiresWbPerf, op.declarationsEmail], ['Test Aero Club', '+30 210 000 0000', true, 'ops@club.example']);
  // who has access: only us
  await page.waitFor(() => document.querySelectorAll('[data-testid=operator-people] li').length === 1);
  await shot('operator-page');

  // ---- assign the aircraft to it
  await page.goto(`${url}/hangar/${ac.id}`);
  await page.waitFor((id) => !!document.querySelector(`[data-testid=aircraft-operator] option[value="${id}"]`), { args: [opId] });
  await page.select('[data-testid=aircraft-operator]', opId);
  await clickText('.ac-savebar button', 'Save');
  await page.waitFor(() => /All changes saved/.test(document.querySelector('.ac-savebar')?.textContent || ''));
  const linked = await api('GET', `aircraft/${ac.id}`);
  assert.deepEqual([linked.operatorId, linked.operator], [opId, 'Test Aero Club']);
  // the operator lists it
  await page.goto(`${url}/operators`);
  await page.waitFor((id) => /SX-OPS/.test(document.querySelector(`[data-operator-id="${id}"]`)?.textContent || ''), { args: [opId] });

  // ---- the flight's W&B and performance export sends the sheets
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const f = await api('POST', 'flights', { aircraftId: ac.id, date: tomorrow, blockOff: '08:00', route: [pt('LGTT', 'a'), pt('LGSY', 'b')] });
  await page.goto(`${url}/flights/${f.id}/export/wbperf`);
  await page.waitFor(() => document.querySelector('[data-testid=wbperf-export]')?.dataset.ready === 'true' && !!document.querySelector('[data-testid=operator-send-button]'), { timeout: 20000 });
  assert.equal(await page.eval(() => document.querySelector('[data-testid=wb-operator]')?.textContent), 'Test Aero Club');
  assert.equal(await page.eval(() => document.querySelector('[data-testid=operator-send-status]').textContent), 'Not sent');
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

  // ---- a change after sending: "Changed since it was sent", then "Re-send"
  const g = await api('GET', `flights/${f.id}`);
  await api('PUT', `flights/${f.id}`, { flight: { fobL: 100 }, version: g.version });
  await page.reload();
  await page.waitFor(() => document.querySelector('[data-testid=wbperf-export]')?.dataset.ready === 'true'
    && document.querySelector('[data-testid=operator-send-status]')?.textContent === 'Changed since it was sent', { timeout: 20000 });
  assert.equal(await page.eval(() => document.querySelector('[data-testid=operator-send-button]').textContent), 'Re-send');
  // a flight's form goes out at most once every 10 minutes (api/_lib/sendCaps.ts): that pause, passed
  await db.query('UPDATE mail_log SET at = at - 660000 WHERE flight_id = $1', [f.id]);
  await page.click('[data-testid=operator-send-button]');
  await page.waitFor(() => document.querySelector('[data-testid=operator-send-status]')?.textContent === 'Sent');
  assert.equal(sent.length, 2);
  assert.deepEqual(page.errors, []);
});
