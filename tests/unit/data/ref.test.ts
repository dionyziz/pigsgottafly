// Reference data checks, ported from the v2 aip/vfr/sun tests (now on the typed JSON).
import fs from 'node:fs';

import { expect, test } from 'vitest';

import { distanceNm, pointInPolygon } from '../../../src/calc/nav';
import {
  aerodrome,
  AERODROMES,
  AIRSPACES,
  FIS,
  RUNWAYS,
  SUN_TABLES,
  VFR_POINTS,
  VFR_ROUTES,
} from '../../../src/data/ref';
import { outputs } from '../../../tools/build_ref';

const ad = (icao: string) => aerodrome(icao)!;

test('generated reference files are up to date with data/*.js', () => {
  for (const [file, text] of Object.entries(outputs())) expect(fs.readFileSync(file, 'utf8') === text, file).toBe(true);
});

test('aerodrome data is complete', () => {
  expect(AERODROMES.length).toBeGreaterThanOrEqual(80);
  for (const a of AERODROMES) {
    expect(a.lat > 34 && a.lat < 42 && a.lon > 19 && a.lon < 30, `${a.id} position`).toBe(true);
    if (!a.water) expect(a.runways.length, `${a.id} runways`).toBeGreaterThan(0);
    for (const r of a.runways) expect(r).toMatch(/^\d{2}[LRC]?(\/\d{2}[LRC]?)?$/);
    for (const f of a.freqs)
      expect(+f.mhz >= 118 && +f.mhz <= 136.975 && +f.mhz !== 121.5, `${a.id} ${f.mhz}`).toBe(true);
  }
  expect(RUNWAYS.filter((r) => r.aerodromeId === 'LGTT').map((r) => r.designator)).toEqual(['03', '21']);
});

test('spot checks against the AIP text', () => {
  expect(ad('LGMG').runways).toEqual(['08R/26L']);
  expect(ad('LGMG').elevFt).toBe(12);
  expect(ad('LGMG').freqs.find((f) => f.role === 'primary')!.mhz).toBe('130.875');
  expect([...ad('LGAV').runways].sort()).toEqual(['03L/21R', '03R/21L']);
  expect(ad('LGKA').elevFt).toBe(2167);
  expect(ad('LGTT').freqs.find((f) => f.role === 'secondary')!.mhz).toBe('118.500');
  expect(ad('LGTS').runways).toEqual(['10/28', '16/34']);
});

test('each TMA / MTMA contains its aerodrome', () => {
  const exp: Record<string, string> = {
    LGAV: 'ATHINAI TMA',
    LGMG: 'ATHINAI TMA',
    LGIR: 'IRAKLION TMA',
    LGKV: 'KAVALA TMA',
    LGTS: 'MAKEDONIA TMA',
    LGMK: 'MIKONOS TMA',
    LGRP: 'RODOS TMA',
    LGSR: 'SANTORINI TMA',
    LGKR: 'KERKIRA TMA',
    LGBL: 'ANCHIALOS MTMA',
    LGLR: 'LARISSA MTMA',
    LGTG: 'TANAGRA MTMA',
  };
  for (const [icao, name] of Object.entries(exp)) {
    expect(
      AIRSPACES.filter((v) => v.name === name).some((v) => pointInPolygon(ad(icao), v.polygon)),
      `${icao} inside ${name}`,
    ).toBe(true);
  }
  expect(FIS.units.map((u) => u.callsign)).toEqual(['ATHINAI INFORMATION', 'MAKEDONIA INFORMATION']);
});

test('VFR routes join reporting points of their own chart', () => {
  const pt = (chart: string, name: string) => VFR_POINTS.find((p) => p.chart === chart && p.name === name);
  expect(VFR_ROUTES.length).toBeGreaterThan(200);
  for (const r of VFR_ROUTES) {
    const a = pt(r.chart, r.a),
      b = pt(r.chart, r.b);
    expect(a && b, `${r.chart} ${r.a}–${r.b}`).toBeTruthy();
    // both null: drawn on the chart without an altitude
    if (r.minFt === null || r.maxFt === null) expect([r.minFt, r.maxFt]).toEqual([null, null]);
    else expect(r.minFt >= 500 && r.minFt <= r.maxFt && r.maxFt <= 12000).toBe(true);
    const d = distanceNm(a!, b!);
    expect(d > 0.5 && d < 80).toBe(true);
  }
  const r = (c: string, a: string, b: string) => VFR_ROUTES.find((x) => x.chart === c && x.a === a && x.b === b)!;
  expect(r('LGAV', 'KORINTHOS', 'MEGARA').maxFt).toBe(3500);
  expect(r('LGRP', 'NOVEMBER', 'LINDOS')).toMatchObject({ maxFt: 4500, oneway: true });
  expect(r('LGKV', 'STRIMON', 'LOUTRA')).toMatchObject({ minFt: null, maxFt: null, oneway: false });
  expect(new Set(VFR_POINTS.map((p) => p.id)).size).toBe(VFR_POINTS.length);
});

test('GEN 2.7 sunset tables', () => {
  const idx = (m: number, d: number) =>
    [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].slice(0, m - 1).reduce((a, b) => a + b, 0) + d - 1;
  const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
  expect(Object.keys(SUN_TABLES)).toHaveLength(45);
  expect(hm(SUN_TABLES.LGMG.ss[idx(1, 1)]!)).toBe('15:17');
  expect(hm(SUN_TABLES.LGMG.tw[idx(1, 1)]!)).toBe('15:47');
  expect(hm(SUN_TABLES.LGAL.ss[idx(11, 30)]!)).toBe('14:50');
});
