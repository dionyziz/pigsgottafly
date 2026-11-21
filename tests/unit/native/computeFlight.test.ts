// PGF.weatherRequests and PGF.computeFlight against the website: the paths are the ones the website's
// weather loaders request, and the flight's navlog, fuel and W&B are the numbers of the exports'
// computeExportCalc (which computes them as the editor does) for the same weather answers.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildLegs } from '../../../src/calc';
import { fetchHazardWeather } from '../../../src/data/hazardWeather';
import { REF, runwaysOf, SUN_TABLES } from '../../../src/data/ref';
import { flightWeatherPlan } from '../../../src/data/useFlightWeather';
import { clearCache, fetchRouteWeather } from '../../../src/data/weather';
import { formQuery } from '../../../src/data/weatherGrid';
import { decodeMetarTafResponse } from '../../../src/data/weatherMetar';
import { computeExportCalc } from '../../../src/features/exports/wb/exportCalc';
import { computeFlight, weatherRequests } from '../../../src/native/core';
import { legKey } from '../../../src/shared';
import { fakeOpenMeteo, gridApi } from '../../helpers/openMeteoGrid';
import { AC, ad, API_REF, flight, METAR_ANSWER, NOW, PILOT, ROUTE, vfr } from './fixtures';

let api: Awaited<ReturnType<typeof gridApi>>;
beforeAll(async () => {
  api = await gridApi({ fetch: fakeOpenMeteo().fetch, now: () => NOW });
});
afterAll(() => api.close());

/** Fetch what the core asks for, the way the app does (the grid through the real route). */
async function answersFor(paths: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const p of paths) {
    expect(p.startsWith('/api/')).toBe(true);
    const rel = p.slice('/api/'.length);
    out[p] = rel.startsWith('weather/metar') ? METAR_ANSWER : await api.get(rel);
  }
  return out;
}

const ref = {
  aerodromes: REF.aerodromes,
  vfrPoints: REF.vfrPoints,
  vfrRoutes: REF.vfrRoutes,
  sunTables: SUN_TABLES,
  runwaysOf,
};

describe('weatherRequests', () => {
  test('the winds, METAR/TAF and hazard paths the website requests for the flight', async () => {
    const f = flight(ROUTE());
    const paths = weatherRequests({ flight: f, ref: API_REF, now: NOW });
    const wind = paths.filter((p) => p.includes('kind=wind'));
    const hazard = paths.filter((p) => p.includes('kind=hazard'));
    const metar = paths.filter((p) => p.startsWith('/api/weather/metar'));
    expect(wind.length).toBe(1);
    expect(hazard.length).toBeGreaterThanOrEqual(1);
    expect(metar).toEqual(['/api/weather/metar?ids=LGMG,LGTT']);
    expect(wind.length + hazard.length + metar.length).toBe(paths.length);

    // the website's loaders, through a recording server
    clearCache();
    const rec = await gridApi({ fetch: fakeOpenMeteo().fetch, now: () => NOW });
    const legs = buildLegs(f.route, f.date);
    const plan = flightWeatherPlan({
      date: f.date,
      model: f.options.windModel,
      route: f.route,
      options: f.options,
      legs,
    });
    await fetchRouteWeather({
      date: f.date,
      model: f.options.windModel,
      legMidpoints: plan.mids,
      departure: plan.depLoc,
      destination: plan.destLoc,
      stops: plan.stops.map((s) => s.loc),
      get: rec.get,
      now: () => NOW,
    });
    await fetchHazardWeather({
      date: f.date,
      model: f.options.windModel,
      legs: legs.map((l) => ({ from: l.from, to: l.to, distNm: l.distNm })),
      departure: plan.departure,
      destination: plan.destination,
      get: rec.get,
      now: () => NOW,
    });
    expect([...wind, ...hazard]).toEqual(rec.requests.map((r) => '/api/' + r));
    await rec.close();
    clearCache();
  });

  test('a date beyond the forecast: no grid requests, only METAR/TAF', () => {
    const paths = weatherRequests({ flight: flight(ROUTE(), { date: '2027-03-01' }), ref: API_REF, now: NOW });
    expect(paths).toEqual(['/api/weather/metar?ids=LGMG,LGTT']);
  });

  test('query strings as URLSearchParams writes them (JavaScriptCore has no URL API)', () => {
    const q: [string, string][] = [
      ['locs', '38,23.75;p:37.936,23.945'],
      ['x', "a b!'()~*-._é/?&="],
    ];
    expect(formQuery(q)).toBe(new URLSearchParams(q).toString());
  });

  test('a call without ref uses the last one given', () => {
    expect(weatherRequests({ flight: flight(ROUTE()), now: NOW })).toEqual(
      weatherRequests({ flight: flight(ROUTE()), ref: API_REF, now: NOW }),
    );
  });
});

