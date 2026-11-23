// VFR route segments a chart draws without an altitude (min/max null in tools/vfr_charts/<ICAO>.json, e.g.
// LGKV STRIMON–LOUTRA): tools/build_vfr.py keeps them with the same endpoint and distance checks, the map
// draws them without an altitude label, and no altitude default is ever taken from them.
// HEL ONLY / MIL ONLY / JET ONLY segments (`kind`): kept by the build, drawn on their own layers (off by
// default), and giving altitudes only while their layer is shown.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, test } from 'vitest';

import { closestVfrRoute, defaultAltitudes, midpoint, vfrRouteBetween } from '../../../src/calc';
import { vfrRouteFeatures } from '../../../src/features/editor/map/features';
import { chartStyle } from '../../../src/native/core';
import {
  DEFAULT_MAP_LAYERS,
  mapLayersOf,
  type RefVfrPoint,
  type RefVfrRoute,
  type RoutePoint,
} from '../../../src/shared';

const ROOT = path.resolve(__dirname, '..', '..', '..');

const POINTS = [
  { name: 'STRIMON', dms: '40 47 14 N 023 50 59 E' },
  { name: 'LOUTRA', dms: '40 43 37 N 024 05 59 E' },
  { name: 'KALAMON', dms: '41 00 43 N 024 12 38 E' },
  { name: 'ROUPOL', dms: '40 54 58 N 024 15 22 E' },
];
const CHARTED = { a: 'KALAMON', b: 'ROUPOL', min: 3000, max: 3000, nm: 6 };
const UNCHARTED = { a: 'STRIMON', b: 'LOUTRA', min: null, max: null, nm: 12 };
const HEL = { a: 'KALAMON', b: 'LOUTRA', min: 1500, max: 1500, kind: 'hel' };
const MIL = { a: 'ROUPOL', b: 'STRIMON', min: null, max: null, kind: 'jet' };

