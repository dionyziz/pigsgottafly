// Filing backends (api/_lib/filers/): the order and the fallback between them, the fax backend
// against a MOCKED fax service (nothing is ever faxed from tests: tests/setup/noExternalApis.ts
// refuses the real hosts) and a mocked print: the fax's pages, its routing by departure, the
// delivery reports (signed webhooks, polling), the DLA and CNL faxes to the number the plan went to,
// the caps, and the fallback from a failing autorouter to the fax.
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { AutorouterSettings } from '../../api/_lib/autorouter';
import { FAX_FLIGHT_CAP } from '../../api/_lib/filers/fax';
import {
  faxFromEnv,
  faxProvider,
  type FaxSettings,
  FaxSignatureError,
  sinchToken,
  verifyTelnyx,
} from '../../api/_lib/filers/faxProviders';
import { ATHENS_AIS, faxDestination } from '../../api/_lib/filers/faxRoutes';
import { filerOrder, withFallback } from '../../api/_lib/filers/select';
import { type Filer, FilerError } from '../../api/_lib/filers/types';
import { setMailTransport } from '../../api/_lib/mail';
import { createServer } from '../../server/server';
import { AERODROMES as aerodromes } from '../../src/data/ref';
import type { FplFaxContent } from '../../src/shared/fax';
import { cnlMessage, dlaMessage } from '../../src/shared/icaoMessages';
import type { RefAerodrome } from '../../src/shared/ref';
import type { Pilot, RoutePoint } from '../../src/shared/types';
import { CID, type Client, client, JWK } from './helpers';

const FPL =
  '(FPL-SXASV-VG\n-C172/L-SDFGY/C\n-LGTT0800\n-N0092VFR DCT\n-LGMG0030\n-DOF/261116 REG/SXASV\n-E/0400 P/2 A/WHITE C/PILOT +3069000000)';

// ------------------------------------------------------------------------------------------------ units

describe('fax routing by departure', () => {
  test('every departure goes to Athens Central AIS by default', () => {
    expect(faxDestination('LGTT', {})).toEqual({ number: '+302103532635', unit: 'Athens Central AIS' });
    expect(faxDestination('LGMG', {})).toEqual(ATHENS_AIS);
  });
  test('an aerodrome with its own office overrides it; FAX_AIS_NUMBER replaces the default number', () => {
    const routes = { LGIR: { number: '+302810000000', unit: 'Heraklion ARO' } };
    expect(faxDestination('lgir', {}, routes)).toEqual({ number: '+302810000000', unit: 'Heraklion ARO' });
    expect(faxDestination('LGTT', {}, routes)).toEqual(ATHENS_AIS);
    expect(faxDestination('LGTT', { FAX_AIS_NUMBER: '+30 210 000 0000' }).number).toBe('+302100000000');
    expect(faxDestination('LGTT', { FAX_AIS_NUMBER: 'not a number' }).number).toBe(ATHENS_AIS.number);
  });
});

describe('DLA and CNL messages', () => {
  test('from the plan as filed, with the new EOBT and its date', () => {
    expect(dlaMessage(FPL, Date.UTC(2026, 10, 16, 9, 30))).toBe('(DLA-SXASV-LGTT0930-LGMG-DOF/261116)');
    expect(dlaMessage(FPL, Date.UTC(2026, 10, 17, 0, 10))).toBe('(DLA-SXASV-LGTT0010-LGMG-DOF/261117)');
    expect(cnlMessage(FPL, Date.UTC(2026, 10, 16, 8, 0))).toBe('(CNL-SXASV-LGTT0800-LGMG-DOF/261116)');
    expect(cnlMessage(FPL, null)).toBe('(CNL-SXASV-LGTT0800-LGMG-DOF/261116)');
  });
});

