// Weather hazards along the route: pure rules (src/calc/hazards.ts) on hand-made samples, a
// recorded Open-Meteo ECMWF response (tests/fixtures/openmeteo-hazards-lgtt-2026-11-16.json: run
// 15 Nov 06Z, corridor cells of LGTT → 37.80N 24.10E), METAR/TAF texts, and the route wiring
// (src/data/hazardWeather.ts) through the server route (GET /api/weather/grid) with a mocked Open-Meteo.
import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, test } from 'vitest';

import {
  aerodromeModelHazards,
  type Hazard,
  hazardLines,
  type HazardSample,
  legHazards,
  modelCloudBase,
  type NavlogResult,
  reportHazards,
  tafHazardContent,
} from '../../../src/calc';
import {
  clearHazardCache,
  computeRouteHazards,
  fetchHazardWeather,
  gridCell,
  hazardSeries,
  legCorridor,
} from '../../../src/data/hazardWeather';
import type { OpenMeteoLocation } from '../../../src/data/weather';
import { gridApi } from '../../helpers/openMeteoGrid';

const FIX: OpenMeteoLocation[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../fixtures/openmeteo-hazards-lgtt-2026-11-16.json'), 'utf8'),
);
const T = (iso: string) => Date.parse(iso);

const sample = (o: Partial<HazardSample> = {}): HazardSample => ({
  timeMs: T('2026-11-16T07:00Z'),
  weatherCode: 1,
  capeJkg: 0,
  visibilityM: null,
  cloudLowPct: 0,
  tempC: 15,
  dewC: 5,
  elevM: 100,
  levels: [],
  ...o,
});
const leg = (
  corridor: { frac: number; samples: HazardSample[] }[],
  o: Partial<Parameters<typeof legHazards>[0]> = {},
) =>
  legHazards({
    legIndex: 0,
    altFt: 3500,
    startMs: T('2026-11-16T07:00Z'),
    endMs: T('2026-11-16T07:30Z'),
    corridor,
    source: 'ECMWF IFS 0.25°, run 15 Nov 06Z',
    spacingFrac: 0.25,
    ...o,
  });

describe('model cloud base', () => {
  test('from pressure levels: halfway between the clear level below and the first ≥ SCT level', () => {
    // ground 100 m; 1000 hPa (150 m) clear, 925 hPa (800 m) 60 %, 850 hPa (1500 m) 80 %
    const s = sample({
      levels: [
        { zM: 150, coverPct: 0 },
        { zM: 800, coverPct: 60 },
        { zM: 1500, coverPct: 80 },
      ],
    });
    const c = modelCloudBase(s)!;
    expect(c.how).toBe('levels');
    expect(c.baseFt).toBeCloseTo((150 + 800) / 2 / 0.3048, 6);
    expect(c.coverPct).toBe(80); // the layer's most cover
    // FEW on the levels only: no layer
    expect(modelCloudBase(sample({ levels: [{ zM: 800, coverPct: 30 }] }))).toBeNull();
    // levels below the ground are ignored
    expect(modelCloudBase(sample({ elevM: 900, levels: [{ zM: 800, coverPct: 90 }] }))).toBeNull();
  });

  test('from the spread when the low cloud is ≥ SCT; the lower estimate wins', () => {
    // spread 2 °C → 800 ft above the ground (100 m = 328 ft) = 1128 ft
    const s = sample({ cloudLowPct: 70, tempC: 15, dewC: 13, levels: [{ zM: 800, coverPct: 50 }] });
    const c = modelCloudBase(s)!;
    expect(c.how).toBe('spread');
    expect(c.baseFt).toBeCloseTo(100 / 0.3048 + 800, 6);
    expect(c.coverPct).toBe(70);
  });
});

