// A local flight through the autorouter filer: offered like any other flight, and the plan goes out as
// the app wrote it (item 15 LOCAL, item 16 the departure with the pilot's duration) both to the
// stored route and to the filing. Nothing reaches autorouter: its endpoints are faked here.
import { describe, expect, test } from 'vitest';

import { AutorouterClient } from '../../api/_lib/autorouter';
import { autorouterFiler } from '../../api/_lib/filers/autorouter';
import type { Pilot } from '../../src/shared';

const FPL =
  '(FPL-SXASV-VG\n-C172/L-SDFGY/C\n-LGTT0800\n-N0092VFR LOCAL\n-LGTT0100\n-DOF/261124\n-E/0300 P/002 R/E A/WHITE C/PILOT P)';

function fakeAutorouter() {
  const calls: { path: string; body: unknown }[] = [];
  const json = (body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^\/v1\.0/, '');
    if (path === '/oauth2/token') return json({ access_token: 'tok', expires_in: 3600 });
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path === '/router') return json('LGTT-LGTT-route1');
    if (path.startsWith('/flightplan/file/')) return json({ flightid: 4242, queued: false });
    return json({});
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

describe('autorouter and local flights', () => {
  test('offered for a local flight; the plan is sent as written (LOCAL, -LGTT0100)', async () => {
    const { calls, fetch } = fakeAutorouter();
    const ar = new AutorouterClient({ email: 'app@example.com', password: 'x', filing: true, fetch });
    const filer = autorouterFiler(ar, false);
    const pilot = { id: 'p1' } as Pilot;
    expect(filer.availableFor(pilot, { adep: 'LGTT' })).toEqual({ available: true, reason: null });
    const out = await filer.file(null as never, {
      flightId: 'f1',
      pilot,
      fpl: FPL,
      addresses: [],
      eobt: Date.UTC(2026, 10, 24, 8),
      adep: 'LGTT',
    });
    expect(out).toMatchObject({ providerId: '4242', status: 'filed' });
    expect(calls.map((c) => c.path)).toEqual(['/router', '/flightplan/file/LGTT-LGTT-route1']);
    for (const c of calls) {
      const fpl = (c.body as { fpl: string }).fpl;
      expect(fpl).toBe(FPL);
      expect(fpl).toContain('-N0092VFR LOCAL\n-LGTT0100');
    }
  });
});