describe('selection and fallback', () => {
  const pilot = { id: 'p1' } as Pilot;
  const fake = (id: 'autorouter' | 'fax', available: boolean, fail?: FilerError): Filer =>
    ({
      id,
      labelFor: () => id,
      capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: id === 'autorouter' },
      availableFor: () => ({ available, reason: available ? null : `${id} off` }),
      file: async () => {
        if (fail) throw fail;
        return { providerId: `${id}-1`, status: 'filed', message: '', logText: 'ok' };
      },
    }) as unknown as Filer;

  test('FILERS: known ids, in order, once; default autorouter then fax', () => {
    expect(filerOrder(undefined)).toEqual(['autorouter', 'fax']);
    expect(filerOrder('fax, autorouter')).toEqual(['fax', 'autorouter']);
    expect(filerOrder('fax,bogus,fax')).toEqual(['fax']);
    expect(filerOrder(' ')).toEqual(['autorouter', 'fax']);
  });
  test('the first available files; unavailable ones are skipped', async () => {
    const failed: string[] = [];
    const r = await withFallback(
      [fake('autorouter', false), fake('fax', true)],
      pilot,
      'LGTT',
      (f) => f.file(null as never, null as never),
      async (a) => void failed.push(a.filer.id),
    );
    expect(r.filer.id).toBe('fax');
    expect(failed).toEqual([]);
  });
  test('a transient failure falls through to the next; a refusal of the plan does not', async () => {
    const failed: string[] = [];
    const run = (filers: Filer[]) =>
      withFallback(
        filers,
        pilot,
        'LGTT',
        (f) => f.file(null as never, null as never),
        async (a) => void failed.push(`${a.filer.id}: ${a.error.message}`),
      );
    const r = await run([fake('autorouter', true, new FilerError('down', 502)), fake('fax', true)]);
    expect(r.filer.id).toBe('fax');
    expect(failed).toEqual(['autorouter: down']);
    failed.length = 0;
    await expect(
      run([fake('autorouter', true, new FilerError('bad item 15', 400)), fake('fax', true)]),
    ).rejects.toThrow('bad item 15');
    expect(failed).toEqual(['autorouter: bad item 15']);
    await expect(run([fake('autorouter', false), fake('fax', false)])).rejects.toMatchObject({
      status: 503,
      message: 'autorouter off',
    });
    failed.length = 0;
    await expect(
      run([fake('autorouter', true, new FilerError('down', 502)), fake('fax', true, new FilerError('busy', 502))]),
    ).rejects.toThrow('busy');
    expect(failed).toEqual(['autorouter: down', 'fax: busy']);
  });
});

/** An Ed25519 key pair as Telnyx's: the public key as base64 of its raw 32 bytes. */
function telnyxKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const sign = (body: string, ts = Math.floor(Date.now() / 1000)) => ({
    'telnyx-timestamp': String(ts),
    'telnyx-signature-ed25519': crypto.sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString('base64'),
  });
  return { publicKey: raw.toString('base64'), sign };
}

describe('webhook signatures', () => {
  const k = telnyxKeys();
  const body = JSON.stringify({
    data: { event_type: 'fax.delivered', payload: { fax_id: 'f1', status: 'delivered' } },
  });
  const req = (headers: Record<string, string>, raw = body) => ({
    headers,
    raw: Buffer.from(raw),
    query: new URLSearchParams(),
  });
  test('Telnyx: Ed25519 over "<timestamp>|<body>", within 5 minutes', () => {
    expect(() => verifyTelnyx(req(k.sign(body)), k.publicKey, Date.now())).not.toThrow();
    expect(() => verifyTelnyx(req(k.sign(body), body.replace('f1', 'f2')), k.publicKey, Date.now())).toThrow(
      FaxSignatureError,
    );
    expect(() => verifyTelnyx(req(k.sign(body, Math.floor(Date.now() / 1000) - 600)), k.publicKey, Date.now())).toThrow(
      /stale/,
    );
    expect(() => verifyTelnyx(req({}), k.publicKey, Date.now())).toThrow(/unsigned/);
    expect(() => verifyTelnyx(req(k.sign(body)), telnyxKeys().publicKey, Date.now())).toThrow(/bad signature/);
    expect(() => verifyTelnyx(req(k.sign(body)), '', Date.now())).toThrow(FaxSignatureError);
  });
  test('Sinch (unsigned callbacks): our own HMAC of the fax log id in the callback URL', () => {
    const p = faxProvider({
      ...faxFromEnv({ FAX_PROVIDER: 'sinch', FAX_API_KEY: 'k', FAX_API_SECRET: 's', FAX_PROJECT_ID: 'pr' })!,
      webhookSecret: 'sec',
    });
    const ok = new URLSearchParams({ ref: 'fx_1', token: sinchToken('sec', 'fx_1') });
    const raw = Buffer.from(
      JSON.stringify({ event: 'FAX_COMPLETED', fax: { id: 'sf1', status: 'COMPLETED', numberOfPages: 2 } }),
    );
    expect(p.webhook({ headers: {}, raw, query: ok })).toEqual({
      faxId: 'sf1',
      state: 'delivered',
      error: undefined,
      pages: 2,
      ref: 'fx_1',
    });
    const forged = new URLSearchParams({ ref: 'fx_2', token: sinchToken('sec', 'fx_1') });
    expect(() => p.webhook({ headers: {}, raw, query: forged })).toThrow(FaxSignatureError);
  });
});