/** Runs tools/build_vfr.py on a one-chart fixture (LGKV); the parsed window.VFR, or the printed errors. */
function build(routes: object[]): { vfr: any; out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgf-vfr-'));
  try {
    fs.mkdirSync(path.join(dir, 'charts'));
    fs.mkdirSync(path.join(dir, 'ocr'));
    fs.writeFileSync(path.join(dir, 'tables.json'), JSON.stringify({ LGKV: { ref: 'AD 2-LGKV-VFR', points: [] } }));
    fs.writeFileSync(path.join(dir, 'ofm.json'), JSON.stringify({ points: [] }));
    fs.writeFileSync(path.join(dir, 'charts', 'LGKV.json'), JSON.stringify({ points: POINTS, routes }));
    const args = ['tables.json', 'charts', 'ocr', 'ofm.json', 'vfr.js'].map((f) => path.join(dir, f));
    try {
      const out = execFileSync('python3', ['-I', path.join(ROOT, 'tools', 'build_vfr.py'), ...args], {
        encoding: 'utf8',
      });
      const ctx: any = { window: {} };
      vm.runInNewContext(fs.readFileSync(path.join(dir, 'vfr.js'), 'utf8'), ctx);
      return { vfr: ctx.window.VFR, out };
    } catch (e: any) {
      return { vfr: null, out: String(e.stdout) };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('tools/build_vfr.py', () => {
  test('keeps a segment printed without an altitude, as null', () => {
    const { vfr, out } = build([CHARTED, UNCHARTED]);
    expect(out).not.toMatch(/ERROR/);
    expect(vfr.routes).toEqual([
      { chart: 'LGKV', a: 'KALAMON', b: 'ROUPOL', min: 3000, max: 3000, oneway: false },
      { chart: 'LGKV', a: 'STRIMON', b: 'LOUTRA', min: null, max: null, oneway: false },
    ]);
  });
  test('without a printed distance too', () => {
    const { vfr } = build([{ ...UNCHARTED, nm: undefined }]);
    expect(vfr.routes).toHaveLength(1);
  });
  test('still checks the printed distance and the endpoints', () => {
    expect(build([{ ...UNCHARTED, nm: 30 }]).out).toMatch(/STRIMON–LOUTRA chart says 30 NM/);
    expect(build([{ ...UNCHARTED, b: 'NOWHERE' }]).out).toMatch(/unknown point in STRIMON–NOWHERE/);
  });
  test('carries the kind of a HEL / MIL / JET ONLY segment, and only those kinds', () => {
    const { vfr, out } = build([HEL, MIL]);
    expect(out).not.toMatch(/ERROR/);
    expect(vfr.routes.map((r: any) => r.kind)).toEqual(['hel', 'jet']);
    expect(build([CHARTED]).vfr.routes[0]).not.toHaveProperty('kind');
    expect(build([{ ...HEL, kind: 'glider' }]).out).toMatch(/kind 'glider' is not hel, mil or jet/);
  });
  test('rejects half an altitude band and insane bands', () => {
    expect(build([{ ...UNCHARTED, min: 2000 }]).out).toMatch(/only one of min\/max/);
    expect(build([{ ...CHARTED, min: 4000 }]).out).toMatch(/bad altitude band KALAMON–ROUPOL/);
  });
});

describe('a segment without an altitude in the apps', () => {
  // the built fixture as tools/build_ref.ts ships it
  const { vfr } = build([CHARTED, UNCHARTED, HEL, MIL]);
  const vfrPoints: RefVfrPoint[] = vfr.points.map((p: any) => ({ ...p, id: `${p.chart}/${p.name}` }));
  const vfrRoutes: RefVfrRoute[] = vfr.routes.map((r: any) => ({
    id: `${r.chart}:${r.a}>${r.b}`,
    chart: r.chart,
    a: r.a,
    b: r.b,
    minFt: r.min,
    maxFt: r.max,
    oneway: r.oneway,
    ...(r.kind ? { kind: r.kind } : {}),
  }));
  const ctx = { aerodromes: [], vfrPoints, vfrRoutes };
  const pt = (name: string) => vfrPoints.find((p) => p.name === name)!;
  let k = 0;
  const vfrAt = (name: string): RoutePoint => {
    const p = pt(name);
    return { uid: 'u' + k++, kind: 'vfr', refId: p.id, name, lat: p.lat, lon: p.lon };
  };
  const customAt = (lat: number, lon: number): RoutePoint => ({
    uid: 'u' + k++,
    kind: 'custom',
    refId: null,
    name: 'ZOFRI',
    lat,
    lon,
  });

  test('the map draws its line with an empty altitude label', () => {
    const f = vfrRouteFeatures(vfrRoutes, vfrPoints).features;
    const line = f.find((x) => x.properties.id === 'LGKV:STRIMON>LOUTRA')!;
    expect(line.geometry.coordinates).toEqual([
      [pt('STRIMON').lon, pt('STRIMON').lat],
      [pt('LOUTRA').lon, pt('LOUTRA').lat],
    ]);
    expect(line.properties.alt).toBe('');
    expect(f.find((x) => x.properties.id === 'LGKV:KALAMON>ROUPOL')!.properties.alt).toBe('3000');
  });

  test('a leg along it gets no altitude from it', () => {
    expect(vfrRouteBetween(pt('STRIMON'), pt('LOUTRA'), ctx)).toBeNull();
    const [d] = defaultAltitudes([vfrAt('STRIMON'), vfrAt('LOUTRA')], ctx);
    expect(d).toMatchObject({ source: 'none', route: null });
    expect(d.altFt).toBeNaN();
    expect(defaultAltitudes([vfrAt('KALAMON'), vfrAt('ROUPOL')], ctx)[0]).toMatchObject({
      altFt: 3000,
      source: 'vfr-route',
    });
  });

  test('a custom point on it takes the altitude of the nearest charted leg with one, if any', () => {
    const mid = midpoint(pt('STRIMON'), pt('LOUTRA'));
    // KALAMON–ROUPOL is over 10 NM away: nothing within reach
    expect(closestVfrRoute(mid, ctx)).toBeNull();
    const far = defaultAltitudes([customAt(mid.lat, mid.lon), vfrAt('LOUTRA')], ctx)[0];
    expect(far.source).not.toBe('closest-route');
    expect(closestVfrRoute(mid, ctx, NaN, 1e9)!.route.id).toBe('LGKV:KALAMON>ROUPOL');
  });

  test('HEL / MIL / JET ONLY routes: drawn on their own layers, hidden by default', () => {
    const f = vfrRouteFeatures(vfrRoutes, vfrPoints).features;
    const kind = (id: string) => f.find((x) => x.properties.id === id)!.properties.kind;
    expect(kind('LGKV:KALAMON>ROUPOL')).toBe('vfr');
    expect(kind('LGKV:KALAMON>LOUTRA')).toBe('hel');
    expect(kind('LGKV:ROUPOL>STRIMON')).toBe('jet');
    // which line layer draws each feature, and whether that layer is visible
    const drawnBy = (layers: Parameters<typeof mapLayersOf>[0]) => {
      const style = chartStyle({ base: 'light', vector: null, layers: layers as never });
      const lines = style.layers.filter((l) => l.type === 'line' && 'source' in l && l.source === 'vfr-routes');
      return Object.fromEntries(
        f.map((x) => [
          x.properties.id,
          lines
            .filter((l) => l.layout?.visibility !== 'none')
            .filter((l) =>
              featureFilter((l as { filter?: never }).filter, `layers[${style.layers.indexOf(l)}].filter`).filter(
                { zoom: 10 },
                {
                  type: 2,
                  properties: x.properties,
                } as never,
              ),
            )
            .map((l) => l.id),
        ]),
      );
    };
    expect(drawnBy(null)).toEqual({
      'LGKV:KALAMON>ROUPOL': ['vfr-route-line'],
      'LGKV:STRIMON>LOUTRA': ['vfr-route-line'],
      'LGKV:KALAMON>LOUTRA': [],
      'LGKV:ROUPOL>STRIMON': [],
    });
    expect(drawnBy({ helRoutes: true, milRoutes: true, vfrRoutes: false })).toEqual({
      'LGKV:KALAMON>ROUPOL': [],
      'LGKV:STRIMON>LOUTRA': [],
      'LGKV:KALAMON>LOUTRA': ['hel-route-line'],
      'LGKV:ROUPOL>STRIMON': ['mil-route-line'],
    });
  });

  test('the new layers default off, also in a selection stored before they existed', () => {
    expect(DEFAULT_MAP_LAYERS).toMatchObject({ vfrRoutes: true, helRoutes: false, milRoutes: false });
    const stored = { ...DEFAULT_MAP_LAYERS, vfrRoutes: false } as Record<string, unknown>;
    delete stored.helRoutes;
    delete stored.milRoutes;
    expect(mapLayersOf(stored)).toMatchObject({ vfrRoutes: false, helRoutes: false, milRoutes: false });
    expect(mapLayersOf({ helRoutes: true })).toMatchObject({ helRoutes: true, milRoutes: false });
  });

  test('a HEL ONLY route gives a leg its altitude only while helicopter routes are shown', () => {
    const leg = () => [vfrAt('KALAMON'), vfrAt('LOUTRA')];
    expect(vfrRouteBetween(pt('KALAMON'), pt('LOUTRA'), ctx)).toBeNull();
    expect(defaultAltitudes(leg(), ctx)[0].source).not.toBe('vfr-route');
    expect(defaultAltitudes(leg(), { ...ctx, layers: { ...DEFAULT_MAP_LAYERS, milRoutes: true } })[0].source).not.toBe(
      'vfr-route',
    );
    const shown = { ...ctx, layers: { ...DEFAULT_MAP_LAYERS, helRoutes: true } };
    expect(defaultAltitudes(leg(), shown)[0]).toMatchObject({ altFt: 1500, source: 'vfr-route' });
    // and the closest-leg rule for custom points likewise
    const mid = midpoint(pt('KALAMON'), pt('LOUTRA'));
    expect(closestVfrRoute(mid, ctx)?.route.id).not.toBe('LGKV:KALAMON>LOUTRA');
    expect(closestVfrRoute(mid, shown)!.route.id).toBe('LGKV:KALAMON>LOUTRA');
  });
});