describe('leg hazards (model samples)', () => {
  test('cloud below planned altitude + 1000 ft: BKN is danger, with the stretch, time and a suggestion', () => {
    const cloudy = sample({
      elevM: 0,
      levels: [
        { zM: 150, coverPct: 0 },
        { zM: 1000, coverPct: 70 },
      ],
    }); // base 575 m = 1886 ft, ground at sea level
    const hz = leg([
      { frac: 0, samples: [sample()] },
      { frac: 0.5, samples: [cloudy] },
      { frac: 0.75, samples: [cloudy] },
      { frac: 1, samples: [sample()] },
    ]);
    expect(hz).toHaveLength(1);
    const h = hz[0];
    expect(h).toMatchObject({
      kind: 'cloud',
      level: 'danger',
      scope: { type: 'leg', legIndex: 0 },
      cloudBaseFt: 1900,
      suggestedMaxAltFt: 800,
    });
    expect(h.fromFrac).toBeCloseTo(0.375, 9);
    expect(h.toFrac).toBeCloseTo(0.875, 9);
    expect(h.text).toBe('BKN 1900 ft · planned 3500 ft (highest VFR ≈ 800 ft), 07:00Z');
    expect(h.source).toMatch(/ECMWF/);
  });

  test('cloud with 1000 ft clearance is fine; SCT is a warning; no suggestion below 500 ft AGL', () => {
    const base5000 = sample({
      levels: [
        { zM: 1300, coverPct: 0 },
        { zM: 1750, coverPct: 90 },
      ],
    }); // (1300+1750)/2 = 1525 m = 5003 ft
    expect(leg([{ frac: 0.5, samples: [base5000] }], { altFt: 4000 })).toEqual([]);
    expect(leg([{ frac: 0.5, samples: [base5000] }], { altFt: 4100 })[0].level).toBe('danger');
    const sct = sample({
      levels: [
        { zM: 150, coverPct: 0 },
        { zM: 1000, coverPct: 40 },
      ],
    });
    expect(leg([{ frac: 0.5, samples: [sct] }])[0]).toMatchObject({ kind: 'cloud', level: 'warn' });
    const low = sample({ elevM: 300, cloudLowPct: 100, tempC: 10, dewC: 9.5 }); // base 984 + 200 ft
    const h = leg([{ frac: 0.5, samples: [low] }])[0];
    expect(h.suggestedMaxAltFt).toBeUndefined();
    expect(h.text).toMatch(/OVC 1200 ft · planned 3500 ft \(no VFR altitude below it\)/);
  });

  test('thunderstorms: weather code 95–99 danger, high CAPE warning', () => {
    expect(leg([{ frac: 0.2, samples: [sample({ weatherCode: 95 })] }])[0]).toMatchObject({
      kind: 'ts',
      level: 'danger',
      text: 'Thunderstorm forecast, 07:00Z',
    });
    expect(leg([{ frac: 0.2, samples: [sample({ weatherCode: 99 })] }])[0].text).toMatch(/hail/);
    expect(leg([{ frac: 0.2, samples: [sample({ capeJkg: 1480 })] }])[0]).toMatchObject({
      kind: 'ts',
      level: 'warn',
      text: 'Thunderstorms possible, 07:00Z',
    });
    expect(leg([{ frac: 0.2, samples: [sample({ capeJkg: 600 })] }])).toEqual([]);
  });

  test('visibility: fog codes and model visibility (< 5 km danger, < 10 km warn)', () => {
    expect(leg([{ frac: 0, samples: [sample({ weatherCode: 45 })] }])[0]).toMatchObject({
      kind: 'vis',
      level: 'danger',
      text: 'Fog forecast, 07:00Z',
    });
    expect(leg([{ frac: 0, samples: [sample({ visibilityM: 8000 })] }])[0]).toMatchObject({
      kind: 'vis',
      level: 'warn',
      text: 'Visibility 8 km forecast, 07:00Z',
    });
    expect(leg([{ frac: 0, samples: [sample({ visibilityM: 3000 })] }])[0].level).toBe('danger');
    expect(leg([{ frac: 0, samples: [sample({ visibilityM: 24000 })] }])).toEqual([]);
  });

  test('only samples within 1 h of the leg count; the time range is reported', () => {
    const ts = (iso: string) => sample({ timeMs: T(iso), weatherCode: 95 });
    expect(leg([{ frac: 0.5, samples: [ts('2026-11-16T05:00Z'), ts('2026-11-16T09:00Z')] }])).toEqual([]);
    const h = leg([
      { frac: 0.5, samples: [ts('2026-11-16T06:00Z'), ts('2026-11-16T08:00Z'), ts('2026-11-16T10:00Z')] },
    ])[0];
    expect(h.text).toBe('Thunderstorm forecast, 06:00–08:00Z');
    expect([h.timeFromMs, h.timeToMs]).toEqual([T('2026-11-16T06:00Z'), T('2026-11-16T08:00Z')]);
  });
});

