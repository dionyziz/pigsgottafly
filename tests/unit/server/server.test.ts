// Deployment hardening: the production security headers (vercel.json) and the local server's
// refusal to run local mode (no sign-in) against a Postgres database.
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { checkLocalMode, createServer, productionSecurityHeaders, ROOT, staticHandler } from '../../../server/server';
import { BASE_MAPS, GLYPHS, OFM_TILES } from '../../../src/features/editor/map/style';

const headers = productionSecurityHeaders();
const csp = headers['Content-Security-Policy'] || '';
const directives = new Map(
  csp
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .filter((p) => p[0])
    .map(([k, ...v]) => [k, v]),
);

/** CSP host-source matching, enough for our sources: scheme, host (leading *. wildcard), path prefix. */
function allows(directive: string, url: string): boolean {
  const sources = directives.get(directive) || directives.get('default-src') || [];
  const u = new URL(url);
  return sources.some((s) => {
    if (s === `${u.protocol}`) return true;
    const m = /^https:\/\/([^/]+)(\/.*)?$/.exec(s);
    if (!m || u.protocol !== 'https:') return false;
    const [, host, p] = m;
    const hostOk = host.startsWith('*.') ? u.hostname.endsWith(host.slice(1)) : u.hostname === host;
    const pathOk = !p || (p.endsWith('/') ? u.pathname.startsWith(p) : u.pathname === p);
    return hostOk && pathOk;
  });
}
const tile = (t: string) =>
  t.replace('{z}/{x}/{y}', '6/36/24').replace('{fontstack}/{range}', 'Noto%20Sans%20Regular/0-255');

describe('production security headers (vercel.json)', () => {
  test('the site cannot be framed (clickjacking)', () => {
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  });
  test('scripts only from the app and Google sign-in; no inline script, no eval', () => {
    expect(directives.get('script-src')).toEqual(["'self'", 'https://accounts.google.com/gsi/']);
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
    expect(allows('script-src', 'https://accounts.google.com/gsi/client')).toBe(true);
    expect(allows('script-src', 'https://evil.example.com/x.js')).toBe(false);
  });
  test('every external origin the client talks to is allowed', () => {
    // MapLibre fetches tiles, styles, sprites and glyphs (connect-src) from blob: workers and decodes them as images
    const tiles = [
      ...BASE_MAPS.flatMap((b) => (b.kind === 'raster' ? b.tiles : [b.styleUrl])),
      OFM_TILES,
      GLYPHS,
      'https://tiles.openfreemap.org/planet',
      'https://tiles.openfreemap.org/sprites/ofm_f384/ofm.png',
    ].map(tile);
    for (const u of tiles) {
      expect(allows('connect-src', u), u).toBe(true);
      expect(allows('img-src', u), u).toBe(true);
    }
    // forecasts come through our API (GET /api/weather/grid): the browser never calls Open-Meteo
    for (const u of [
      'https://api.open-meteo.com/v1/forecast?latitude=38',
      'https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=38',
    ]) {
      expect(allows('connect-src', u), u).toBe(false);
    }
    expect(directives.get('worker-src')).toContain('blob:');
    expect(allows('frame-src', 'https://accounts.google.com/gsi/iframe/select')).toBe(true);
    expect(allows('img-src', 'https://lh3.googleusercontent.com/a/photo')).toBe(true);
  });
  test('the local server sends the same headers with the built client', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgf-static-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    const { default: http } = await import('node:http');
    const srv = http.createServer(staticHandler(dir));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      for (const p of ['/', '/flights/x', '/missing.js']) {
        const r = await fetch(base + p);
        expect(r.headers.get('content-security-policy'), p).toBe(csp);
        expect(r.headers.get('x-frame-options'), p).toBe('DENY');
      }
    } finally {
      srv.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test('vercel.json is the single source (headers read from the repo root)', () => {
    expect(fs.existsSync(path.join(ROOT, 'vercel.json'))).toBe(true);
    expect(Object.keys(headers)).not.toContain('Cache-Control');
  });
});

describe('local mode (no GOOGLE_CLIENT_ID) is refused on Postgres', () => {
  const PG = 'postgres://user:secret@db.example.com/neondb?sslmode=require';
  test('checkLocalMode', () => {
    expect(() => checkLocalMode(PG, '', false)).toThrow(/Refusing local mode/);
    expect(() => checkLocalMode('postgresql://x@h/db', undefined, false)).toThrow(/LOCAL_MODE_ON_POSTGRES/);
    expect(() => checkLocalMode(' POSTGRES://x@h/db', '', false)).toThrow();
    expect(() => checkLocalMode(PG, 'client-id.apps.googleusercontent.com', false)).not.toThrow();
    expect(() => checkLocalMode(PG, '', true)).not.toThrow();
    expect(() => checkLocalMode('memory://', '', false)).not.toThrow();
    expect(() => checkLocalMode('/some/pgdata', '', false)).not.toThrow();
  });
  test('createServer throws before opening (and migrating) the database', () => {
    expect(() => createServer({ db: PG })).toThrow(/Refusing local mode/);
  });
  test('the error message does not echo the URL (credentials)', () => {
    try {
      checkLocalMode(PG, '', false);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('secret');
    }
  });
});
