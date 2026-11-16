// Equivalence of the forecast path before and after the server proxy, on recorded ECMWF data
// (tests/helpers/openMeteoGrid.ts: a fake Open-Meteo whose every 0.25° node carries a recorded
// response, answering each location with its nearest grid node, as Open-Meteo does):
//   before: the browser asked Open-Meteo for the exact leg midpoints and 0.25° hazard cells
//           (tests/unit/data/legacy/weatherBefore.ts, a frozen copy of the old code);
//   after:  the browser asks GET /api/weather/grid for the grid nodes (and aerodromes), the server
//           fetches them in batches, caches them per model run in PGlite and answers.
// For several routes the winds and temperatures at every leg (many altitudes and times), the
// navlog computed from them, the surface conditions at the departure/stops/destination and every
// weather hazard must be identical. Also: the second pass costs no Open-Meteo request at all.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import cards from '../../../data/aircraft/compass-cards.json';
import { buildLegs, computeNavlog, defaultAltitudes, type NavlogInput } from '../../../src/calc';
import { computeRouteHazards, fetchHazardWeather, type HazardWeather } from '../../../src/data/hazardWeather';
import { aerodrome, REF, vfrPoint } from '../../../src/data/ref';
import { flightWeatherPlan } from '../../../src/data/useFlightWeather';
import {
  clearCache,
  fetchRouteWeather,
  type RouteWeather,
  sampleAt,
  surfaceConditions,
  windProviderFromLegs,
} from '../../../src/data/weather';
import type { RoutePoint, WindModel } from '../../../src/shared';
import type { CompassCard } from '../../../src/shared';
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

/** A leg's data without its surface fields. */
const aloft = (l: RouteWeather['legs'][number]) =>
  l && {
    latitude: l.latitude,
    longitude: l.longitude,
    hourly: Object.fromEntries(Object.entries(l.hourly).filter(([k]) => k === 'time' || /hPa$/.test(k))),
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

/** Everything a flight computes from the forecast. */
function outcome(c: Case, w: RouteWeather, hw: HazardWeather) {
  const { legs, plan, navIn } = inputs(c);
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
  const elevFt = (a: typeof plan.departure) => (a ? (a.elevFt ?? 0) : 0);
  const hazards = computeRouteHazards({
    hw,
    navlog,
    dayMs: day,
    nowMs: NOW,
    departure: plan.departure ? { elevFt: elevFt(plan.departure), reports: null } : null,
    destination: plan.destination ? { elevFt: elevFt(plan.destination), reports: null } : null,
  });
  return { winds, surface, navlog, hazards };
}

describe('the server proxy gives the same forecast as the browser calling Open-Meteo', () => {
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
      const { wxReq, hzReq, legs } = inputs(c);
      before.clearBefore();
      clearCache();
      const w0 = await before.fetchRouteWeather({ ...wxReq, fetch: o.fetch });
      const h0 = await before.fetchHazardWeather({ ...hzReq, fetch: o.fetch });
      const w1 = await fetchRouteWeather({ ...wxReq, get });
      const h1 = await fetchHazardWeather({ ...hzReq, get });
      expect(w0.status).toBe('ok');
      expect(h0.status).toBe('ok');
      expect(w1.legs.every(Boolean)).toBe(true);

      // the data itself: every leg's winds/temperatures aloft (its surface fields are not used: they
      // are the node's own now, the midpoint's terrain before), the aerodromes', the source line
      expect(w1.legs.map(aloft)).toEqual(w0.legs.map(aloft));
      expect({ ...w1, legs: null }).toEqual({ ...w0, legs: null });
      expect(h1).toEqual(h0);
      // and what is computed from it
      const a = outcome(c, w0, h0),
        b = outcome(c, w1, h1);
      expect(b.winds).toEqual(a.winds);
      expect(b.surface).toEqual(a.surface);
      expect(b.navlog).toEqual(a.navlog);
      expect(b.hazards).toEqual(a.hazards);
      // not vacuous: winds at every leg, conditions at both ends, hazards checked
      expect(a.winds.flat(2).every((s) => s && isFinite(s.speedKt) && isFinite(s.tempC))).toBe(true);
      expect(a.surface[0].some((s) => s && s.tempC !== null)).toBe(true);
      expect(a.navlog.legs).toHaveLength(legs.length);
      expect(a.navlog.legs.every((l) => !l.windMissing)).toBe(true);
      found.hazards += a.hazards.length;
      found.legHazards += a.hazards.filter((h) => h.scope.type === 'leg').length;
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
  });

  test('fewer Open-Meteo locations than before: each node once, shared by legs and flights', async () => {
    const o2 = fakeOpenMeteo(),
      o3 = fakeOpenMeteo();
    const api2 = await gridApi({ fetch: o3.fetch, now: () => NOW }, api.db);
    await api.db.query('DELETE FROM weather_cache');
    for (const c of CASES) {
      before.clearBefore();
      clearCache();
      const { wxReq, hzReq } = inputs(c);
      await before.fetchRouteWeather({ ...wxReq, fetch: o2.fetch });
      await before.fetchHazardWeather({ ...hzReq, fetch: o2.fetch });
      await fetchRouteWeather({ ...wxReq, get: api2.get });
      await fetchHazardWeather({ ...hzReq, get: api2.get });
    }
    expect(o3.locations()).toBeLessThanOrEqual(o2.locations());
    expect(externalCalls).toEqual([]);
  });
});