describe('fax configuration', () => {
  test('absent or incomplete: no fax backend; FAX_DRY_RUN=1 needs no keys', () => {
    expect(faxFromEnv({})).toBeNull();
    expect(faxFromEnv({ FAX_API_KEY: 'k' })).toBeNull();
    expect(
      faxFromEnv({ FAX_PROVIDER: 'telnyx', FAX_API_KEY: 'k', FAX_CONNECTION_ID: 'c', FAX_FROM: '+1 555 0100' }),
    ).toMatchObject({
      provider: 'telnyx',
      from: '+15550100',
    });
    expect(
      faxFromEnv({ FAX_PROVIDER: 'sinch', FAX_API_KEY: 'k', FAX_API_SECRET: 's', FAX_PROJECT_ID: 'p' }),
    ).toMatchObject({
      provider: 'sinch',
    });
    expect(faxFromEnv({ FAX_DRY_RUN: '1' })).toMatchObject({ provider: 'dry-run' });
  });
  test('Sinch: the PDF and the signed callback URL go in the multipart form', async () => {
    const seen: { url: string; form: FormData; auth: string | null }[] = [];
    const p = faxProvider({
      ...faxFromEnv({ FAX_PROVIDER: 'sinch', FAX_API_KEY: 'k', FAX_API_SECRET: 's', FAX_PROJECT_ID: 'pr' })!,
      webhookSecret: 'sec',
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, form: init.body as FormData, auth: new Headers(init.headers).get('authorization') });
        return new Response(JSON.stringify({ id: 'sf9', status: 'QUEUED' }), { status: 200 });
      }) as typeof fetch,
    });
    const r = await p.send({
      to: '+302103532635',
      pdf: Buffer.from('%PDF-1.4'),
      ref: 'fx_9',
      callbackUrl: 'https://x.test/cb',
    });
    expect(r).toMatchObject({ faxId: 'sf9', state: 'sending' });
    expect(seen[0].url).toBe('https://fax.api.sinch.com/v3/projects/pr/faxes');
    expect(seen[0].auth).toBe(`Basic ${Buffer.from('k:s').toString('base64')}`);
    expect(seen[0].form.get('to')).toBe('+302103532635');
    expect((seen[0].form.get('file') as File).type).toBe('application/pdf');
    const cb = new URL(String(seen[0].form.get('callbackUrl')));
    expect(cb.searchParams.get('token')).toBe(sinchToken('sec', 'fx_9'));
  });
});

// ------------------------------------------------------------------------------------------------ the API

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
const at = (hhmm: string) => Date.parse(`${tomorrow}T${hhmm}:00Z`);

function mockTelnyx() {
  const sent: { to: string; from: string; connection: string; pdf: string; auth: string | null }[] = [];
  const state = { status: 'queued', failNext: 0 };
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== 'api.telnyx.com') throw new Error(`unexpected ${url}`);
    if (url.pathname === '/v2/faxes' && init?.method === 'POST') {
      if (state.failNext > 0) {
        state.failNext--;
        return new Response(JSON.stringify({ errors: [{ title: 'Service Unavailable' }] }), { status: 503 });
      }
      const f = init.body as FormData;
      const file = f.get('contents') as File;
      sent.push({
        to: String(f.get('to')),
        from: String(f.get('from')),
        connection: String(f.get('connection_id')),
        pdf: Buffer.from(await file.arrayBuffer()).toString(),
        auth: new Headers(init.headers).get('authorization'),
      });
      return new Response(JSON.stringify({ data: { id: `tx-${sent.length}`, status: 'queued' } }), { status: 202 });
    }
    const m = /^\/v2\/faxes\/([\w-]+)$/.exec(url.pathname);
    if (m) return new Response(JSON.stringify({ data: { id: m[1], status: state.status, page_count: 2 } }));
    return new Response('{}', { status: 404 });
  }) as typeof globalThis.fetch;
  return { sent, state, fetch };
}

