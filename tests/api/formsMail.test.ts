// Who may e-mail forms to HCAA through the deployment's account (FORMS_PILOTS, default
// ALLOWED_EMAILS, empty = nobody in Google mode), and the once-per-version rule: a version already
// sent goes out again only with {resend: true}, and concurrent sends of one form send one message.
// The mail transport is MOCKED: nothing is sent for real.
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { createServer } from '../../server/server';
import { configFromEnv } from '../../api/_lib/app';
import { setMailTransport, type Mail } from '../../api/_lib/mail';
import { client, JWK, CID, type Client } from './helpers';
import aerodromes from '../../src/data/ref/aerodromes.json';
import type { RefAerodrome } from '../../src/shared/ref';
import type { FormsState } from '../../src/shared/forms';
import type { RoutePoint } from '../../src/shared/types';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => { const a = ADS.find((x) => x.icao === icao)!; return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon }; };
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);

const sent: (Mail & { from: string })[] = [];
afterEach(() => setMailTransport(null));
const mockMail = (delayMs = 0) => setMailTransport(async (m) => {
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  sent.push(m);
  return { id: `m-${sent.length}` };
});

async function start(opts: { allowedEmails?: string[]; formsPilots?: string[]; google?: boolean }) {
  const s = createServer({
    db: 'memory://', googleClientId: opts.google === false ? '' : CID, googleKeys: async () => [JWK],
    allowedEmails: opts.allowedEmails, formsPilots: opts.formsPilots, client: (_q, r) => { r.writeHead(404); r.end(); },
  });
  await s.ready;
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/`, close: () => new Promise<void>((r) => s.close(() => r())) };
}

async function gendecFlight(c: Client): Promise<string> {
  await c.call('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0009' });
  const f = (await c.call('POST', 'flights', { date: tomorrow, blockOff: '08:00', route: [pt('LGAV', 'a'), pt('LGTT', 'b')] })).body;
  expect(f.id).toBeTruthy();
  return f.id;
}

async function attempt(o: Parameters<typeof start>[0], email: string) {
  const api = await start(o);
  try {
    const c = client(api.base);
    expect((await c.login(`s-${email}`, email)).status).toBe(200);
    const id = await gendecFlight(c);
    const st = (await c.call<FormsState>('GET', `flights/${id}/forms`)).body;
    const n = sent.length;
    const r = await c.call('POST', `flights/${id}/forms/gendec/send`);
    return { st, r, mailed: sent.length - n };
  } finally { await api.close(); }
}

describe('FORMS_PILOTS: who may e-mail forms to HCAA', () => {
  test('no ALLOWED_EMAILS and no FORMS_PILOTS: nobody in Google mode (any Google account can sign in, none can send)', async () => {
    mockMail();
    const { st, r, mailed } = await attempt({}, 'stranger@evil.example');
    expect(st.emailEnabled).toBe(false);
    expect(st.emailReason).toMatch(/not available for this account/);
    expect(r.status).toBe(403);
    expect(mailed).toBe(0);
  });
  test('a pilot allowed to sign in but not on FORMS_PILOTS cannot send', async () => {
    mockMail();
    const { r, mailed } = await attempt({ allowedEmails: ['owner@example.com', 'friend@example.com'], formsPilots: ['owner@example.com'] }, 'friend@example.com');
    expect(r.status).toBe(403);
    expect(mailed).toBe(0);
  });
  test('FORMS_PILOTS defaults to ALLOWED_EMAILS (case-insensitive)', async () => {
    mockMail();
    const { st, r, mailed } = await attempt({ allowedEmails: ['Owner@Example.com'] }, 'owner@example.com');
    expect(st.emailEnabled).toBe(true);
    expect(r.status).toBe(200);
    expect(mailed).toBe(1);
  });
  test('local mode: the local pilot may send', async () => {
    mockMail();
    const api = await start({ google: false });
    try {
      const c = client(api.base);
      const id = await gendecFlight(c);
      const n = sent.length;
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`)).status).toBe(200);
      expect(sent.length - n).toBe(1);
    } finally { await api.close(); }
  });
  test('configFromEnv: FORMS_PILOTS parsed and lower-cased; unset falls back to ALLOWED_EMAILS in createApi', () => {
    expect(configFromEnv({ FORMS_PILOTS: ' Pilot@Example.com , b@y.gr,', ALLOWED_EMAILS: 'x@y.z' }).formsPilots).toEqual(['pilot@example.com', 'b@y.gr']);
    expect(configFromEnv({ FORMS_PILOTS: '' }).formsPilots).toEqual([]);
    expect('formsPilots' in configFromEnv({ ALLOWED_EMAILS: 'x@y.z' })).toBe(false);
  });
});

describe('a form version is sent once', () => {
  test('the same version again: 409 unless {resend: true}; a changed version goes out', async () => {
    mockMail();
    const api = await start({ allowedEmails: ['owner@example.com'] });
    try {
      const c = client(api.base);
      await c.login('s-owner', 'owner@example.com');
      const id = await gendecFlight(c);
      const n = sent.length;
      const first = await c.call<FormsState>('POST', `flights/${id}/forms/gendec/send`);
      expect(first.status).toBe(200);
      expect(first.body.gendec.submission).toMatchObject({ messageId: `m-${sent.length}`, changed: false });
      const again = await c.call('POST', `flights/${id}/forms/gendec/send`);
      expect(again.status).toBe(409);
      expect(again.body.error).toMatch(/already sent/);
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`, { resend: false })).status).toBe(409);
      expect(sent.length - n).toBe(1);

      const re = await c.call<FormsState>('POST', `flights/${id}/forms/gendec/send`, { resend: true });
      expect(re.status).toBe(200);
      expect(sent.length - n).toBe(2);
      expect(re.body.gendec.submission!.messageId).toBe(`m-${sent.length}`);

      // a change makes a new version, which is sent without asking
      const f = (await c.call('GET', `flights/${id}`)).body;
      const { id: _i, version, created, updated, opened, trashed, pilotId, ...doc } = f;
      expect((await c.call('PUT', `flights/${id}`, { flight: { ...doc, date: new Date(Date.now() + 2 * 24 * 3600e3).toISOString().slice(0, 10) }, version })).status).toBe(200);
      expect((await c.call<FormsState>('GET', `flights/${id}/forms`)).body.gendec.submission!.changed).toBe(true);
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`)).status).toBe(200);
      expect(sent.length - n).toBe(3);
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`)).status).toBe(409);
    } finally { await api.close(); }
  });

  test('concurrent sends of one form send one message; a failed send releases the form', async () => {
    const api = await start({ allowedEmails: ['owner@example.com'] });
    try {
      const c = client(api.base);
      await c.login('s-owner', 'owner@example.com');
      const id = await gendecFlight(c);
      // the provider fails: 502, nothing recorded, and the form can be sent again
      setMailTransport(async () => { throw new Error('boom'); });
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`)).status).toBe(502);
      expect((await c.call<FormsState>('GET', `flights/${id}/forms`)).body.gendec.submission).toBeNull();

      mockMail(150);
      const n = sent.length;
      const rs = await Promise.all([1, 2, 3].map(() => c.call('POST', `flights/${id}/forms/gendec/send`, { resend: true })));
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(sent.length - n).toBe(1);
      // once finished, an explicit resend is possible again
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`, { resend: true })).status).toBe(200);
      expect(sent.length - n).toBe(2);
    } finally { await api.close(); }
  });
});
