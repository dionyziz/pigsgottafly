// End-to-end test of the lobby and the account list pages: onboarding, lobby order/search/⋮ menu
// (rename, copy, trash + undo, trash view + restore), passengers, saved waypoints, profile.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServer } from './harness.mjs';

let server, browser, page;
before(async () => {
  server = await startServer();
  browser = await launch();
  page = await browser.newPage();
});
after(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

const api = async (method, path, body) => {
  const r = await fetch(`${server.url}/api/${path}`, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status === 204 ? null : r.json();
};
/** Clicks the first element matching `sel` whose text is `text`. */
async function clickText(sel, text) {
  await page.waitFor((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.trim() === t), {
    args: [sel, text],
  });
  await page.eval(
    (s, t) => {
      document.querySelectorAll('[data-e2e-target]').forEach((e) => e.removeAttribute('data-e2e-target'));
      [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t).setAttribute('data-e2e-target', '1');
    },
    sel,
    text,
  );
  await page.click('[data-e2e-target]');
}
const rowIds = () => page.eval(() => [...document.querySelectorAll('[data-flight-id]')].map((e) => e.dataset.flightId));
const shot = async (name) => {
  if (process.env.SHOTS) await page.screenshot(name);
};
const iso = (d) => d.toISOString().slice(0, 10);

test('onboarding, lobby, passengers, waypoints and profile', async () => {
  // first use: profile in welcome mode; an unknown aerodrome is refused, nothing is prefilled
  await page.goto(server.url + '/');
  await page.waitFor(() => location.pathname === '/profile' && !!document.querySelector('[data-testid=profile-form]'));
  assert.equal(await page.eval(() => document.querySelector('input[name=taxiOutMin]').value), '');
  await page.type('input[name=fullName]', 'Test Pilot');
  await page.type('input[name=phone]', '+30 690 000 0000');
  await page.type('input[name=homeAerodrome]', 'ZZZZ');
  await page.click('[data-testid=profile-form] button[type=submit]');
  // the error is at the field: the aerodrome turns red, says why, and has the focus
  await page.waitFor(
    () =>
      /Not an aerodrome/.test(document.querySelector('[data-testid=aerodrome-status]')?.textContent || '') &&
      document.activeElement?.name === 'homeAerodrome' &&
      document.activeElement.classList.contains('invalid'),
  );
  await page.type('input[name=homeAerodrome]', 'tatoi');
  await page.waitFor(() =>
    [...document.querySelectorAll('.combo-list li')].some((l) => l.textContent.startsWith('LGTT')),
  );
  await clickText('.combo-list li .code', 'LGTT');
  assert.equal(await page.eval(() => document.querySelector('input[name=homeAerodrome]').value), 'LGTT');
  await page.type('input[name=taxiOutMin]', '12');
  await page.click('[data-testid=profile-form] button[type=submit]');
  await page.waitFor(() => location.pathname === '/' && !!document.querySelector('[data-testid=new-flight]'));
  const me = await api('GET', 'me');
  assert.equal(me.homeAerodrome, 'LGTT');
  assert.deepEqual([me.settings.taxiOutMin, me.settings.taxiInMin, me.settings.reserveMin], [12, null, null]);

  // flights: two upcoming (out of creation order), one past
  const day = 86400000;
  const later = await api('POST', 'flights', { date: iso(new Date(Date.now() + 10 * day)), title: 'Later trip' });
  const soon = await api('POST', 'flights', { date: iso(new Date(Date.now() + 2 * day)), title: 'Soon trip' });
  const old = await api('POST', 'flights', { date: iso(new Date(Date.now() - 5 * day)), title: 'Old trip' });
  assert.equal(soon.taxiOutMin, 12);
  await page.goto(server.url + '/');
  await page.waitFor(() => document.querySelectorAll('[data-flight-id]').length === 3);
  assert.deepEqual(await rowIds(), [soon.id, later.id, old.id]);
  assert.deepEqual(
    await page.eval(() => [...document.querySelectorAll('.lobby-section')].map((e) => e.firstChild.textContent)),
    ['Upcoming', 'Past'],
  );

  await shot('lists-lobby');
  // search
  await page.type('[data-testid=flight-search]', 'old');
  await page.waitFor(() => document.querySelectorAll('[data-flight-id]').length === 1);
  await page.type('[data-testid=flight-search]', 'lgtt');
  await page.waitFor(() => document.querySelectorAll('[data-flight-id]').length === 3);
  await page.type('[data-testid=flight-search]', '');
  await page.key('Backspace');

  // rename through the ⋮ menu
  await page.click(`[data-flight-id="${old.id}"] [data-testid=row-menu]`);
  await clickText(`[data-flight-id="${old.id}"] .menu button`, 'Rename');
  await page.waitFor(() => !!document.querySelector('[data-testid=rename-dialog] input'));
  await shot('lists-rename');
  // a typed title stays in the field; the automatic name (from the route) is the placeholder
  assert.deepEqual(
    await page.eval(() => {
      const i = document.querySelector('[data-testid=rename-dialog] input');
      return [i.value, !!i.placeholder];
    }),
    ['Old trip', true],
  );
  await page.type('[data-testid=rename-dialog] input', 'Renamed trip');
  await page.key('Enter');
  await page.waitFor(
    (id) => document.querySelector(`[data-flight-id="${id}"] .title`)?.textContent === 'Renamed trip',
    { args: [old.id] },
  );
  assert.equal((await api('GET', `flights/${old.id}`)).title, 'Renamed trip');

  // make a copy
  await page.click(`[data-flight-id="${soon.id}"] [data-testid=row-menu]`);
  await clickText(`[data-flight-id="${soon.id}"] .menu button`, 'Make a copy');
  await page.waitFor(() => document.querySelectorAll('[data-flight-id]').length === 4);
  assert.ok(
    await page.eval(() =>
      [...document.querySelectorAll('.flight-row .title')].some((e) => e.textContent === 'Copy of Soon trip'),
    ),
  );

  // trash with undo
  await page.click(`[data-flight-id="${later.id}"] [data-testid=row-menu]`);
  await clickText(`[data-flight-id="${later.id}"] .menu button`, 'Move to trash');
  await page.waitFor((id) => !document.querySelector(`[data-flight-id="${id}"]`), { args: [later.id] });
  await clickText('.toast button', 'Undo');
  await page.waitFor((id) => !!document.querySelector(`[data-flight-id="${id}"]`), { args: [later.id] });

  // trash, then restore from the trash view
  await page.click(`[data-flight-id="${later.id}"] [data-testid=row-menu]`);
  await clickText(`[data-flight-id="${later.id}"] .menu button`, 'Move to trash');
  await page.waitFor((id) => !document.querySelector(`[data-flight-id="${id}"]`), { args: [later.id] });
  await page.click('[data-testid=trash-view]');
  await page.waitFor(
    (id) =>
      !!document.querySelector(`[data-flight-id="${id}"]`) &&
      document.querySelectorAll('[data-flight-id]').length === 1,
    { args: [later.id] },
  );
  // the header keeps its place: same h1, New flight kept but hidden
  assert.equal(await page.eval(() => document.querySelector('.page-head h1').textContent), 'Flights');
  assert.equal(
    await page.eval(() => getComputedStyle(document.querySelector('[data-testid=new-flight]')).visibility),
    'hidden',
  );
  await page.click(`[data-flight-id="${later.id}"] [data-testid=row-menu]`);
  await clickText(`[data-flight-id="${later.id}"] .menu button`, 'Restore');
  await page.waitFor(() => document.querySelectorAll('[data-flight-id]').length === 0);
  assert.equal((await api('GET', `flights/${later.id}`)).deleted, false);

  // passengers: add, edit, delete
  await page.goto(server.url + '/passengers');
  await page.click('[data-testid=add-passenger]');
  await page.waitFor(() => !!document.querySelector('[data-testid=passenger-dialog]'));
  // saving without a name: the message is under the name, which gets the focus
  await clickText('[data-testid=passenger-dialog] button', 'Add passenger');
  await page.waitFor(
    () =>
      document
        .querySelector('[data-testid=passenger-dialog] input[name=fullName]')
        ?.closest('.field.invalid')
        ?.textContent.includes('Enter the full name') && document.activeElement?.name === 'fullName',
  );
  await page.type('[data-testid=passenger-dialog] input[name=fullName]', 'Jane Doe');
  assert.equal(
    await page.eval(() => document.querySelectorAll('[data-testid=passenger-dialog] .field.invalid').length),
    0,
  );
  await page.type('[data-testid=passenger-dialog] input[name=weightKg]', '62.5');
  await page.type('[data-testid=passenger-dialog] input[name=idNumber]', 'AB123456');
  await clickText('[data-testid=passenger-dialog] button', 'Add passenger');
  await page.waitFor(() => document.querySelectorAll('[data-passenger-id]').length === 1);
  await shot('lists-passengers');
  const [pax] = await api('GET', 'passengers');
  assert.deepEqual([pax.fullName, pax.weightKg, pax.idNumber], ['Jane Doe', 62.5, 'AB123456']);
  // "Missing … date of birth" opens the dialog at that field
  await clickText(`[data-passenger-id="${pax.id}"] .hint button`, 'date of birth');
  await page.waitFor(
    () => !!document.querySelector('[data-testid=passenger-dialog]') && document.activeElement?.name === 'dateOfBirth',
  );
  await page.key('Escape');
  await page.waitFor(() => !document.querySelector('[data-testid=passenger-dialog]'));
  // a link from the forms ("Add your ID") opens the pilot's details at the ID field
  await page.goto(server.url + '/passengers?edit=me&fields=idNumber');
  await page.waitFor(
    () => !!document.querySelector('[data-testid=pilot-dialog]') && document.activeElement?.name === 'idNumber',
  );
  await page.key('Escape');
  await page.waitFor(() => !document.querySelector('[data-testid=pilot-dialog]'));
  await page.click(`[data-passenger-id="${pax.id}"] .nm`);
  await page.waitFor(() => !!document.querySelector('[data-testid=passenger-dialog]'));
  await shot('lists-passenger-dialog');
  await page.type('[data-testid=passenger-dialog] input[name=phone]', '+30 210 000');
  await clickText('[data-testid=passenger-dialog] button', 'Save');
  await page.waitFor(() => !document.querySelector('[data-testid=passenger-dialog]'));
  assert.equal((await api('GET', `passengers/${pax.id}`)).phone, '+30 210 000');
  // delete from the dialog (confirmed), then Undo brings the details back as a new record
  await page.click(`[data-passenger-id="${pax.id}"] .nm`);
  await page.waitFor(() => !!document.querySelector('[data-testid=passenger-delete]'));
  await page.click('[data-testid=passenger-delete]');
  await clickText('.dlg button', 'Delete');
  await page.waitFor(() => document.querySelectorAll('[data-passenger-id]').length === 0);
  assert.deepEqual(await api('GET', 'passengers'), []);
  await clickText('.toast button', 'Undo');
  await page.waitFor(() => document.querySelectorAll('[data-passenger-id]').length === 1);
  const [back] = await api('GET', 'passengers');
  assert.deepEqual([back.fullName, back.phone, back.weightKg], ['Jane Doe', '+30 210 000', 62.5]);
  // and with the row's bin; a link to the deleted passenger says so
  await page.click(`[data-passenger-id="${back.id}"] [data-testid=passenger-row-delete]`);
  await clickText('.dlg button', 'Delete');
  await page.waitFor(() => document.querySelectorAll('[data-passenger-id]').length === 0);
  await page.goto(`${server.url}/passengers?edit=${back.id}`);
  await page.waitFor(() => /deleted/.test(document.querySelector('.toast')?.textContent || '') && !location.search);

  // waypoints: add by ICAO coordinates, rename in place
  await page.goto(server.url + '/waypoints');
  await page.click('[data-testid=add-waypoint]');
  await page.waitFor(() => !!document.querySelector('[data-testid=waypoint-dialog]'));
  await page.type('[data-testid=waypoint-dialog] input[name=name]', 'zofri');
  await page.type('[data-testid=waypoint-dialog] input[name=position]', '375430N 0234334E');
  await clickText('[data-testid=waypoint-dialog] button', 'Save');
  await page.waitFor(() => document.querySelectorAll('[data-waypoint-id]').length === 1);
  await page.idle(1500);
  await shot('lists-waypoints');
  const [wp] = await api('GET', 'waypoints');
  assert.equal(wp.name, 'ZOFRI');
  assert.ok(Math.abs(wp.lat - (37 + 54 / 60 + 30 / 3600)) < 1e-5);
  await page.click(`[data-waypoint-id="${wp.id}"] [data-testid=row-menu]`);
  await clickText(`[data-waypoint-id="${wp.id}"] .menu button`, 'Rename');
  await page.waitFor(() => !!document.querySelector('.inline-edit input'));
  await page.type('.inline-edit input', 'zofri2');
  await page.key('Enter');
  await page.waitFor(async (id) => (await (await fetch(`/api/waypoints/${id}`)).json()).name === 'ZOFRI2', {
    args: [wp.id],
  });

  // profile: full page, change reserve
  await page.goto(server.url + '/profile');
  await page.waitFor(() => !!document.querySelector('input[name=licenceNo]'));
  await shot('lists-profile');
  await page.type('input[name=reserveMin]', '60');
  await page.click('[data-testid=profile-form] button[type=submit]');
  await page.waitFor(async () => (await (await fetch('/api/me')).json()).settings.reserveMin === 60);
  assert.deepEqual(page.errors, []);
});

test('details saved in one tab show at once in the others (one pilot for the whole app)', async () => {
  // e.g. an export opened in a new tab links to "Add your ID number"; the editor's tab must not keep the old details
  await page.goto(server.url + '/passengers');
  await page.waitFor(() =>
    /licence number/.test(document.querySelector('[data-testid=pilot-row] .hint')?.textContent || ''),
  );
  const other = await browser.newPage();
  try {
    await other.goto(server.url + '/passengers?edit=me&fields=licenceNo');
    await other.waitFor(() => !!document.querySelector('[data-testid=pilot-dialog] input[name=licenceNo]'));
    await other.idle(200);
    await other.type('[data-testid=pilot-dialog] input[name=licenceNo]', 'GR.FCL.PPL.42');
    await other.eval(() =>
      [...document.querySelectorAll('[data-testid=pilot-dialog] button')].find((b) => b.textContent === 'Save').click(),
    );
    await other.waitFor(() => !document.querySelector('[data-testid=pilot-dialog]'));
    // the first tab, neither reloaded nor focused, has the new details
    await page.waitFor(
      () => !/licence number/.test(document.querySelector('[data-testid=pilot-row] .hint')?.textContent || ''),
    );
    assert.deepEqual(other.errors, []);
  } finally {
    await other.close();
  }
  assert.deepEqual(page.errors, []);
});