/** autorouter that is down (every flight-plan call 503s), or refuses the plan (400). */
function mockAutorouter(mode: { now: 'down' | 'refuses' }) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL) => {
    const path = new URL(String(input)).pathname.replace(/^\/v1\.0/, '');
    calls.push(path);
    if (path === '/oauth2/token') return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    if (mode.now === 'refuses')
      return new Response(JSON.stringify({ error: 'FPLAN_ITEM15_INVALIDROUTETOKEN' }), { status: 200 });
    return new Response(JSON.stringify({ error: 'maintenance' }), { status: 503 });
  }) as typeof globalThis.fetch;
  return { calls, fetch, mode };
}

describe('filing by fax (mocked fax service, mocked print)', () => {
  const tx = mockTelnyx();
  const keys = telnyxKeys();
  const ar = mockAutorouter({ now: 'down' });
  const printed: FplFaxContent[] = [];
  let base: string;
  let close: () => Promise<void>;
  let a: Client, other: Client;
  const fax: FaxSettings = {
    ...faxFromEnv({ FAX_PROVIDER: 'telnyx', FAX_API_KEY: 'KEY', FAX_CONNECTION_ID: 'conn-1', FAX_FROM: '+15550100' })!,
    webhookPublicKey: keys.publicKey,
    fetch: tx.fetch,
  };
  const autorouter: AutorouterSettings = {
    email: 'app@example.com',
    password: 's3cret',
    filing: true,
    fetch: ar.fetch,
    sleep: async () => {},
  };
  beforeAll(async () => {
    setMailTransport(async () => ({ id: 'm' }));
    const s = createServer({
      db: 'memory://',
      googleClientId: CID,
      googleKeys: async () => [JWK],
      autorouter,
      autorouterPilots: ['fa@example.com'],
      fax,
      faxPilots: ['fa@example.com', 'fx@example.com'],
      faxPdf: async (c) => {
        printed.push(c);
        return Buffer.from(`%PDF-1.4 ${c.kind} ${c.message}`);
      },
      client: (_q, r) => {
        r.writeHead(404);
        r.end();
      },
    });
    await s.ready;
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/`;
    close = () => new Promise<void>((r) => s.close(() => r()));
    a = client(base);
    other = client(base);
    await a.login('fa', 'fa@example.com');
    await other.login('fo', 'fo@example.com');
    expect((await a.call('PUT', 'me', { fullName: 'Pat Pilot', phone: '+30 6900000000' })).status).toBe(200);
    expect((await a.call('POST', 'aircraft', { registration: 'SX-ASV' })).status).toBe(201);
  });
  afterAll(async () => {
    setMailTransport(null);
    await close();
  });
  const newFlight = async (c: Client = a) =>
    (
      await c.call('POST', 'flights', {
        date: tomorrow,
        blockOff: '08:00',
        taxiOutMin: 10,
        taxiInMin: 10,
        route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      })
    ).body.id as string;
  const webhook = async (event: string, payload: Record<string, unknown>, sign = true) => {
    const body = JSON.stringify({ data: { event_type: event, id: crypto.randomUUID(), payload } });
    const r = await fetch(`${base}filing/fax/webhook/telnyx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(sign ? keys.sign(body) : {}) },
      body,
    });
    return r.status;
  };

  test('the backends, in order, honestly: autorouter acknowledges, the fax does not', async () => {
    const fid = await newFlight();
    const s = (await a.call('GET', `flights/${fid}/filing`)).body;
    expect(s.enabled).toBe(true);
    expect(s.filers).toEqual([
      expect.objectContaining({
        id: 'autorouter',
        available: true,
        capabilities: expect.objectContaining({ ackRej: true }),
      }),
      expect.objectContaining({
        id: 'fax',
        label: 'Fax to Athens Central AIS',
        available: true,
        capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: false },
      }),
    ]);
    // a pilot on neither list: nothing available, with the reason
    const o = await newFlight(other);
    const so = (await other.call('GET', `flights/${o}/filing`)).body;
    expect(so.enabled).toBe(false);
    expect(so.filers.map((f: any) => [f.id, f.available])).toEqual([
      ['autorouter', false],
      ['fax', false],
    ]);
    expect(so.reason).toMatch(/not available for this account/);
    const before = tx.sent.length;
    expect((await other.call('POST', `flights/${o}/filing`, { fpl: FPL, addresses: [] })).status).toBe(503);
    expect(tx.sent.length).toBe(before);
  });

  test('autorouter down: the fax files instead; the record says so; delivery comes by signed webhook', async () => {
    const fid = await newFlight();
    printed.length = 0;
    const r = await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: ['LGGGZFZX'] });
    expect(r.status).toBe(200);
    expect(ar.calls).toContain('/router');
    expect(r.body.filing).toMatchObject({
      provider: 'fax',
      providerLabel: 'Fax to Athens Central AIS',
      status: 'sending',
      faxTo: { number: '+302103532635', unit: 'Athens Central AIS' },
      capabilities: { ackRej: false },
    });
    expect(r.body.log.slice(0, 3).map((l: any) => [l.action, l.via, l.ok])).toEqual([
      ['copy', 'fax', true],
      ['file', 'fax', true],
      ['file', 'autorouter', false],
    ]);
    // the fax: to Athens AIS from the account's number, the print of the plan with the cover's facts
    const f = tx.sent.at(-1)!;
    expect(f).toMatchObject({ to: '+302103532635', from: '+15550100', connection: 'conn-1', auth: 'Bearer KEY' });
    expect(f.pdf).toContain('%PDF-1.4 file (FPL-SXASV-VG');
    expect(printed[0]).toMatchObject({
      kind: 'file',
      to: { unit: 'Athens Central AIS', number: '+302103532635' },
      from: { name: 'Pat Pilot', phone: '+30 6900000000', email: 'fa@example.com' },
      fpl: FPL,
      message: FPL,
      addresses: ['LGGGZFZX'],
      signature: { name: 'Pat Pilot' },
    });
    const faxId = `tx-${tx.sent.length}`;
    // unsigned or forged reports change nothing
    expect(await webhook('fax.delivered', { fax_id: faxId, status: 'delivered' }, false)).toBe(404);
    expect((await a.call('GET', `flights/${fid}/filing`)).body.filing.status).toBe('sending');
    // progress, then delivery
    expect(await webhook('fax.sending.started', { fax_id: faxId, status: 'sending', direction: 'outbound' })).toBe(200);
    expect(await webhook('fax.delivered', { fax_id: faxId, status: 'delivered', page_count: 2 })).toBe(200);
    expect(await webhook('fax.delivered', { fax_id: faxId, status: 'delivered', page_count: 2 })).toBe(200);
    const s = (await a.call('GET', `flights/${fid}/filing`)).body;
    expect(s.filing.status).toBe('delivered');
    const deliveries = s.log.filter((l: any) => l.action === 'delivery');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ ok: true, via: 'fax' });
    expect(deliveries[0].message).toBe('FPL fax delivered to Athens Central AIS (+302103532635, 2 pages)');
    // a fax this app never sent: acknowledged and ignored
    expect(await webhook('fax.delivered', { fax_id: 'someone-else', status: 'delivered' })).toBe(200);
  });

  test('delay and cancel: DLA and CNL faxes to the number the plan went to; a failed CNL puts the plan back', async () => {
    const fid = await newFlight();
    await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [], via: 'fax' });
    await webhook('fax.delivered', { fax_id: `tx-${tx.sent.length}`, status: 'delivered' });
    // the default unit's number changes after filing: the plan's DLA and CNL still go where it went
    process.env.FAX_AIS_NUMBER = '+302100000000';
    try {
      const eobt = at('09:30');
      const d = await a.call('POST', `flights/${fid}/filing/delay`, { eobt });
      expect(d.status).toBe(200);
      expect(d.body.filing).toMatchObject({
        provider: 'fax',
        status: 'delivered',
        eobt,
        message: 'Delay sent by fax.',
      });
      expect(tx.sent.at(-1)!.to).toBe('+302103532635');
      expect(printed.at(-1)).toMatchObject({
        kind: 'delay',
        message: `(DLA-SXASV-LGTT0930-LGMG-DOF/${tomorrow.slice(2).replace(/-/g, '')})`,
      });
      await webhook('fax.delivered', { fax_id: `tx-${tx.sent.length}`, status: 'delivered' });
      expect((await a.call('GET', `flights/${fid}/filing`)).body.filing.message).toBe('Delay delivered by fax.');

      const c = await a.call('POST', `flights/${fid}/filing/cancel`, {});
      expect(c.body.filing.status).toBe('cancelled');
      expect(tx.sent.at(-1)!.to).toBe('+302103532635');
      expect(printed.at(-1)!.message).toMatch(/^\(CNL-SXASV-LGTT0930-LGMG-DOF\/\d{6}\)$/);
      await webhook('fax.failed', { fax_id: `tx-${tx.sent.length}`, status: 'failed', failure_reason: 'user_busy' });
      const s = (await a.call('GET', `flights/${fid}/filing`)).body;
      expect(s.filing.status).toBe('delivered');
      expect(s.filing.message).toBe('The cancellation fax did not go through (user busy): cancel again.');
      expect(s.log[0]).toMatchObject({ action: 'delivery', ok: false, via: 'fax' });
    } finally {
      delete process.env.FAX_AIS_NUMBER;
    }
  });

  test('refresh polls the fax service; a failed fax can be filed again', async () => {
    const fid = await newFlight();
    await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [], via: 'fax' });
    tx.state.status = 'failed';
    const r = await a.call('POST', `flights/${fid}/filing/refresh`);
    expect(r.status).toBe(200);
    expect(r.body.filing.status).toBe('failed');
    expect(r.body.filing.message).toMatch(/did not go through/);
    tx.state.status = 'queued';
    const again = await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [], via: 'fax' });
    expect(again.status).toBe(200);
    expect(again.body.filing.status).toBe('sending');
  });

  test('autorouter refusing the plan itself: no fax is sent', async () => {
    ar.mode.now = 'refuses';
    try {
      const fid = await newFlight();
      const before = tx.sent.length;
      const r = await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [] });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/INVALIDROUTETOKEN/);
      expect(tx.sent.length).toBe(before);
      expect((await a.call('GET', `flights/${fid}/filing`)).body.filing).toBeNull();
    } finally {
      ar.mode.now = 'down';
    }
  });

  test('the fax service down: 502 with its text, the fax logged as failed; caps per flight', async () => {
    // a pilot of their own, so the per-pilot cap stays out of the way
    const x = client(base);
    await x.login('fx', 'fx@example.com');
    await x.call('PUT', 'me', { fullName: 'Max Pilot', phone: '+30 6900000001' });
    expect((await x.call('POST', 'aircraft', { registration: 'SX-ASV' })).status).toBe(201);
    const fid = await newFlight(x);
    tx.state.failNext = 1;
    const r = await x.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [], via: 'fax' });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/Telnyx refused the fax: Service Unavailable/);
    // file, fail, refresh… until the flight's cap: a failed send does not count
    let status = 0;
    for (let i = 0; i <= FAX_FLIGHT_CAP; i++) {
      const s = await x.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [], via: 'fax' });
      status = s.status;
      if (status !== 200) {
        expect(s.body.error).toMatch(/This flight has been faxed 6 times/);
        break;
      }
      await webhook('fax.failed', { fax_id: `tx-${tx.sent.length}`, status: 'failed' });
    }
    expect(status).toBe(429);
  });

  test('an unknown provider path or a wrong one: 404', async () => {
    const r = await fetch(`${base}filing/fax/webhook/sinch`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(404);
  });
});