describe('computeFlight', () => {
  const cases = {
    'LGTT → DAPORI → KORINTHOS → LGMG': () => flight(ROUTE()),
    'with a stop at LGMG and back': () => {
      const r = [ad('LGTT'), ad('LGMG'), ad('LGTT')];
      return flight(r, {
        options: {
          ...flight(r).options,
          aerodromeRequests: [{ pointUid: r[1].uid, kind: 'stop', stopMin: 30 }],
        },
      });
    },
    'a typed altitude and wind': () => {
      const r = [ad('LGTT'), vfr('LGAV/DAPORI'), ad('LGMG')];
      return flight(r, { legOverrides: { [legKey(r[0], r[1])]: { altFt: 2500, windDirDeg: 300, windKt: 20 } } });
    },
  };

  for (const [name, make] of Object.entries(cases))
    test(`${name}: the navlog, fuel and W&B of computeExportCalc`, async () => {
      const f = make();
      const answers = await answersFor(weatherRequests({ flight: f, ref: API_REF, now: NOW }));
      const c = computeFlight({ flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather: answers, now: NOW });

      // the website: the same answers through its loaders
      clearCache();
      const legs = buildLegs(f.route, f.date);
      const plan = flightWeatherPlan({
        date: f.date,
        model: f.options.windModel,
        route: f.route,
        options: f.options,
        legs,
      });
      const weather = await fetchRouteWeather({
        date: f.date,
        model: f.options.windModel,
        legMidpoints: plan.mids,
        departure: plan.depLoc,
        destination: plan.destLoc,
        stops: plan.stops.map((s) => s.loc),
        get: api.get,
        now: () => NOW,
      });
      const metar = decodeMetarTafResponse(METAR_ANSWER);
      const web = computeExportCalc({
        doc: f,
        aircraft: AC,
        settings: PILOT.settings,
        weather,
        metar,
        nowMs: NOW,
        ref,
      });
      const webNav = JSON.parse(JSON.stringify(web.computed.navlog));

      expect(c.weather.winds?.status).toBe('ok');
      expect(c.weather.hazards?.status).toBe('ok');
      expect(c.weather.metar?.status).toBe('ok');
      expect(c.navlog!.legs.some((l) => l.windSource === 'forecast')).toBe(true);
      expect(c.wb!.takeoff.massKg).toBeGreaterThan(150 + 80); // the people and the fuel
      expect(c.altitudesFt).toEqual(web.computed.altitudesFt);
      expect(c.navlog!.legs).toEqual(webNav.legs);
      expect(c.navlog!.totals).toEqual(webNav.totals);
      expect(c.navlog!.times).toEqual(webNav.times);
      expect(c.navlog!.flightMin).toBeCloseTo(webNav.flightMin, 9);
      expect(c.fuel).toEqual(JSON.parse(JSON.stringify(web.computed.fuel)));
      expect(c.wb).toEqual(JSON.parse(JSON.stringify(web.wb)));
      // take-off and landing performance at both ends
      expect(c.departure.perf).toEqual(JSON.parse(JSON.stringify(web.departure.perf)));
      expect(c.arrival.perf).toEqual(JSON.parse(JSON.stringify(web.arrival.perf)));
      expect(c.stops.length).toBe(web.stops.length);
      c.stops.forEach((s, k) => {
        expect(s.landing.perf).toEqual(JSON.parse(JSON.stringify(web.stops[k].landing.perf)));
        expect(s.takeoff.perf).toEqual(JSON.parse(JSON.stringify(web.stops[k].takeoff.perf)));
      });
      // the times, the readiness rows of Plan and Brief
      expect(c.times.takeoffMs).toBe(Date.parse(`${f.date}T00:00:00Z`) + webNav.times.takeoffMin * 60000);
      expect(new Set(c.readiness.map((r) => r.stage))).toEqual(new Set(['plan', 'brief']));
    });

  test('warnings and readiness: what the editor shows (no weather fetched, no aircraft)', () => {
    const f = flight(ROUTE(), { aircraftId: null });
    const c = computeFlight({ flight: f, pilot: PILOT, ref: API_REF, weather: {}, now: NOW });
    expect(c.navlog).toBeNull();
    expect(c.warnings.map((w) => w.text)).toContain('No aircraft chosen.');
    expect(c.weather.winds).toMatchObject({ status: 'error', message: 'Winds unavailable: not fetched' });
    const ac = c.readiness.find((r) => r.id === 'aircraft')!;
    expect(ac).toMatchObject({ state: 'todo', text: 'Choose the aircraft.' });
    expect(c.readiness.find((r) => r.id === 'notams')).toMatchObject({ state: 'todo', text: 'Not loaded yet.' });
  });

  test('the ATC list and what tells where each row applies', async () => {
    const f = flight(ROUTE());
    const answers = await answersFor(weatherRequests({ flight: f, ref: API_REF, now: NOW }));
    const c = computeFlight({ flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather: answers, now: NOW });
    expect(c.atc.entries.length).toBeGreaterThan(0);
    expect(c.atc.legs).toHaveLength(c.atc.entries.length);
    const tt = c.atc.entries.findIndex((e) => e.group.startsWith('LGTT'));
    expect(c.atc.legs[tt]).toEqual([0]);
    expect(c.atc.aerodromes[tt]).toMatchObject({ lat: expect.any(Number), lon: expect.any(Number) });
  });

  test('a shared flight is computed with its aircraft and its owner settings', async () => {
    const f = { ...flight(ROUTE()), access: { role: 'view', owner: {}, aircraft: AC, pilot: PILOT } } as never;
    const c = computeFlight({ flight: f, pilot: { ...PILOT, fullName: '' }, ref: API_REF, weather: {}, now: NOW });
    expect(c.navlog!.legs).toHaveLength(3);
    expect(c.readiness.find((r) => r.id === 'profile')).toBeUndefined();
  });
});
