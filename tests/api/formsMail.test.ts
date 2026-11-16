// Who may e-mail forms to HCAA (any signed-in pilot, always cc'd), and the once-per-version rule: a version already
// sent goes out again only with {resend: true}, and concurrent sends of one form send one message.
// The mail transport is MOCKED: nothing is sent for real.
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { createServer } from '../../server/server';
import { setMailTransport, type SentMail } from '../../api/_lib/mail';
import { client, JWK, CID, type Client } from './helpers';
import aerodromes from '../../src/data/ref/aerodromes.json';
import type { RefAerodrome } from '../../src/shared/ref';
import type { FormsState } from '../../src/shared/forms';
import type { RoutePoint } from '../../src/shared/types';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);

const sent: SentMail[] = [];
afterEach(() => setMailTransport(null));
const mockMail = (delayMs = 0) =>
  setMailTransport(async (m) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    sent.push(m);
    return { id: `m-${sent.length}` };
  });

async function start(opts: { allowedEmails?: string[]; google?: boolean }) {
  const s = createServer({
    db: 'memory://',
    googleClientId: opts.google === false ? '' : CID,
    googleKeys: async () => [JWK],
    allowedEmails: opts.allowedEmails,
    client: (_q, r) => {
      r.writeHead(404);
      r.end();
    },
  });
  await s.ready;
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/`,
    close: () => new Promise<void>((r) => s.close(() => r())),
    /** The 10-minute pause between two sends of a flight's form (sendCaps.ts), passed. */
    later: async () => {
      await (await s.ready).db.query('UPDATE mail_log SET at = at - 660000');
    },
  };
}

async function gendecFlight(c: Client): Promise<string> {
  await c.call('PUT', 'me', { fullName: 'Test Pilot', phone: '+30 690 000 0009' });
  const f = (
    await c.call('POST', 'flights', { date: tomorrow, blockOff: '08:00', route: [pt('LGAV', 'a'), pt('LGTT', 'b')] })
  ).body;
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
  } finally {
    await api.close();
  }
}

describe('who may e-mail forms to HCAA, and the cc', () => {
  test('any signed-in pilot may send, from noreply@, cc and reply-to the pilot', async () => {
    mockMail();
    const n0 = sent.length;
    const { st, r, mailed } = await attempt(
      { allowedEmails: ['owner@example.com', 'friend@example.com'] },
      'friend@example.com',
    );
    expect(st.emailEnabled).toBe(true);
    expect(r.status).toBe(200);
    expect(mailed).toBe(1);
    const m = sent[n0];
    expect(m.from).toMatch(/<noreply@pigsgottafly\.com>$/);
    expect(m.to).toEqual(['gendec@hcaa.gov.gr']);
    expect(m.cc).toEqual(['friend@example.com']);
    expect(m.replyTo).toBe('friend@example.com');
  });
  test('without ALLOWED_EMAILS any Google pilot may send', async () => {
    mockMail();
    const { r, mailed } = await attempt({}, 'someone@example.org');
    expect(r.status).toBe(200);
    expect(mailed).toBe(1);
  });
  test('local mode: the local pilot has no e-mail to cc, so nothing is sent', async () => {
    mockMail();
    const api = await start({ google: false });
    try {
      const c = client(api.base);
      const id = await gendecFlight(c);
      const n = sent.length;
      const st = (await c.call<FormsState>('GET', `flights/${id}/forms`)).body;
      expect(st.emailEnabled).toBe(false);
      expect(st.emailReason).toMatch(/no e-mail address/);
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`)).status).toBe(403);
      expect(sent.length - n).toBe(0);
    } finally {
      await api.close();
    }
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

      // a re-send waits 10 minutes after the last send
      const soon = await c.call('POST', `flights/${id}/forms/gendec/send`, { resend: true });
      expect(soon.status).toBe(429);
      expect(soon.body.error).toMatch(/less than 10 minutes ago/);
      await api.later();
      const re = await c.call<FormsState>('POST', `flights/${id}/forms/gendec/send`, { resend: true });
      expect(re.status).toBe(200);
      expect(sent.length - n).toBe(2);
      expect(re.body.gendec.submission!.messageId).toBe(`m-${sent.length}`);

      // a change makes a new version, which is sent without asking
      const f = (await c.call('GET', `flights/${id}`)).body;
      const { id: _i, version, created, updated, opened, trashed, pilotId, ...doc } = f;
      expect(
        (
          await c.call('PUT', `flights/${id}`, {
            flight: { ...doc, date: new Date(Date.now() + 2 * 24 * 3600e3).toISOString().slice(0, 10) },
            version,
          })
        ).status,
      ).toBe(200);
      expect((await c.call<FormsState>('GET', `flights/${id}/forms`)).body.gendec.submission!.changed).toBe(true);
      await api.later();
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`)).status).toBe(200);
      expect(sent.length - n).toBe(3);
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`)).status).toBe(409);
    } finally {
      await api.close();
    }
  });

  test('concurrent sends of one form send one message; a failed send releases the form', async () => {
    const api = await start({ allowedEmails: ['owner@example.com'] });
    try {
      const c = client(api.base);
      await c.login('s-owner', 'owner@example.com');
      const id = await gendecFlight(c);
      // the provider fails: 502, nothing recorded, and the form can be sent again
      setMailTransport(async () => {
        throw new Error('boom');
      });
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`)).status).toBe(502);
      expect((await c.call<FormsState>('GET', `flights/${id}/forms`)).body.gendec.submission).toBeNull();

      mockMail(150);
      const n = sent.length;
      const rs = await Promise.all(
        [1, 2, 3].map(() => c.call('POST', `flights/${id}/forms/gendec/send`, { resend: true })),
      );
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(sent.length - n).toBe(1);
      // once finished (and 10 minutes later), an explicit resend is possible again
      await api.later();
      expect((await c.call('POST', `flights/${id}/forms/gendec/send`, { resend: true })).status).toBe(200);
      expect(sent.length - n).toBe(2);
    } finally {
      await api.close();
    }
  });
});
