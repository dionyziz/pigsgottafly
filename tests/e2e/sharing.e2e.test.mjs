// End-to-end test of aircraft sharing: the share dialog on the aircraft page (unknown e-mail, add an
// editor, reopen, change the role, remove), and an aircraft another pilot shared with us in the
// hangar list ("Shared by" chip), read-only on its page, then removed from our hangar.
// Local mode has one pilot ('local'); the other pilot is written straight into the database.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';

let server, db, url, browser, page;
before(async () => {
  const { createServer } = await import('../../server/server.ts');
  server = createServer({ db: 'memory://' });
  ({ db } = await server.ready);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await launch();
  page = await browser.newPage();
});
after(async () => { await page?.close(); await browser?.close(); server?.close(); });

const api = async (method, path, body) => {
  const r = await fetch(`${url}/api/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return r.status === 204 ? null : r.json();
};
async function clickText(sel, text) {
  await page.waitFor((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.trim() === t), { args: [sel, text] });
  await page.eval((s, t) => { document.querySelectorAll('[data-e2e-target]').forEach((e) => e.removeAttribute('data-e2e-target')); [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t).setAttribute('data-e2e-target', '1'); }, sel, text);
  await page.click('[data-e2e-target]');
}
const people = () => page.eval(() => [...document.querySelectorAll('[data-testid=share-people] li')].map((li) => li.dataset.role));
const shot = async (name) => { if (process.env.SHOTS) await page.screenshot(name); };

test('share an aircraft, and fly one shared with you', { timeout: 120000 }, async () => {
  await api('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0000', homeAerodrome: 'LGTT', settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 } });
  const mine = await api('POST', 'aircraft', { registration: 'SX-OWN' });
  assert.equal(mine.access.role, 'owner');
  await db.query(`INSERT INTO pilots (id, email, name, full_name, created, last_login, seeded_at) VALUES ('friend', 'fran@example.com', 'fran', 'Fran Friend', 1, 1, 1)`);

  // ---- share my aircraft from its page
  await page.goto(`${url}/hangar/${mine.id}`);
  await page.waitFor(() => !!document.querySelector('[data-testid=share-aircraft]'));
  await page.click('[data-testid=share-aircraft]');
  await page.waitFor(() => !!document.querySelector('[data-testid=share-email]'));
  assert.deepEqual(await people(), ['owner']);
  await page.type('[data-testid=share-email]', 'nobody@example.com');
  await page.click('[data-testid=share-add]');
  await page.waitFor(() => /No Pig’s Gotta Fly account uses nobody@example\.com/.test(document.querySelector('[data-testid=share-error]')?.textContent || ''));
  await page.type('[data-testid=share-email]', 'FRAN@example.com');
  await page.select('[data-testid=share-role]', 'edit');
  await page.click('[data-testid=share-add]');
  await page.waitFor(() => document.querySelectorAll('[data-testid=share-people] li').length === 2);
  assert.deepEqual(await people(), ['owner', 'edit']);
  assert.equal(await page.eval(() => document.querySelector('[data-testid=share-email]').value), '');
  await shot('sharing-dialog');
  await clickText('[data-testid=share-dialog] button', 'Done');
  await page.waitFor(() => !document.querySelector('[data-testid=share-dialog]'));

  // reopened, it shows the saved settings; the role changes from the list
  await page.click('[data-testid=share-aircraft]');
  await page.waitFor(() => document.querySelectorAll('[data-testid=share-people] li').length === 2);
  assert.deepEqual(await people(), ['owner', 'edit']);
  await page.select('[data-testid=share-people] li[data-pilot-id=friend] select', 'view');
  await page.waitFor(() => document.querySelector('[data-testid=share-people] li[data-pilot-id=friend]')?.dataset.role === 'view');
  assert.equal((await api('GET', `aircraft/${mine.id}/shares`)).people[1].role, 'view');
  await page.click('[data-testid=share-people] li[data-pilot-id=friend] button');
  await page.waitFor(() => document.querySelectorAll('[data-testid=share-people] li').length === 1);
  assert.equal((await api('GET', `aircraft/${mine.id}/shares`)).people.length, 1);
  await page.key('Escape');

  // ---- Fran shares SX-FRD with us as a viewer
  await db.query(`INSERT INTO aircraft (id, pilot_id, registration, make_model, icao_type, wake, serial, operator, home_base, colours, cruise_tas_kt,
      pattern_tas_kt, climb_tas_kt, fuel, mass_balance, performance, equipment, compass_cards, notes, created, updated)
    SELECT 'ac-fran', 'friend', 'SX-FRD', make_model, icao_type, wake, serial, operator, home_base, colours, 97, pattern_tas_kt, climb_tas_kt,
      fuel, mass_balance, performance, equipment, compass_cards, notes, created, updated FROM aircraft WHERE id = $1`, [mine.id]);
  await db.query(`INSERT INTO aircraft_shares (aircraft_id, pilot_id, role, created, created_by) VALUES ('ac-fran', 'local', 'view', 1, 'friend')`);

  await page.goto(`${url}/hangar`);
  await page.waitFor(() => document.querySelectorAll('[data-aircraft-id]').length === 2);
  assert.equal(await page.eval(() => document.querySelector('[data-aircraft-id=ac-fran] [data-testid=shared-chip]')?.textContent), 'Shared by Fran Friend · Viewer');
  assert.equal(await page.eval((id) => !!document.querySelector(`[data-aircraft-id="${id}"] [data-testid=shared-chip]`), mine.id), false);
  await shot('sharing-hangar');

  // its page is read-only
  await page.goto(`${url}/hangar/ac-fran`);
  await page.waitFor(() => !!document.querySelector('[data-testid=aircraft-viewonly]'));
  assert.equal(await page.eval(() => document.querySelector('.ac-fieldset').disabled), true);
  assert.equal(await page.eval(() => !!document.querySelector('.ac-savebar')), false);
  await shot('sharing-viewonly');

  // a flight can use it
  const f = await api('POST', 'flights', { aircraftId: 'ac-fran' });
  assert.equal(f.aircraftId, 'ac-fran');
  assert.equal(f.summary.aircraft, 'SX-FRD');

  // remove it from our hangar: it leaves the list, the flight shows it as unavailable
  await page.click('[data-testid=aircraft-page] [data-testid=row-menu]');
  await clickText('[data-testid=aircraft-page] .menu button', 'Remove from my hangar');
  await clickText('.dlg button', 'Remove');
  await page.waitFor(() => location.pathname === '/hangar' && document.querySelectorAll('[data-aircraft-id]').length === 1);
  assert.equal((await api('GET', 'aircraft')).length, 1);
  await page.goto(`${url}/flights/${f.id}`);
  await page.waitFor(() => !!document.querySelector('[data-testid=aircraft-unavailable]'), { timeout: 20000 });
  assert.deepEqual(page.errors, []);
});
