// The forecast path before and after the server proxy, on recorded ECMWF data
// (tests/helpers/openMeteoGrid.ts: a fake Open-Meteo whose every 0.25° node carries a recorded
// response, answering each location with its nearest grid node, as Open-Meteo does):
//   before: the browser asked Open-Meteo for the exact leg midpoints and 0.25° hazard cells
//           (tests/unit/data/legacy/weatherBefore.ts, a frozen copy of the old code), so each leg
//           had the winds of the grid node nearest its midpoint;
//   after:  the browser asks GET /api/weather/grid for grid nodes (and aerodromes), the server
//           fetches them in batches, caches them per model run in PGlite and answers; each leg's
//           winds are interpolated bilinearly between the nodes around its midpoint.
// Identical before and after: the surface conditions (and QNH) at the departure/stops/destination,
// the source line, the hazard data and the hazards. Winds: correct interpolation (exact at a node,
// the u/v mean in the middle of a cell, linear along a cell edge, never outside the corners'
// values), and a navlog close to the nearest-node one. Also: the second pass costs no Open-Meteo
// request at all, and the nodes asked for are the corners of the legs, shared where legs share them.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import cards from '../../../data/aircraft/compass-cards.json';
import { buildLegs, computeNavlog, defaultAltitudes, type NavlogInput } from '../../../src/calc';
import { computeRouteHazards, fetchHazardWeather, type HazardWeather } from '../../../src/data/hazardWeather';
import { aerodrome, REF, vfrPoint } from '../../../src/data/ref';
import { flightWeatherPlan } from '../../../src/data/useFlightWeather';
import {
  blendLocations,
  clearCache,
  fetchRouteWeather,
  type OpenMeteoLocation,
  type RouteWeather,
  sampleAt,
  surfaceConditions,
  windCorners,
  windProviderFromLegs,
} from '../../../src/data/weather';
import type { RoutePoint, WindModel } from '../../../src/shared';
import type { CompassCard } from '../../../src/shared';
import { isoDay } from '../../../src/shared/date';
import { gridCorners, LEVELS, nodeKey, type WeatherGridResponse } from '../../../src/shared/weatherGrid';
import { fakeOpenMeteo, gridApi } from '../../helpers/openMeteoGrid';
import { externalCalls } from '../../setup/noExternalApis';
import * as before from './legacy/weatherBefore';