describe('filing by fax through Sinch (the default service; mocked)', () => {
  const sent: { to: string; callbackUrl: string | null; serviceId: string | null }[] = [];
  const sinchFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== 'fax.api.sinch.com') throw new Error(`unexpected ${url.href}`);
    if (init?.method === 'POST') {
      const f = init.body as FormData;
      sent.push({
        to: String(f.get('to')),
        callbackUrl: f.get('callbackUrl') as string | null,
        serviceId: f.get('serviceId') as string | null,
      });
      return new Response(JSON.stringify({ id: `sf-${sent.length}`, status: 'QUEUED' }));
    }
    return new Response(JSON.stringify({ id: url.pathname.split('/').pop(), status: 'IN_PROGRESS' }));
  }) as typeof globalThis.fetch;
  let base: string;
  let close: () => Promise<void>;
  let a: Client;
  beforeAll(async () => {
    setMailTransport(async () => ({ id: 'm' }));
    const fax = faxFromEnv({
      FAX_API_KEY: 'kid',
      FAX_API_SECRET: 'ksecret',
      FAX_PROJECT_ID: 'proj',
      FAX_SERVICE_ID: 'svc',
      FAX_WEBHOOK_SECRET: 'a-long-random-secret',
    })!;
    expect(fax.provider).toBe('sinch');
    const s = createServer({
      db: 'memory://',
      googleClientId: CID,
      googleKeys: async () => [JWK],
      fax: { ...fax, fetch: sinchFetch },
      faxPilots: ['*'],
      faxWebhookBase: 'https://pgf.example',
      faxPdf: async () => Buffer.from('%PDF-1.4'),
      client: (_q, r) => {
        r.writeHead(404);
        r.end();
      },
    });
    await s.ready;
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/`;
    close = () => new Promise<void>((r) => s.close(() => r()));
    a = client(base);
    await a.login('sa', 'sa@example.com');
    await a.call('PUT', 'me', { fullName: 'Sam Pilot', phone: '+30 6900000002' });
    expect((await a.call('POST', 'aircraft', { registration: 'SX-ASV' })).status).toBe(201);
  });
  afterAll(async () => {
    setMailTransport(null);
    await close();
  });
  const callback = (cb: string, body: unknown, query?: string) =>
    fetch(`${base}filing/fax/webhook/sinch${query ?? new URL(cb).search}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('the callback URL carries the fax’s own token; only that fax’s report is taken', async () => {
    const fid = (
      await a.call('POST', 'flights', {
        date: tomorrow,
        blockOff: '08:00',
        route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      })
    ).body.id;
    const r = await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [] });
    expect(r.status).toBe(200);
    expect(r.body.filing).toMatchObject({ provider: 'fax', status: 'sending' });
    const s = sent.at(-1)!;
    expect(s).toMatchObject({ to: '+302103532635', serviceId: 'svc' });
    const cb = new URL(s.callbackUrl!);
    expect(cb.origin + cb.pathname).toBe('https://pgf.example/api/filing/fax/webhook/sinch');
    const ref = cb.searchParams.get('ref')!;
    expect(cb.searchParams.get('token')).toBe(sinchToken('a-long-random-secret', ref));
    const done = { event: 'FAX_COMPLETED', fax: { id: 'sf-1', status: 'COMPLETED', numberOfPages: 2 } };
    // no token, a wrong one: 404, nothing changes
    expect((await callback(s.callbackUrl!, done, '')).status).toBe(404);
    expect((await callback(s.callbackUrl!, done, `?ref=${ref}&token=nope`)).status).toBe(404);
    // a valid token for another log row, or naming another fax than its row's: ignored
    const otherRef = `?ref=fx_other&token=${sinchToken('a-long-random-secret', 'fx_other')}`;
    expect((await callback(s.callbackUrl!, done, otherRef)).status).toBe(200);
    expect(
      (await callback(s.callbackUrl!, { event: 'FAX_COMPLETED', fax: { id: 'sf-999', status: 'COMPLETED' } })).status,
    ).toBe(200);
    expect((await a.call('GET', `flights/${fid}/filing`)).body.filing.status).toBe('sending');
    expect((await callback(s.callbackUrl!, done)).status).toBe(200);
    const st = (await a.call('GET', `flights/${fid}/filing`)).body;
    expect(st.filing.status).toBe('delivered');
    expect(st.log[0].message).toBe('FPL fax delivered to Athens Central AIS (+302103532635, 2 pages)');
  });
});
