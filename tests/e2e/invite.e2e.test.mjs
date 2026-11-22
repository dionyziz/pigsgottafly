// End-to-end test of inviting a pilot to the app: Alice invites bob@example.com (no account yet) from
// the account menu with two of her aircraft (an e-mail lists them); the aircraft's share dialog shows
// the pending invitation and she cancels it there for one aircraft (the invitation stays, with the
// other); Bob signs in with that address and finds only the other aircraft in his hangar.
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
const invitations = (page) =>
  page.eval(() =>
    [...document.querySelectorAll('[data-testid=invitations] li')].map((li) => [
      li.dataset.email,
      li.querySelector('[data-testid=invitation-aircraft]')?.textContent ?? '',
    ]),
  );
const people = (page) =>
  page.eval(() =>
    [...document.querySelectorAll('[data-testid=share-people] li')].map((li) => [
      li.dataset.pilotId,
      li.dataset.role,
      li.dataset.pending === 'true',
    ]),
  );

test(
  'invite a pilot with two aircraft, cancel one from its share dialog, the pilot signs up',
  { timeout: 180000 },
  async () => {
    const a = await signIn(alice, 'sub-alice', 'alice@example.com', 'Alice Aviatrix');
    const one = (await call(alice, 'POST', 'aircraft', { registration: 'SX-ONE' })).body;
    const two = (await call(alice, 'POST', 'aircraft', { registration: 'SX-TWO' })).body;

    // ---- Alice invites Bob from the account menu, with both aircraft
    await alice.goto(`${url}/hangar`);
    await alice.waitFor(() => document.querySelectorAll('[data-aircraft-id]').length === 2);
    await alice.click('[data-testid=account-button]');
    await alice.waitFor(() => !!document.querySelector('[data-testid=menu-invite-pilots]'));
    await alice.click('[data-testid=menu-invite-pilots]');
    await alice.waitFor(
      () => document.querySelectorAll('[data-testid=invite-aircraft] [data-aircraft-id]').length === 2,
    );
    assert.equal(
      await alice.eval(() => document.querySelectorAll('[data-testid=invite-aircraft] input:checked').length),
      0,
    );
    await alice.type('[data-testid=invite-email]', 'bob@example.com');
    await alice.type('[data-testid=invite-note]', 'Fly with us');
    for (const ac of [one, two]) {
      const box = `[data-testid=invite-aircraft] [data-aircraft-id="${ac.id}"] input[type=checkbox]`;
      // ticking one shows its role menu, which can move the next box between measuring it and the click
      for (let i = 0; i < 5 && !(await alice.eval((s) => document.querySelector(s)?.checked, box)); i++) {
        await alice.click(box);
        await alice.idle(300);
      }
      await alice.waitFor((s) => document.querySelector(s)?.checked, { args: [box] });
    }
    await alice.click('[data-testid=invite-send]');
    await alice.waitFor(() => document.querySelectorAll('[data-testid=invitations] li').length === 1);
    assert.deepEqual(await invitations(alice), [['bob@example.com', 'SX-ONE (Viewer), SX-TWO (Viewer)']]);
    assert.equal(
      await alice.eval(() => document.querySelector('[data-testid=invite-done]')?.textContent),
      'Invited bob@example.com.',
    );
    assert.equal(await alice.eval(() => document.querySelector('[data-testid=invite-email]').value), '');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['bob@example.com']);
    assert.equal(sent[0].subject, "Alice Aviatrix invited you to Pig's Gotta Fly");
    assert.match(sent[0].text, /Fly with us/);
    assert.match(sent[0].text, /- SX-ONE: you can view it\n- SX-TWO: you can view it/);
    assert.match(sent[0].text, /sign in with Google or Apple using this e-mail address \(bob@example\.com\)/);
    await shot(alice, 'invite-dialog');
    await alice.key('Escape');
    await alice.waitFor(() => !document.querySelector('[data-testid=invite-dialog]'));

    // ---- SX-TWO's share dialog shows the invitation; Alice cancels it there for SX-TWO only
    await alice.goto(`${url}/hangar/${two.id}`);
    await alice.waitFor(() => !!document.querySelector('[data-testid=share-aircraft]'));
    await alice.click('[data-testid=share-aircraft]');
    await alice.waitFor(() => document.querySelectorAll('[data-testid=share-people] li').length === 2);
    assert.deepEqual(await people(alice), [
      [a.id, 'owner', false],
      ['bob@example.com', 'view', true],
    ]);
    await shot(alice, 'invite-share-dialog');
    await alice.click('[data-testid=share-people] li[data-pilot-id="bob@example.com"] button');
    await alice.waitFor(() => document.querySelectorAll('[data-testid=share-people] li').length === 1);
    await alice.key('Escape');
    await alice.waitFor(() => !document.querySelector('[data-testid=share-dialog]'));

    // the invitation stays, with SX-ONE (reopened from the hangar's button)
    await alice.goto(`${url}/hangar`);
    await alice.waitFor(() => !!document.querySelector('[data-testid=invite-pilots]'));
    await alice.click('[data-testid=invite-pilots]');
    await alice.waitFor(() => document.querySelectorAll('[data-testid=invitations] li').length === 1);
    assert.deepEqual(await invitations(alice), [['bob@example.com', 'SX-ONE (Viewer)']]);
    await alice.key('Escape');

    // ---- Bob signs in with that address: SX-ONE only, shared by Alice
    await signIn(bob, 'sub-bob', 'Bob@Example.com', 'Bob Builder');
    await bob.goto(`${url}/hangar`);
    await bob.waitFor(() => document.querySelectorAll('[data-aircraft-id]').length === 1);
    assert.equal(await bob.eval(() => document.querySelector('[data-aircraft-id]').dataset.aircraftId), one.id);
    assert.equal(
      await bob.eval(() => document.querySelector('[data-aircraft-id] [data-testid=shared-chip]')?.textContent),
      'Shared by Alice Aviatrix · Viewer',
    );
    await shot(bob, 'invite-accepted-hangar');
    assert.deepEqual((await call(alice, 'GET', 'invitations')).body, []);
  },
);
