// End-to-end test of the Form 731 signing page (/sign/:token, no sign-in): the passenger corrects their
// own details, signs, and the page shows the corrected row; the pilot's "signed" e-mail (mail transport
// MOCKED) lists what changed.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { setMailTransport } from '../../api/_lib/mail.ts';
import { launch, startServer } from './harness.mjs';
import { refJson } from './refInEffect.mjs';

let server, browser, page;
const sent = [];
before(async () => {
  server = await startServer();
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
const snap = (fullName, idNumber, phone) => ({
  fullName,
  phone,
  dateOfBirth: null,
  weightKg: 70,
  idNumber,
  idType: 'ID',
  nationality: '',
  relation: '',
});

test(
  'a passenger corrects their details on the signing page and signs; the pilot is told',
  { timeout: 60000 },
  async () => {
    await api('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0000', idNumber: 'AK1', weightKg: 80 });
    await server.db.query(`UPDATE pilots SET email = 'pilot@example.com' WHERE id = 'local'`);
    const maria = await api('POST', 'passengers', {
      fullName: 'Maria Papadopoulou',
      phone: '+30 690 111 2233',
      idNumber: 'AB987654',
      email: 'maria@example.com',
    });
    const f = await api('POST', 'flights', {
      title: 'Milos',
      date: new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10),
      blockOff: '09:00',
      route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      crew: [
        { role: 'PIC', passengerId: null, seat: 'front-left', snapshot: snap('', '', '') },
        {
          role: 'PAX',
          passengerId: maria.id,
          seat: 'front-right',
          snapshot: snap('Maria Papadopoulou', 'AB987654', '+30 690 111 2233'),
        },
      ],
    });
    const token = (await api('POST', `flights/${f.id}/forms/731/links`)).links[maria.id];
    assert.ok(token);

    await page.goto(`${server.url}/sign/${token}`);
    await page.waitFor(() => !!document.querySelector('[data-testid=sign-edit]'), { timeout: 20000 });
    await page.click('[data-testid=sign-edit]');
    await page.waitFor(() => !!document.querySelector('[data-testid=sign-edit-form] input[name=idNumber]'));
    // an empty name is refused as in the passenger form
    await page.type('[data-testid=sign-edit-form] input[name=fullName]', '');
    await page.click('[data-testid=sign-edit-save]');
    await page.waitFor(() =>
      /Enter the full name/.test(document.querySelector('[data-testid=sign-edit-form]').textContent),
    );
    await page.type('[data-testid=sign-edit-form] input[name=fullName]', 'Maria Smith');
    await page.type('[data-testid=sign-edit-form] input[name=idNumber]', 'AB000111');
    await page.click('[data-testid=sign-edit-save]');
    await page.waitFor(() => !document.querySelector('[data-testid=sign-edit-form]'));
    const mine = () => document.querySelector('.sign-people li.me').textContent;
    assert.match(await page.eval(mine), /Maria Smith/);
    assert.match(await page.eval(mine), /AB000111/);
    assert.equal(sent.length, 0);

    await page.click('[data-testid=sign-button]');
    await page.waitFor(() => !!document.querySelector('[data-testid=sign-done]'));
    assert.match(
      await page.eval(() => document.querySelector('[data-testid=sign-done]').textContent),
      /Thank you, Maria/,
    );
    assert.match(await page.eval(mine), /Maria Smith/);
    assert.match(await page.eval(mine), /AB000111/);

    // after a reload too: the form now carries the corrected details
    await page.reload();
    await page.waitFor(() => !!document.querySelector('[data-testid=sign-done]'));
    assert.match(await page.eval(mine), /Maria Smith/);

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['pilot@example.com']);
    assert.equal(sent[0].subject, 'Form 731 signed by Maria Smith (details changed)');
    assert.match(sent[0].text, /Maria Smith changed their details:/);
    assert.match(sent[0].text, /Name: Maria Papadopoulou → Maria Smith/);
    assert.match(sent[0].text, /ID \/ passport number: AB987654 → AB000111/);
    assert.equal((await api('GET', `passengers/${maria.id}`)).fullName, 'Maria Smith');
    assert.deepEqual(page.errors, []);
  },
);
