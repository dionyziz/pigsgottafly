// End-to-end test of sharing a flight by e-mail: Alice shares her flight from the editor's Share
// dialog with an address no account uses yet (a pending invite, e-mailed with how to sign in); Bob
// signs in with that address, finds it under "Shared with me" in the lobby and opens it view-only
// (nothing can be changed: no title editing, disabled panel controls, no route tools, nothing
// saved); Alice makes him an editor; Bob renames it and Alice sees the new title.
// The server runs in Google mode with a local test key (each browser signs in by POST /api/login with
// a token signed here); the mail transport is MOCKED. Two browsers: one per pilot.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { setMailTransport } from '../../api/_lib/mail.ts';
import { CID, googleClaims, JWK, signToken } from '../api/helpers.ts';
import { launch, startServer } from './harness.mjs';

let server, url, browserA, browserB, alice, bob;
const sent = [];
before(async () => {
  server = await startServer({ googleClientId: CID, googleKeys: async () => [JWK] });
  ({ url } = server);
  setMailTransport(async (m) => {
    sent.push(m);
    return { id: `m-${sent.length}` };
  });
  browserA = await launch();
  browserB = await launch();
  alice = await browserA.newPage();
  bob = await browserB.newPage();
});
after(async () => {
  setMailTransport(null);
  await alice?.close();
  await bob?.close();
  await browserA?.close();
  await browserB?.close();
  server?.close();
});

