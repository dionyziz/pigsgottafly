// The built core.js (native/ios/PigsGottaFly/Resources/core.js) as the iPhone app runs it: loaded in
// a fresh context with only the ECMAScript globals (no window, document, fetch, timers, require or
// process, as in JavaScriptCore), every PGF function called with JSON text and its answer read back
// as JSON. And the committed file is what the sources build (a stale core.js fails here).
import fs from 'node:fs';
import vm from 'node:vm';

import { beforeAll, describe, expect, test } from 'vitest';

import { buildFromTemplate } from '../../../src/features/hangar/templates';
import { buildCore, CORE_OUT } from '../../../tools/build_native_core';
import { AC, API_REF, briefing, flight, notam, NOW, PILOT, ROUTE } from './fixtures';

const code = fs.readFileSync(CORE_OUT, 'utf8');

describe('core.js in a bare JavaScript context', () => {
  const ctx = vm.createContext({});
  beforeAll(() => {
    // V8 gives a context its own console; JavaScriptCore need not have one
    vm.runInContext('delete globalThis.console', ctx);
    vm.runInContext(code, ctx, { filename: 'core.js' });
  });
  /** Calls PGF[fn] with JSON text, as the app does, and parses its answer's JSON. */
  const call = (fn: string, input: unknown = {}) => {
    ctx.__input = JSON.stringify(input);
    return JSON.parse(vm.runInContext(`JSON.stringify(PGF.${fn}(__input))`, ctx) as string);
  };

  test('only the ECMAScript globals are there', () => {
    const missing = [
      'window',
      'document',
      'fetch',
      'setTimeout',
      'require',
      'process',
      'URL',
      'URLSearchParams',
      'atob',
      'console',
    ];
    for (const g of missing) expect(vm.runInContext(`typeof ${g}`, ctx), g).toBe('undefined');
    expect(vm.runInContext('typeof PGF', ctx)).toBe('object');
    expect(vm.runInContext('typeof globalThis.PGF.computeFlight', ctx)).toBe('function');
  });

  test('version', () => {
    expect(vm.runInContext('PGF.version', ctx)).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{12}$/);
  });

  test('chartStyle, symbolNames, layerGroups', () => {
    const style = call('chartStyle', { base: 'light', vector: null });
    expect(style.version).toBe(8);
    expect(style.layers.length).toBeGreaterThan(40);
    expect(call('symbolNames').map((s: { name: string }) => s.name)).toContain('pgf-ad-major');
    expect(call('layerGroups').notams).toEqual(['notam-fill', 'notam-line']);
  });

  test('chartData', () => {
    const data = call('chartData', { ref: API_REF, flight: flight(ROUTE()), notams: briefing([notam()]), now: NOW });
    expect(data['route-line'].features).toHaveLength(1);
    expect(data['notam-areas'].features).toHaveLength(1);
    expect(data.zones.features.length).toBeGreaterThan(10);
  });

  test('weatherRequests, computeFlight (with the terrain), progress, paperwork', () => {
    const f = flight(ROUTE());
    const paths = call('weatherRequests', { flight: f, ref: API_REF, now: NOW });
    expect(paths.some((p: string) => p.startsWith('/api/weather/grid?kind=wind'))).toBe(true);
    const terrain = fs.readFileSync(new URL('../../../public/terrain/greece.bin', import.meta.url)).toString('base64');
    expect(call('setTerrain', { base64: terrain })).toEqual({ ok: true });
    const c = call('computeFlight', { flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather: {}, now: NOW });
    expect(c.navlog.legs).toHaveLength(3);
    expect(c.legs[0].altSource).toBeTruthy();
    expect(c.readiness.length).toBeGreaterThan(5);
    const leg = c.legs[1];
    const p = call('progress', {
      computed: c,
      position: { lat: (leg.from.lat + leg.to.lat) / 2, lon: (leg.from.lon + leg.to.lon) / 2, time: NOW },
    });
    expect(p.legIndex).toBe(1);
    expect(p.toWaypoint.name).toBe('KORINTHOS');
    expect(call('paperwork', {})[0]).toMatchObject({ id: 'filing', state: 'todo' });
    expect(call('setTerrain', { base64: null })).toEqual({ ok: false });
  });

  test('aircraftTemplates, aircraftFromTemplate: the hangar template for a first aircraft', () => {
    expect(call('aircraftTemplates')).toEqual([
      { id: 'reims-f172m', label: 'Reims/Cessna F172M', description: 'AFM 1972' },
    ]);
    const a = call('aircraftFromTemplate', { id: 'reims-f172m', registration: ' sx-abc ' });
    expect(a).toEqual({ ...buildFromTemplate('reims-f172m'), registration: 'SX-ABC' });
    expect(call('aircraftFromTemplate', { id: 'nope', registration: 'SX-ABC' }).icaoType).toBe('');
  });
});

test('the committed core.js is what the sources build (else: npm run native:core)', async () => {
  expect((await buildCore()) === code).toBe(true);
}, 60000);