describe('recorded ECMWF forecast: LGTT 16 Nov 07Z (the review case: navlog SKY BKN007, legs at 1900 ft)', () => {
  const lgtt = hazardSeries(FIX[0]); // cell 38.00N 23.75E, model ground 193 m
  test('hazardSeries reads the levels that exist (ECMWF: 1000/925/850/700/600 hPa) and the ground', () => {
    const s = lgtt.find((x) => x.timeMs === T('2026-11-16T07:00Z'))!;
    expect(s.elevM).toBe(193);
    expect(s.weatherCode).toBe(2);
    expect(s.visibilityM).toBeNull(); // not provided for ECMWF
    expect(s.levels.map((l) => l.zM)).toEqual([181, 838, 1543, expect.any(Number), expect.any(Number)]);
    expect(s.levels[1].coverPct).toBe(52);
  });

  test('departure at 07:15Z, first leg at 1900 ft: BKN about 1400 ft, danger, no usable altitude below', () => {
    const hz = aerodromeModelHazards({
      end: 'departure',
      altFt: 1900,
      timeMs: T('2026-11-16T07:15Z'),
      samples: lgtt,
      source: 'ECMWF IFS 0.25°, run 15 Nov 06Z',
    });
    const c = hz.find((h) => h.kind === 'cloud')!;
    expect(c.level).toBe('danger');
    // spread 15.4/13.6 → 1.8 °C × 400 = 720 ft above 193 m (633 ft) = 1353 ft; levels give 1690 ft
    expect(c.text).toMatch(
      /^BKN 1[34]00 ft · planned 1900 ft \(no VFR altitude below it\), 06:15|^BKN 1[34]00 ft · planned 1900 ft/,
    );
    expect(c.scope).toEqual({ type: 'departure' });
    expect(hz.some((h) => h.kind === 'ts')).toBe(false);
  });
});

describe('METAR / TAF', () => {
  test('METAR: TS/CB, visibility and cloud vs the planned altitude (bases above the aerodrome)', () => {
    const hz = reportHazards(
      {
        label: 'METAR LGAV 160650Z',
        timeFromMs: 0,
        timeToMs: 0,
        visibilityM: 4000,
        clouds: [
          { cover: 'FEW', baseFt: 1500, type: null },
          { cover: 'BKN', baseFt: 2500, type: 'CB' },
        ],
        weather: ['TSRA', 'BR'],
      },
      { end: 'departure', elevFt: 300, altFt: 2500 },
    );
    expect(hz.map((h) => [h.kind, h.level])).toEqual([
      ['ts', 'danger'],
      ['vis', 'danger'],
      ['cloud', 'danger'],
    ]);
    expect(hz[0].text).toBe('Thunderstorm/CB in METAR: TSRA BKN025CB');
    expect(hz[1].text).toBe('Visibility 4 km in METAR');
    expect(hz[2].text).toBe('BKN 2800 ft in METAR · planned 2500 ft (highest VFR ≈ 1800 ft)');
    // CAVOK-like report: nothing
    expect(
      reportHazards(
        { label: 'METAR LGAV 160650Z', timeFromMs: 0, timeToMs: 0, visibilityM: 9999, clouds: [], weather: [] },
        { end: 'destination', elevFt: 300, altFt: 2500 },
      ),
    ).toEqual([]);
  });

  test('TAF: every group counts (TEMPO, PROB), header and change times skipped', () => {
    const raw =
      'TAF LGAV 160500Z 1606/1712 02010KT 9999 FEW030 TEMPO 1609/1613 4000 SHRA BKN014 PROB30 TEMPO 1612/1616 TSRA BKN025CB BECMG 1700/1702 CAVOK';
    const c = tafHazardContent(raw);
    expect(c.visibilityM).toBe(4000);
    expect(c.clouds.map((x) => `${x.cover}${x.baseFt}${x.type ?? ''}`)).toEqual(['FEW3000', 'BKN1400', 'BKN2500CB']);
    expect(c.weather).toEqual(['SHRA', 'TSRA']);
    const hz = reportHazards(
      { label: 'TAF LGAV 160500Z', timeFromMs: 0, timeToMs: 1, ...c },
      { end: 'destination', elevFt: 300, altFt: 2500 },
    );
    expect(hz.map((h) => h.kind)).toEqual(['ts', 'vis', 'cloud']);
    expect(hz[2].text).toMatch(/^BKN 1700 ft in TAF/);
  });
});