const NOW = Date.parse('2026-11-15T13:36:00Z');
const ad = (icao: string): RoutePoint => {
  const a = aerodrome(icao)!;
  return { uid: 'ad-' + icao, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const vfr = (id: string): RoutePoint => {
  const p = vfrPoint(id)!;
  return { uid: id, kind: 'vfr', refId: id, name: p.name, lat: p.lat, lon: p.lon };
};
const custom = (name: string, lat: number, lon: number): RoutePoint => ({
  uid: 'c-' + name,
  kind: 'custom',
  refId: null,
  name,
  lat,
  lon,
});
const ctx = { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes };
const ASV_CARD = cards['SX-ASV'][0] as unknown as CompassCard;
const ASV = {
  cruiseTasKt: 92,
  patternTasKt: 80,
  burnLph: 30,
  taxiAllowanceL: 4,
  card: ASV_CARD.points,
  cardExpires: ASV_CARD.expires,
  cardName: ASV_CARD.name,
};

interface Case {
  name: string;
  date: string;
  blockOff: string;
  model: WindModel;
  route: () => RoutePoint[];
  stopAt?: number[];
}
const CASES: Case[] = [
  {
    name: 'LGTT → LGMG via DAPORI, KORINTHOS',
    date: '2026-11-16',
    blockOff: '07:00',
    model: 'ecmwf_ifs025',
    route: () => [ad('LGTT'), vfr('LGAV/DAPORI'), vfr('LGAV/KORINTHOS'), ad('LGMG')],
  },
  {
    name: 'LGTT → LGSR → LGIR across the Aegean, a stop at LGSR',
    date: '2026-11-16',
    blockOff: '10:20',
    model: 'ecmwf_ifs025',
    route: () => [ad('LGTT'), ad('LGSR'), ad('LGIR')],
    stopAt: [1],
  },
  {
    name: 'LGAV → LGKR, custom points, late evening into the next day',
    date: '2026-11-15',
    blockOff: '21:40',
    model: 'ecmwf_ifs025',
    route: () => [ad('LGAV'), custom('P1', 38.31, 22.9), custom('P2', 38.92, 21.17), ad('LGKR')],
  },
  {
    name: 'LGTG → LGSY → LGKV, GFS',
    date: '2026-11-17',
    blockOff: '05:30',
    model: 'gfs_seamless',
    route: () => [ad('LGTG'), ad('LGSY'), ad('LGKV')],
  },
  {
    name: 'LGTT → LGKZ over the mountains',
    date: '2026-11-16',
    blockOff: '12:00',
    model: 'ecmwf_ifs025',
    route: () => [ad('LGTT'), ad('LGKZ')],
  },
];
const ICON: Case = {
  name: 'LGTT → LGPZ, ICON (0.0625° grid)',
  date: '2026-11-16',
  blockOff: '09:00',
  model: 'icon_seamless',
  route: () => [ad('LGTT'), ad('LGEL'), ad('LGPZ')],
};

const ALTS = [0, 500, 1500, 2500, 3500, 4500, 5500, 6500, 8500, 9500, 12000];

function inputs(c: Case) {
  const route = c.route();
  const options = {
    aerodromeRequests: (c.stopAt ?? []).map((i) => ({ pointUid: route[i].uid, kind: 'stop' as const, stopMin: 30 })),
  };
  const legs = buildLegs(route, c.date);
  const plan = flightWeatherPlan({ date: c.date, model: c.model, route, options, legs });
  const wxReq = {
    date: c.date,
    model: c.model,
    legMidpoints: plan.mids,
    departure: plan.depLoc,
    destination: plan.destLoc,
    stops: plan.stops.map((s) => s.loc),
    now: () => NOW,
  };
  const hzReq = {
    date: c.date,
    model: c.model,
    legs: legs.map((l) => ({ from: l.from, to: l.to, distNm: l.distNm })),
    departure: plan.departure ? { lat: plan.departure.lat, lon: plan.departure.lon } : null,
    destination: plan.destination ? { lat: plan.destination.lat, lon: plan.destination.lon } : null,
    now: () => NOW,
  };
  const navIn = (w: RouteWeather): NavlogInput => ({
    date: c.date,
    blockOff: c.blockOff,
    taxiOutMin: 15,
    taxiInMin: 10,
    legs,
    altitudesFt: defaultAltitudes(route, ctx).map((d) => d.altFt),
    overrides: [],
    aircraft: ASV,
    winds: windProviderFromLegs(w.legs),
  });
  return { route, legs, plan, wxReq, hzReq, navIn };
}

/** The weather hazards of a flight along a navlog's timeline. */
function hazardsOf(c: Case, hw: HazardWeather, navlog: ReturnType<typeof computeNavlog>) {
  const { plan } = inputs(c);
  const elevFt = (a: typeof plan.departure) => (a ? (a.elevFt ?? 0) : 0);
  return computeRouteHazards({
    hw,
    navlog,
    dayMs: Date.parse(c.date + 'T00:00:00Z'),
    nowMs: NOW,
    departure: plan.departure ? { elevFt: elevFt(plan.departure), reports: null } : null,
    destination: plan.destination ? { elevFt: elevFt(plan.destination), reports: null } : null,
  });
}

/** Everything a flight computes from the forecast. */
function outcome(c: Case, w: RouteWeather, hw: HazardWeather) {
  const { legs, navIn } = inputs(c);
  const day = Date.parse(c.date + 'T00:00:00Z');
  const winds = legs.map((_, i) =>
    ALTS.map((alt) => {
      const out = [];
      for (let m = -60; m <= 48 * 60; m += 37) out.push(sampleAt(w.legs[i]!.hourly, alt, day + m * 60000));
      return out;
    }),
  );
  const surface = [w.departure, w.destination, ...(w.stops ?? [])].map((loc) => {
    const out = [];
    for (let m = 0; m <= 47 * 60; m += 53) out.push(surfaceConditions(loc, day + m * 60000));
    return out;
  });
  const navlog = computeNavlog(navIn(w));
  return { winds, surface, navlog, hazards: hazardsOf(c, hw, navlog) };
}

/** Wind (FROM, true) difference in degrees, −180…180. */
const dDir = (a: number, b: number) => ((a - b + 540) % 360) - 180;
/** A wind's u/v components (kt) from its speed and direction FROM. */
const toUv = (spd: number, dirFrom: number) => {
  const r = (dirFrom * Math.PI) / 180;
  return { u: -spd * Math.sin(r), v: -spd * Math.cos(r) };
};
const series = (l: OpenMeteoLocation, k: string) => l.hourly[k] as (number | null)[];
/** u/v of a location's wind at a pressure level ('850hPa') or 10 m ('10m') and hour index; null when missing. */
function uvAt(l: OpenMeteoLocation, level: string, i: number) {
  const s = series(l, `wind_speed_${level}`)[i],
    d = series(l, `wind_direction_${level}`)[i];
  return s == null || d == null ? null : toUv(s, d);
}
const WIND_LEVELS = [...LEVELS.map((l) => `${l}hPa`), '10m'];
const SCALARS = [
  ...LEVELS.flatMap((l) => [`temperature_${l}hPa`, `geopotential_height_${l}hPa`]),
  'temperature_2m',
  'pressure_msl',
  'surface_pressure',
  'cloud_cover_low',
];

/** The grid nodes' own data, straight from GET /api/weather/grid (the days fetchRouteWeather asks for). */
async function nodeData(
  get: (p: string) => Promise<unknown>,
  model: WindModel,
  date: string,
  keys: string[],
): Promise<Record<string, OpenMeteoLocation>> {
  const to = isoDay(Date.parse(date + 'T00:00:00Z') + 86400000);
  const q = new URLSearchParams({ kind: 'wind', model, from: date, to, locs: keys.join(';') });
  const r = (await get(`weather/grid?${q}`)) as WeatherGridResponse;
  for (const k of keys) expect(r.locations[k], k).toBeTruthy();
  return r.locations as Record<string, OpenMeteoLocation>;
}

/**
 * A point's data is the bilinear blend of its corners' data: u/v at every level and hour, and every
 * other value (temperatures, geopotential heights, pressures, cloud cover) on its own. Checks every
 * hour; returns how many values were compared.
 */
function expectBlend(at: OpenMeteoLocation, corners: { loc: OpenMeteoLocation; w: number }[]): number {
  let n = 0;
  const hours = at.hourly.time.length;
  for (const c of corners) expect(c.loc.hourly.time).toEqual(at.hourly.time);
  for (let i = 0; i < hours; i++) {
    for (const level of WIND_LEVELS) {
      const cs = corners.map((c) => uvAt(c.loc, level, i));
      const got = uvAt(at, level, i);
      if (cs.some((x) => !x)) continue;
      expect(got, `${level} ${i}`).toBeTruthy();
      const u = cs.reduce((a, x, k) => a + x!.u * corners[k].w, 0),
        v = cs.reduce((a, x, k) => a + x!.v * corners[k].w, 0);
      expect(got!.u).toBeCloseTo(u, 9);
      expect(got!.v).toBeCloseTo(v, 9);
      // never outside the corners' own values (so never far from the nearest node's)
      expect(got!.u).toBeGreaterThanOrEqual(Math.min(...cs.map((x) => x!.u)) - 1e-9);
      expect(got!.u).toBeLessThanOrEqual(Math.max(...cs.map((x) => x!.u)) + 1e-9);
      expect(got!.v).toBeGreaterThanOrEqual(Math.min(...cs.map((x) => x!.v)) - 1e-9);
      expect(got!.v).toBeLessThanOrEqual(Math.max(...cs.map((x) => x!.v)) + 1e-9);
      n++;
    }
    for (const k of SCALARS) {
      const cs = corners.map((c) => series(c.loc, k)?.[i]);
      if (cs.some((x) => x == null)) continue;
      expect(series(at, k)[i]).toBeCloseTo(
        cs.reduce((a: number, x, j) => a + x! * corners[j].w, 0),
        9,
      );
      n++;
    }
  }
  return n;
}

describe('the server proxy: same aerodrome data and hazards as the browser calling Open-Meteo; winds interpolated', () => {
  const om = fakeOpenMeteo();
  const omIcon = fakeOpenMeteo({ step: 0.0625 });
  let api: Awaited<ReturnType<typeof gridApi>>;
  let apiIcon: Awaited<ReturnType<typeof gridApi>>;
  beforeAll(async () => {
    api = await gridApi({ fetch: om.fetch, now: () => NOW });
    apiIcon = await gridApi({ fetch: omIcon.fetch, now: () => NOW }, api.db);
  });
  afterAll(async () => {
    await api.close();
  });
  const found = { hazards: 0, legHazards: 0 };

  for (const c of [...CASES, ICON]) {
    test(c.name, async () => {
      const o = c === ICON ? omIcon : om;
      const get = c === ICON ? apiIcon.get : api.get;
      const { wxReq, hzReq } = inputs(c);
      before.clearBefore();
      clearCache();
      const w0 = await before.fetchRouteWeather({ ...wxReq, fetch: o.fetch });
      const h0 = await before.fetchHazardWeather({ ...hzReq, fetch: o.fetch });
      const w1 = await fetchRouteWeather({ ...wxReq, get });
      const h1 = await fetchHazardWeather({ ...hzReq, get });
      expect(w0.status).toBe('ok');
      expect(h0.status).toBe('ok');
      expect(w1.legs.every(Boolean)).toBe(true);

      // identical: the aerodromes' data (surface conditions, QNH), the source line, the hazard data
      expect({ ...w1, legs: null }).toEqual({ ...w0, legs: null });
      expect(h1).toEqual(h0);
      const a = outcome(c, w0, h0),
        b = outcome(c, w1, h1);
      expect(b.surface).toEqual(a.surface);
      // the hazards from that data, along the same timeline (a navlog's times follow its winds)
      expect(b.hazards).toEqual(hazardsOf(c, h0, b.navlog));

      // winds: each leg's data is the bilinear blend of the grid nodes around its midpoint
      for (const [i, mid] of wxReq.legMidpoints.entries()) {
        const cs = windCorners(mid, c.model);
        const data = await nodeData(get, c.model, c.date, cs.map(nodeKey));
        const leg = w1.legs[i]!;
        expect([leg.latitude, leg.longitude]).toEqual([mid.lat, mid.lon]);
        expect(
          expectBlend(
            leg,
            cs.map((x) => ({ loc: data[nodeKey(x)], w: x.w })),
          ),
        ).toBeGreaterThan(500);
      }
      expect(b.winds).not.toEqual(a.winds);

      // the navlog stays close to the nearest-node one. The fake's neighbouring nodes differ more than
      // real ones (they alternate between two recorded responses, plus up to 3 kt and 40° per node),
      // and the interpolated wind stays within its corners' values, so it can differ from the nearest
      // node's by a few knots; at 92 kt TAS the ground speed moves by no more than the wind does.
      // Measured on these routes (13 legs): wind vector difference ≤ 4.0 kt (mean 1.8), speed ≤ 4 kt,
      // direction ≤ 14° (winds of 5 kt or more), GS ≤ 4 kt (mean 1.2), leg ETE ≤ 4 min (≤ 6 %),
      // flight time ≤ 2 min. Asserted with a little room: 5 kt, 20°, 5 kt, 6 %, 5 %.
      expect(b.navlog.legs).toHaveLength(a.navlog.legs.length);
      b.navlog.legs.forEach((l, i) => {
        const was = a.navlog.legs[i];
        expect(l.windMissing).toBe(false);
        expect([l.altFt, l.tc, l.dist]).toEqual([was.altFt, was.tc, was.dist]);
        expect(Math.abs(l.windKt - was.windKt)).toBeLessThanOrEqual(5);
        // a direction only means something with some wind
        if (Math.min(l.windKt, was.windKt) >= 5)
          expect(Math.abs(dDir(l.windDirDeg, was.windDirDeg))).toBeLessThanOrEqual(20);
        expect(Math.abs(l.gs! - was.gs!)).toBeLessThanOrEqual(5);
        expect(Math.abs(l.ete! - was.ete!)).toBeLessThanOrEqual(Math.max(1, 0.06 * was.ete!));
        const now = toUv(l.windKt, l.windDirDeg),
          then = toUv(was.windKt, was.windDirDeg);
        expect(Math.hypot(now.u - then.u, now.v - then.v)).toBeLessThanOrEqual(5);
      });
      expect(Math.abs(b.navlog.totals.ete - a.navlog.totals.ete)).toBeLessThanOrEqual(
        Math.max(2, 0.05 * a.navlog.totals.ete),
      );
      // not vacuous: winds at every leg, conditions at both ends, hazards checked
      expect(b.winds.flat(2).every((s) => s && isFinite(s.speedKt) && isFinite(s.tempC))).toBe(true);
      expect(a.surface[0].some((s) => s && s.tempC !== null)).toBe(true);
      found.hazards += b.hazards.length;
      found.legHazards += b.hazards.filter((h) => h.scope.type === 'leg').length;
    });
  }

  test('the routes above did meet hazards (leg corridors and aerodromes)', () => {
    expect(found.legHazards).toBeGreaterThan(0);
    expect(found.hazards).toBeGreaterThan(found.legHazards);
  });

  test('the same flights again (another pilot, another browser): no Open-Meteo request', async () => {
    const n = om.calls.length;
    for (const c of CASES) {
      clearCache();
      const { wxReq, hzReq } = inputs(c);
      expect((await fetchRouteWeather({ ...wxReq, get: api.get })).status).toBe('ok');
      expect((await fetchHazardWeather({ ...hzReq, get: api.get })).status).toBe('ok');
    }
    expect(om.calls.length).toBe(n);
    expect(externalCalls).toEqual([]);
  });

  test('wind nodes: the corners of every leg (≤ 4 per leg, fewer where legs share them), each fetched once', async () => {
    const o3 = fakeOpenMeteo();
    const api3 = await gridApi({ fetch: o3.fetch, now: () => NOW }, api.db);
    await api.db.query('DELETE FROM weather_cache');
    // [legs, nodes nearest the midpoints (before), corner nodes (now)]
    const rows: number[][] = [];
    let perFlight = 0;
    for (const c of CASES) {
      const { wxReq, legs } = inputs(c);
      const near = new Set(
        wxReq.legMidpoints.map((m) => nodeKey({ lat: Math.round(m.lat * 4) / 4, lon: Math.round(m.lon * 4) / 4 })),
      );
      const corners = new Set(wxReq.legMidpoints.flatMap((m) => windCorners(m, c.model).map(nodeKey)));
      rows.push([legs.length, near.size, corners.size]);
      perFlight += corners.size;
      clearCache();
      await fetchRouteWeather({ ...wxReq, get: api3.get, departure: null, destination: null, stops: [] });
    }
    expect(rows).toEqual([
      [3, 3, 8], // two legs share a cell edge: 8 nodes, not 12
      [2, 2, 8],
      [3, 3, 12],
      [2, 2, 8],
      [1, 1, 4],
    ]);
    // each node fetched once per day range; flights on the same days share their nodes
    expect(o3.locations()).toBeLessThanOrEqual(perFlight);
    expect(externalCalls).toEqual([]);
  });
});

describe('winds aloft between grid nodes: bilinear, in u/v components', () => {
  const om = fakeOpenMeteo();
  const omIcon = fakeOpenMeteo({ step: 0.0625 });
  let api: Awaited<ReturnType<typeof gridApi>>;
  let apiIcon: Awaited<ReturnType<typeof gridApi>>;
  beforeAll(async () => {
    api = await gridApi({ fetch: om.fetch, now: () => NOW });
    apiIcon = await gridApi({ fetch: omIcon.fetch, now: () => NOW }, api.db);
  });
  afterAll(async () => {
    await api.close();
  });
  const DATE = '2026-11-16';
  const route = (get: typeof api.get, model: WindModel, mid: { lat: number; lon: number }) => {
    clearCache();
    return fetchRouteWeather({
      date: DATE,
      model,
      legMidpoints: [mid],
      departure: null,
      destination: null,
      get,
      now: () => NOW,
    });
  };
  const lastLocs = (a: typeof api) => new URLSearchParams(a.requests[a.requests.length - 1].split('?')[1]).get('locs');

  test('gridCorners: one node on a node, two on a cell edge, four inside a cell; weights add up to 1', () => {
    expect(gridCorners({ lat: 38.25, lon: 23.75 }, 0.25)).toEqual([{ lat: 38.25, lon: 23.75, w: 1 }]);
    const edge = gridCorners({ lat: 38.25, lon: 23.825 }, 0.25);
    expect(edge.map((c) => [c.lat, c.lon])).toEqual([
      [38.25, 23.75],
      [38.25, 24],
    ]);
    expect(edge[0].w).toBeCloseTo(0.7, 12);
    expect(edge[1].w).toBeCloseTo(0.3, 12);
    expect(gridCorners({ lat: 38.125, lon: 23.875 }, 0.25)).toEqual([
      { lat: 38, lon: 23.75, w: 0.25 },
      { lat: 38, lon: 24, w: 0.25 },
      { lat: 38.25, lon: 23.75, w: 0.25 },
      { lat: 38.25, lon: 24, w: 0.25 },
    ]);
    expect(gridCorners({ lat: 38.03125, lon: 23.78125 }, 0.0625)).toEqual([
      { lat: 38, lon: 23.75, w: 0.25 },
      { lat: 38, lon: 23.8125, w: 0.25 },
      { lat: 38.0625, lon: 23.75, w: 0.25 },
      { lat: 38.0625, lon: 23.8125, w: 0.25 },
    ]);
    // the corner nearest the point weighs most
    const cs = gridCorners({ lat: 38.2, lon: 23.8 }, 0.25);
    expect(cs.map((c) => nodeKey(c))).toEqual(['38,23.75', '38,24', '38.25,23.75', '38.25,24']);
    expect(cs.map((c) => +c.w.toFixed(6))).toEqual([0.16, 0.04, 0.64, 0.16]);
    for (const p of [
      { lat: 37.123, lon: 22.987 },
      { lat: 40.999, lon: 26.001 },
      { lat: 35.5, lon: 24.1 },
    ])
      for (const step of [0.25, 0.0625]) {
        const all = gridCorners(p, step);
        expect(all.reduce((a, c) => a + c.w, 0)).toBeCloseTo(1, 12);
        for (const c of all) {
          expect(Math.abs(c.lat - p.lat)).toBeLessThan(step);
          expect(Math.abs(c.lon - p.lon)).toBeLessThan(step);
        }
      }
  });

  test('opposite winds average to calm, not to a wind from in between (u/v, not direction and speed)', () => {
    const z = (l: number) => (1000 - l) * 10 + 100;
    const at = (dir: number, spd: number, temp: number): OpenMeteoLocation => ({
      elevation: 100,
      hourly: {
        time: ['2026-11-16T12:00'],
        ...Object.fromEntries(
          LEVELS.flatMap((l) => [
            [`wind_speed_${l}hPa`, [spd]],
            [`wind_direction_${l}hPa`, [dir]],
            [`temperature_${l}hPa`, [temp]],
            [`geopotential_height_${l}hPa`, [z(l)]],
          ]),
        ),
      },
    });
    const T12 = Date.parse('2026-11-16T12:00Z');
    const p = { lat: 38.125, lon: 23.875 };
    const calm = blendLocations(p, [
      { loc: at(270, 20, 10), w: 0.5 },
      { loc: at(90, 20, 20), w: 0.5 },
    ])!;
    const s = sampleAt(calm.hourly, 3000, T12)!;
    expect(s.speedKt).toBeLessThan(1e-9); // averaging direction and speed would say 180° 20 kt
    expect(s.tempC).toBeCloseTo(15, 12);
    const north = sampleAt(
      blendLocations(p, [
        { loc: at(350, 10, 0), w: 0.5 },
        { loc: at(10, 10, 0), w: 0.5 },
      ])!.hourly,
      3000,
      T12,
    )!;
    expect(Math.abs(dDir(north.dirDeg, 360))).toBeLessThan(1e-9); // not 180°
    expect(north.speedKt).toBeCloseTo(10 * Math.cos((10 * Math.PI) / 180), 9);
    // a node without data: the others' weights scaled up
    const one = blendLocations(p, [
      { loc: at(270, 20, 10), w: 0.75 },
      { loc: null, w: 0.25 },
    ])!;
    expect(one.hourly).toEqual(at(270, 20, 10).hourly);
    expect(blendLocations(p, [{ loc: null, w: 1 }])).toBeNull();
  });

  test('at a grid node: exactly that node’s data, and only that node is asked for', async () => {
    const node = { lat: 38.25, lon: 23.75 };
    const w = await route(api.get, 'ecmwf_ifs025', node);
    expect(lastLocs(api)).toBe('38.25,23.75');
    const data = (await nodeData(api.get, 'ecmwf_ifs025', DATE, ['38.25,23.75']))['38.25,23.75'];
    expect(w.legs[0]!.hourly).toEqual(data.hourly);
    expect(w.legs[0]!.elevation).toBe(data.elevation);
    const day = Date.parse(DATE + 'T00:00:00Z');
    for (const alt of [500, 3500, 7500])
      for (let m = 0; m < 48 * 60; m += 97)
        expect(sampleAt(w.legs[0]!.hourly, alt, day + m * 60000)).toEqual(sampleAt(data.hourly, alt, day + m * 60000));
  });

  test('in the middle of four nodes: the mean of their u/v components (and of every other value)', async () => {
    const keys = ['38,23.75', '38,24', '38.25,23.75', '38.25,24'];
    const w = await route(api.get, 'ecmwf_ifs025', { lat: 38.125, lon: 23.875 });
    expect(lastLocs(api)).toBe(keys.join(';'));
    const data = await nodeData(api.get, 'ecmwf_ifs025', DATE, keys);
    const leg = w.legs[0]!;
    expect(
      expectBlend(
        leg,
        keys.map((k) => ({ loc: data[k], w: 0.25 })),
      ),
    ).toBeGreaterThan(500);
    expect(leg.elevation).toBeCloseTo(
      keys.reduce((a, k) => a + data[k].elevation! / 4, 0),
      9,
    );
    // spelled out for one level and hour: u and v are the plain means
    const i = 14;
    const mean = (f: (x: { u: number; v: number }) => number) =>
      keys.reduce((a, k) => a + f(uvAt(data[k], '850hPa', i)!), 0) / 4;
    expect(uvAt(leg, '850hPa', i)!.u).toBeCloseTo(
      mean((x) => x.u),
      9,
    );
    expect(uvAt(leg, '850hPa', i)!.v).toBeCloseTo(
      mean((x) => x.v),
      9,
    );
  });

  test('on a cell edge: linear between its two nodes, and only those two are asked for', async () => {
    const a = '38.25,23.75',
      b = '38.25,24';
    const data = await nodeData(api.get, 'ecmwf_ifs025', DATE, [a, b]);
    for (const f of [0.1, 0.3, 0.5, 0.8]) {
      const w = await route(api.get, 'ecmwf_ifs025', { lat: 38.25, lon: 23.75 + 0.25 * f });
      expect(lastLocs(api)).toBe(`${a};${b}`);
      expectBlend(w.legs[0]!, [
        { loc: data[a], w: 1 - f },
        { loc: data[b], w: f },
      ]);
    }
  });

  test('ICON-EU: its own 0.0625° grid', async () => {
    const keys = ['38,23.75', '38,23.8125', '38.0625,23.75', '38.0625,23.8125'];
    const w = await route(apiIcon.get, 'icon_seamless', { lat: 38.03125, lon: 23.78125 });
    expect(lastLocs(apiIcon)).toBe(keys.join(';'));
    const data = await nodeData(apiIcon.get, 'icon_seamless', DATE, keys);
    expect(
      expectBlend(
        w.legs[0]!,
        keys.map((k) => ({ loc: data[k], w: 0.25 })),
      ),
    ).toBeGreaterThan(500);
  });

  test('more nodes than one request takes: split into requests of at most 100 locations', async () => {
    // 30 legs in cells apart: 120 nodes, plus two aerodromes
    const mids = Array.from({ length: 30 }, (_, k) => ({
      lat: 35.1 + 0.5 * (k % 6),
      lon: 21.1 + 0.5 * Math.floor(k / 6),
    }));
    clearCache();
    const n = api.requests.length;
    const w = await fetchRouteWeather({
      date: DATE,
      model: 'ecmwf_ifs025',
      legMidpoints: mids,
      departure: { lat: 37.936, lon: 23.945 },
      destination: { lat: 35.34, lon: 25.18 },
      get: api.get,
      now: () => NOW,
    });
    expect(w.legs.every(Boolean)).toBe(true);
    const sizes = api.requests.slice(n).map((r) => new URLSearchParams(r.split('?')[1]).get('locs')!.split(';').length);
    expect(sizes).toEqual([100, 22]);
    expect(externalCalls).toEqual([]);
  });
});