/** fetch /api/… inside the page, with its session cookie. */
const call = (page, method, path, body) =>
  page.eval(
    async (m, p, b) => {
      const r = await fetch('/api/' + p, {
        method: m,
        headers: m !== 'GET' ? { 'Content-Type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    },
    method,
    path,
    body ?? null,
  );
/**
 * Signs the browser in (Google, faked with the test key) on a public page, fills the pilot's profile,
 * then opens the lobby.
 */
async function signIn(page, sub, email, fullName) {
  await page.goto(`${url}/privacy`);
  const r = await call(page, 'POST', 'login', { credential: signToken(googleClaims(sub, email)) });
  assert.equal(r.status, 200);
  const me = await call(page, 'PUT', 'me', {
    fullName,
    phone: '+30 690 000 0000',
    homeAerodrome: 'LGTT',
    settings: { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 },
  });
  assert.equal(me.status, 200);
  await page.goto(`${url}/`);
  await page.waitFor(() => !!document.querySelector('[data-testid=new-flight]'));
  return r.body.pilot;
}
const shot = async (page, name) => {
  if (process.env.SHOTS) await page.screenshot(name);
};
const people = (page) =>
  page.eval(() =>
    [...document.querySelectorAll('[data-testid=share-people] li')].map((li) => [
      li.dataset.role,
      li.dataset.pending === 'true',
    ]),
  );

test(
  'share a flight by e-mail before the other pilot has an account; view only, then edit',
  { timeout: 180000 },
  async () => {
    await signIn(alice, 'sub-alice', 'alice@example.com', 'Alice Aviatrix');
    const f = (await call(alice, 'POST', 'flights', { title: 'Weekend trip' })).body;

    // ---- Alice shares it from the editor with bob@example.com (no account yet): a pending invite
    await alice.goto(`${url}/flights/${f.id}`);
    await alice.waitFor(() => !!document.querySelector('[data-testid=share-flight]'));
    await alice.click('[data-testid=share-flight]');
    await alice.waitFor(() => !!document.querySelector('[data-testid=share-email]'));
    assert.deepEqual(await people(alice), [['owner', false]]);
    await alice.type('[data-testid=share-email]', 'bob@example.com');
    await alice.select('[data-testid=share-role]', 'view');
    await alice.click('[data-testid=share-add]');
    await alice.waitFor(() => document.querySelectorAll('[data-testid=share-people] li').length === 2);
    assert.deepEqual(await people(alice), [
      ['owner', false],
      ['view', true],
    ]);
    assert.match(
      await alice.eval(() => document.querySelector('[data-testid=share-pending]').textContent),
      /once they sign in/,
    );
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['bob@example.com']);
    assert.equal(sent[0].subject, 'Alice Aviatrix shared the flight Weekend trip with you');
    assert.match(sent[0].text, /sign in with Google or Apple using this e-mail address \(bob@example\.com\)/);
    assert.ok(sent[0].text.includes(`${url}/flights/${f.id}`));
    await shot(alice, 'share-flight-dialog');
    await alice.key('Escape');
    await alice.waitFor(() => !document.querySelector('[data-testid=share-dialog]'));

    // ---- Bob signs in with that address: the flight is under "Shared with me"
    const b = await signIn(bob, 'sub-bob', 'Bob@Example.com', 'Bob Builder');
    await bob.waitFor((id) => !!document.querySelector(`[data-flight-id="${id}"]`), { args: [f.id] });
    assert.ok(
      await bob.eval(() =>
        [...document.querySelectorAll('.lobby-section')].some((s) => s.textContent.startsWith('Shared with me')),
      ),
    );
    assert.equal(
      await bob.eval(
        (id) => document.querySelector(`[data-flight-id="${id}"] [data-testid=flight-shared-by]`)?.textContent,
        f.id,
      ),
      'View only · Alice Aviatrix',
    );
    await shot(bob, 'share-flight-lobby');

    // opened from the lobby: view only, nothing can change
    await bob.click(`[data-flight-id="${f.id}"] a.title`);
    await bob.waitFor(() => !!document.querySelector('[data-testid=view-only-chip]'));
    assert.equal(
      await bob.eval(() => document.querySelector('[data-testid=view-only-chip]').textContent),
      'View only · shared by Alice Aviatrix',
    );
    const ro = await bob.eval(() => ({
      titleTag: document.querySelector('[data-testid=flight-title]').tagName,
      undo: !!document.querySelector('[data-testid=undo]'),
      draw: !!document.querySelector('[data-testid=map-draw]'),
      fieldsets: [...document.querySelectorAll('[data-testid=editor-panel] fieldset.ep-readonly')].map(
        (x) => x.disabled,
      ),
      enabledInputs: [
        ...document.querySelectorAll('[data-testid=stage-body-plan] input, [data-testid=stage-body-plan] select'),
      ].filter((e) => !e.matches(':disabled')).length,
    }));
    assert.equal(ro.titleTag, 'SPAN');
    assert.equal(ro.undo, false);
    assert.equal(ro.draw, false);
    assert.ok(ro.fieldsets.length > 0 && ro.fieldsets.every(Boolean));
    assert.equal(ro.enabledInputs, 0);
    // the server agrees: a viewer's save is refused, and nothing was saved meanwhile
    const saved = (await call(alice, 'GET', `flights/${f.id}`)).body;
    const { version } = saved;
    const doc = { ...saved };
    for (const k of ['id', 'version', 'created', 'updated', 'opened', 'deleted']) delete doc[k];
    assert.equal(
      (await call(bob, 'PUT', `flights/${f.id}`, { flight: { ...doc, title: 'Hacked' }, version })).status,
      403,
    );
    await bob.idle(800);
    assert.equal((await call(alice, 'GET', `flights/${f.id}`)).body.version, version);
    await shot(bob, 'share-flight-viewonly');

    // ---- Alice makes Bob an editor (the invite is his share now)
    await alice.click('[data-testid=share-flight]');
    await alice.waitFor((id) => !!document.querySelector(`[data-testid=share-people] li[data-pilot-id="${id}"]`), {
      args: [b.id],
    });
    assert.deepEqual(await people(alice), [
      ['owner', false],
      ['view', false],
    ]);
    await alice.select(`[data-testid=share-people] li[data-pilot-id="${b.id}"] select`, 'edit');
    await alice.waitFor(
      (id) => document.querySelector(`[data-testid=share-people] li[data-pilot-id="${id}"]`)?.dataset.role === 'edit',
      { args: [b.id] },
    );
    await alice.key('Escape');

    // ---- Bob (reloaded) edits: the title
    await bob.reload();
    await bob.waitFor(
      () => document.querySelector('[data-testid=view-only-chip]')?.textContent === 'Shared by Alice Aviatrix',
    );
    await bob.click('[data-testid=flight-title]');
    await bob.waitFor(() => !!document.querySelector('[data-testid=flight-title-input]'));
    await bob.type('[data-testid=flight-title-input]', 'Weekend trip with Bob');
    await bob.blur();
    await bob.waitFor(() => document.querySelector('[data-testid=save-state]')?.textContent === 'Saved', {
      timeout: 15000,
    });
    await alice.waitFor(
      async (id) => (await (await fetch(`/api/flights/${id}`)).json()).title === 'Weekend trip with Bob',
      { args: [f.id], timeout: 15000 },
    );
    // Alice sees it in her editor
    await alice.reload();
    await alice.waitFor(
      () => document.querySelector('[data-testid=flight-title]')?.textContent === 'Weekend trip with Bob',
    );
    assert.deepEqual(alice.errors, []);
    assert.deepEqual(bob.errors, []);
  },
);

// Passengers and sharing: the share dialog offers the manifest's passengers that have an e-mail as
// viewers; removing a passenger the flight is shared with asks whether to stop sharing it with them.
test('share a flight with its passengers; removing one asks to stop sharing', { timeout: 120000 }, async () => {
  await signIn(alice, 'sub-alice', 'alice@example.com', 'Alice Aviatrix');
  const person = (fullName, email) => ({
    fullName,
    phone: '',
    dateOfBirth: null,
    weightKg: 70,
    idNumber: '',
    idType: '',
    nationality: '',
    relation: '',
    email,
  });
  const carol = (await call(alice, 'POST', 'passengers', person('Carol Cabin', 'Carol@Example.com'))).body;
  const dan = (await call(alice, 'POST', 'passengers', person('Dan Deck', 'dan@example.com'))).body;
  const eve = (await call(alice, 'POST', 'passengers', person('Eve Noemail', ''))).body;
  const seat = (p, s) => ({ role: 'PAX', passengerId: p.id, seat: s, snapshot: { ...person(p.fullName) } });
  const f = (
    await call(alice, 'POST', 'flights', {
      title: 'Island hop',
      crew: [
        { role: 'PIC', passengerId: null, seat: 'front-left', snapshot: person('Alice Aviatrix') },
        seat(carol, 'front-right'),
        seat(dan, 'rear-left'),
        seat(eve, 'rear-right'),
      ],
    })
  ).body;
  assert.equal(f.crew.length, 4);
  const accessOf = async () =>
    (await call(alice, 'GET', `flights/${f.id}/shares`)).body.people.map((p) => [p.email, p.role]);
  const suggested = () =>
    alice.eval(() =>
      [...document.querySelectorAll('[data-testid=share-suggestions] li')].map((li) => li.dataset.email),
    );

  // ---- the dialog offers Carol and Dan (Eve has no e-mail); Share (view) adds Carol as a viewer
  await alice.goto(`${url}/flights/${f.id}`);
  await alice.waitFor(() => !!document.querySelector('[data-testid=share-flight]'));
  await alice.click('[data-testid=share-flight]');
  await alice.waitFor(() => !!document.querySelector('[data-testid=share-suggestions]'));
  assert.deepEqual(await suggested(), ['Carol@Example.com', 'dan@example.com']);
  await shot(alice, 'share-flight-suggestions');
  await alice.click('[data-testid=share-suggestions] li[data-email="Carol@Example.com"] button');
  await alice.waitFor(() => document.querySelectorAll('[data-testid=share-people] li').length === 2);
  assert.deepEqual(await people(alice), [
    ['owner', false],
    ['view', true],
  ]);
  assert.deepEqual(await suggested(), ['dan@example.com']);
  await alice.click('[data-testid=share-suggestions] li[data-email="dan@example.com"] button');
  await alice.waitFor(() => document.querySelectorAll('[data-testid=share-people] li').length === 3);
  assert.equal(await alice.eval(() => !!document.querySelector('[data-testid=share-suggestions]')), false);
  assert.deepEqual(await accessOf(), [
    ['alice@example.com', 'owner'],
    ['carol@example.com', 'view'],
    ['dan@example.com', 'view'],
  ]);
  await shot(alice, 'share-flight-passengers');
  await alice.key('Escape');
  await alice.waitFor(() => !document.querySelector('[data-testid=share-dialog]'));

  // ---- removing Carol from the manifest asks; "Stop sharing" removes her invite
  await alice.click('[data-testid=stage-plan]');
  await alice.waitFor(() => document.querySelector('[data-testid=stage-body-plan]')?.hidden === false);
  const names = () =>
    alice.eval(() =>
      [...document.querySelectorAll('[data-testid=crew-pax] .ep-crew-fullname')].map((x) => x.textContent),
    );
  await alice.click('button[aria-label="Remove Carol Cabin"]');
  await alice.waitFor(() => !!document.querySelector('[data-testid=unshare-confirm]'));
  assert.deepEqual(await names(), ['Dan Deck', 'Eve Noemail']);
  assert.equal(
    await alice.eval(() => document.querySelector('[data-testid=unshare-confirm] h2').textContent),
    'Also stop sharing the flight with Carol Cabin?',
  );
  await alice.click('[data-testid=unshare-confirm] .dlg-foot button.primary');
  await alice.waitFor(() => !document.querySelector('[data-testid=unshare-confirm]'));
  assert.deepEqual(await accessOf(), [
    ['alice@example.com', 'owner'],
    ['dan@example.com', 'view'],
  ]);

  // ---- removing Dan asks too; "Keep sharing" keeps his access
  await alice.click('button[aria-label="Remove Dan Deck"]');
  await alice.waitFor(() => !!document.querySelector('[data-testid=unshare-confirm]'));
  assert.equal(
    await alice.eval(() => document.querySelector('[data-testid=unshare-confirm] .dlg-foot button.ghost').textContent),
    'Keep sharing',
  );
  await alice.click('[data-testid=unshare-confirm] .dlg-foot button.ghost');
  await alice.waitFor(() => !document.querySelector('[data-testid=unshare-confirm]'));
  assert.deepEqual(await names(), ['Eve Noemail']);
  assert.deepEqual(await accessOf(), [
    ['alice@example.com', 'owner'],
    ['dan@example.com', 'view'],
  ]);

  // ---- Eve has no e-mail: removed without a question
  await alice.click('button[aria-label="Remove Eve Noemail"]');
  await alice.waitFor(() => !document.querySelector('[data-testid=crew-pax]'));
  await alice.idle(500);
  assert.equal(await alice.eval(() => !!document.querySelector('[data-testid=unshare-confirm]')), false);
  await alice.waitFor(() => document.querySelector('[data-testid=save-state]')?.textContent === 'Saved', {
    timeout: 15000,
  });
  await alice.waitFor(async (id) => (await (await fetch(`/api/flights/${id}`)).json()).crew.length === 1, {
    args: [f.id],
    timeout: 15000,
  });
  assert.deepEqual(alice.errors, []);
});

test(
  'a passenger signs up with nothing but the e-mail and sees the flight shared with them, asked for nothing',
  { timeout: 120000 },
  async () => {
    const f = (await call(alice, 'POST', 'flights', { title: 'Passenger ride' })).body;
    const r = await call(alice, 'POST', `flights/${f.id}/shares`, { email: 'rider@example.com', role: 'view' });
    assert.equal(r.status, 201);

    const browserC = await launch();
    try {
      const rider = await browserC.newPage();
      await rider.goto(`${url}/privacy`);
      const login = await call(rider, 'POST', 'login', {
        credential: signToken(googleClaims('sub-rider', 'rider@example.com')),
      });
      assert.equal(login.status, 200);
      // the lobby at once, with the shared flight; no profile asked for
      await rider.goto(`${url}/`);
      await rider.waitFor((id) => !!document.querySelector(`[data-flight-id="${id}"]`), { args: [f.id] });
      assert.equal(await rider.eval(() => location.pathname), '/');
      const me = (await call(rider, 'GET', 'me')).body;
      assert.deepEqual([me.fullName, me.phone, me.homeAerodrome], ['', '', null]);

      // the flight, view only: nothing asks for pilot details
      await rider.goto(`${url}/flights/${f.id}`);
      await rider.waitFor(() => !!document.querySelector('[data-testid=view-only-chip]'));
      await rider.waitFor(() => document.querySelectorAll('[data-testid=ready-item]').length > 0);
      assert.equal(
        await rider.eval(() => !!document.querySelector('[data-testid=ready-item][data-id=profile]')),
        false,
      );
      assert.equal(await rider.eval(() => location.pathname), `/flights/${f.id}`);
      assert.equal(
        await rider.eval(() => !!document.querySelector('[data-testid=profile-form], [data-testid=pilot-dialog]')),
        false,
      );
      assert.deepEqual(rider.errors, []);
    } finally {
      await browserC.close();
    }
  },
);