describe('route wiring (corridor, cell cache, navlog times)', () => {
  beforeEach(() => clearHazardCache());

  test('legCorridor: every ~10 NM, ±5 NM, snapped to the 0.25° grid', () => {
    const c = legCorridor({ lat: 38.1089, lon: 23.7836 }, { lat: 37.8, lon: 24.1 }, 22);
    expect(c.points.map((p) => p.frac)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(c.spacingFrac).toBeCloseTo(1 / 3, 9);
    expect(c.points[0].cells[0]).toEqual(gridCell({ lat: 38.1089, lon: 23.7836 }));
    expect(gridCell({ lat: 38.1089, lon: 23.7836 }).key).toBe('38.00,23.75');
  });

  test('fetchHazardWeather + computeRouteHazards on the recorded response', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (u: string) => {
      urls.push(String(u));
      if (String(u).includes('/static/meta.json'))
        return new Response(JSON.stringify({ last_run_initialisation_time: T('2026-11-15T06:00Z') / 1000 }));
      const lat = new URL(String(u)).searchParams.get('latitude')!.split(',');
      const lon = new URL(String(u)).searchParams.get('longitude')!.split(',');
      const byKey = new Map([
        ['38.00,23.75', FIX[0]],
        ['38.25,23.75', FIX[1]],
        ['38.00,24.00', FIX[2]],
        ['37.75,24.00', FIX[3]],
        ['37.75,24.25', FIX[4]],
      ]);
      return new Response(
        JSON.stringify(
          lat.map((la, i) => byKey.get(`${Number(la).toFixed(2)},${Number(lon[i]).toFixed(2)}`) ?? FIX[0]),
        ),
      );
    }) as unknown as typeof fetch;
    const from = { lat: 38.1089, lon: 23.7836 },
      to = { lat: 37.8, lon: 24.1 };
    const api = await gridApi({ fetch: fakeFetch, now: () => T('2026-11-15T12:00Z') });
    const req = {
      date: '2026-11-16',
      model: 'ecmwf_ifs025' as const,
      legs: [{ from, to, distNm: 22 }],
      departure: from,
      destination: null,
      get: api.get,
      now: () => T('2026-11-15T12:00Z'),
    };
    const hw = await fetchHazardWeather(req);
    await api.close();
    expect(hw.status).toBe('ok');
    expect(hw.sourceLabel).toBe('ECMWF IFS 0.25°, run 2026-11-15 06Z');
    expect(hw.legs[0].corridor.length).toBeGreaterThanOrEqual(4);
    const dataCalls = urls.filter((u) => !u.includes('meta.json')).length;
    expect(dataCalls).toBe(1);
    // cached per node: the same route again fetches nothing new
    await fetchHazardWeather(req);
    expect(urls.filter((u) => !u.includes('meta.json')).length).toBe(dataCalls);

    const navlog = {
      blockOffSet: true,
      legs: [{ altFt: 1900, startMin: 7 * 60 + 15, endMin: 7 * 60 + 30 }],
      times: { blockOffMin: 420, takeoffMin: 435, landingMin: 450, blockOnMin: 465 },
    } as unknown as NavlogResult;
    const hz = computeRouteHazards({
      hw,
      navlog,
      dayMs: T('2026-11-16T00:00Z'),
      departure: { elevFt: 861, reports: null },
      destination: null,
      nowMs: T('2026-11-15T12:00Z'),
    });
    const legCloud = hz.find((h) => h.scope.type === 'leg' && h.kind === 'cloud')!;
    expect(legCloud).toBeTruthy();
    expect(legCloud.level).toBe('danger');
    // cells along the leg have 47–95 % low cloud (BKN/OVC) with 1.8–2.7 °C spreads
    expect(legCloud.text).toMatch(/^(BKN|OVC) \d+ ft · planned 1900 ft/);
    expect(hz.some((h) => h.scope.type === 'departure' && h.kind === 'cloud')).toBe(true);
    // no block start time: nothing is checked
    expect(
      computeRouteHazards({
        hw,
        navlog: { ...navlog, blockOffSet: false },
        dayMs: T('2026-11-16T00:00Z'),
        departure: null,
        destination: null,
        nowMs: 0,
      }),
    ).toEqual([]);
  });
});

test('hazard lines: no leg numbers or source; the same hazard on consecutive legs is one line', () => {
  const H = 3600e3;
  const ts = (legIndex: number, from: number, to: number): Hazard => ({
    kind: 'ts',
    level: 'warn',
    scope: { type: 'leg', legIndex },
    fromFrac: 0,
    toFrac: 1,
    text: 'Thunderstorms possible, 11:00Z',
    timeFromMs: from * H,
    timeToMs: to * H,
    source: 'ECMWF IFS 0.25°, run 16 Nov 06Z',
  });
  const names = ['A', 'B', 'C', 'D', 'E'];
  const leg = (i: number) => ({ from: names[i], to: names[i + 1] });
  const fog: Hazard = {
    ...ts(0, 6, 6),
    kind: 'vis',
    level: 'danger',
    scope: { type: 'destination' },
    text: 'Fog in METAR, 06:00Z',
    source: 'METAR LGMG 170600Z',
  };
  const lines = hazardLines([ts(0, 11, 12), ts(1, 11, 13), ts(3, 12, 14), fog], leg, () => 'LGMG');
  expect(lines).toEqual([
    { level: 'warn', text: 'A → C: Thunderstorms possible, 11:00–13:00Z' },
    { level: 'warn', text: 'D → E: Thunderstorms possible, 12:00–14:00Z' },
    { level: 'danger', text: 'LGMG: Fog in METAR, 06:00Z' },
  ]);
});
