// Open-Meteo sampler (src/data/weather.ts) against a recorded response:
// tests/fixtures/weather/open-meteo-ecmwf-2026-11-15.json = ECMWF IFS 0.25°, 2026-11-15…16, two
// points (38.1089,23.7838 → grid 38.00,23.75 and 37.9364,23.9445 → grid 38.00,24.00).
// Expected values are read off the fixture by hand (or computed by hand from it, noted inline).
import { beforeEach, describe, expect, test } from 'vitest';
import fixture from '../../fixtures/weather/open-meteo-ecmwf-2026-11-15.json';
import {
  buildUrl, chooseSurface, clearCache, describeSource, fetchRouteWeather, forecastAvailability, sampleAt, sampleSurface,
  surfaceConditions, surfaceFromMetar, toPerfWind, windProviderFromLegs, fmtWind, fmtTempDew, fmtQnh,
  type Hourly, type OpenMeteoLocation,
} from '../../../src/data/weather';
import { parseMetar } from '../../../src/data/weatherMetar';
import { pressureAltitudeFt, qnhFromStationPressure } from '../../../src/calc';

const locs = fixture as unknown as OpenMeteoLocation[];
const h0 = locs[0].hourly as Hourly;
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `expected ${b}±${tol}, got ${a}`).toBeLessThanOrEqual(tol);
const T = (s: string) => Date.parse(s);
const M_TO_FT = 1 / 0.3048;
const NOW = T('2026-11-15T13:36:00Z');

beforeEach(() => clearCache());

describe('winds aloft', () => {
  test('exactly on a level and an hour gives the level values', () => {
    // 08:00, 850 hPa at 1575 m: 225° 2.8 kt, 8.6 °C
    const s = sampleAt(h0, 1575 * M_TO_FT, T('2026-11-15T08:00Z'))!;
    near(s.dirDeg, 225, 1e-6); near(s.speedKt, 2.8, 1e-6); near(s.tempC, 8.6, 1e-9);
  });

  test('half-way between two levels interpolates u/v and temperature', () => {
    // 08:00: 925 hPa 870 m 016°/5.6 kt 12.0 °C, 850 hPa 1575 m 225°/2.8 kt 8.6 °C; altitude 1222.5 m.
    // By hand: u/v mean → 352.69° 1.7155 kt; temperature 10.3 °C.
    const s = sampleAt(h0, 1222.5 * M_TO_FT, T('2026-11-15T08:00Z'))!;
    near(s.dirDeg, 352.69, 0.01); near(s.speedKt, 1.7155, 1e-3); near(s.tempC, 10.3, 1e-9);
  });

  test('half-way between two hours interpolates in time; above the top level uses the top level', () => {
    // 600 hPa (4381 m) 08:00 275°/26.6, 09:00 274°/27.4; 08:30 at 20000 ft. By hand: 274.49° 26.999 kt.
    const s = sampleAt(h0, 20000, T('2026-11-15T08:30Z'))!;
    near(s.dirDeg, 274.49, 0.01); near(s.speedKt, 26.999, 1e-3); near(s.tempC, -5.2, 1e-9);
  });

  test('below the lowest level uses the lowest level (ECMWF has no 975/950 hPa: nulls are skipped)', () => {
    expect(h0['wind_speed_975hPa'][8]).toBeNull();
    const s = sampleAt(h0, 0, T('2026-11-15T08:00Z'))!; // 1000 hPa at 213 m: 036°/6.7 kt 16.0 °C
    near(s.dirDeg, 36, 1e-6); near(s.speedKt, 6.7, 1e-6); near(s.tempC, 16, 1e-9);
  });

  test('times outside the data (more than an hour) give null; NaN inputs give null', () => {
    expect(sampleAt(h0, 3000, T('2026-11-17T00:00Z'))).not.toBeNull(); // last hour 16th 23:00 + 1 h
    expect(sampleAt(h0, 3000, T('2026-11-17T00:01Z'))).toBeNull();
    expect(sampleAt(h0, 3000, T('2026-11-14T22:59Z'))).toBeNull();
    expect(sampleAt(h0, NaN, T('2026-11-15T08:00Z'))).toBeNull();
    expect(sampleAt(h0, 3000, NaN)).toBeNull();
    expect(sampleAt({ time: [] } as unknown as Hourly, 3000, T('2026-11-15T08:00Z'))).toBeNull();
  });

  test('windProviderFromLegs reads each leg its own location', () => {
    const wp = windProviderFromLegs([locs[1], null, locs[0]]);
    const q = { lat: 0, lon: 0, altFt: 1575 * M_TO_FT, timeMs: T('2026-11-15T08:00Z') };
    near(wp({ ...q, legIndex: 0 })!.dirDeg, 236, 1e-6); // point 2: 850 hPa 236°/1.8
    expect(wp({ ...q, legIndex: 1 })).toBeNull();
    near(wp({ ...q, legIndex: 2 })!.dirDeg, 225, 1e-6);
  });
});

describe('surface', () => {
  test('sampleSurface interpolates in time', () => {
    // 08:00 → 09:00: MSL 1025.1 → 1025.2, 2 m 16.5 → 17.9 °C, dew 12.3, 10 m wind 049°/3.9 → 049°/3.6
    const s = sampleSurface(h0, T('2026-11-15T08:30Z'))!;
    near(s.qnh, 1025.15, 1e-9); near(s.temp, 17.2, 1e-9); near(s.dew, 12.3, 1e-9);
    near(s.wind!.dir, 49, 1e-6); near(s.wind!.spd, 3.75, 1e-9);
    expect([fmtWind(s), fmtTempDew(s), fmtQnh(s)]).toEqual(['05004KT', '17/12', '1025']);
  });

  test('surfaceConditions: true wind, QNH from MSL pressure, label with the valid time', () => {
    const c = surfaceConditions(locs[1], T('2026-11-15T08:00Z'), 'ECMWF IFS 0.25°')!;
    expect(c).toMatchObject({ source: 'forecast', tempC: 17, dewC: 13.4, qnhHpa: 1025.5, label: 'ECMWF IFS 0.25° forecast for 08:00Z' });
    near(c.wind!.dirTrueDeg!, 16, 1e-6); near(c.wind!.speedKt, 11.1, 1e-6);
    expect(toPerfWind(c)).toEqual({ dirTrueDeg: c.wind!.dirTrueDeg, speedKt: c.wind!.speedKt, gustKt: null });
    expect(surfaceConditions(null, T('2026-11-15T08:00Z'))).toBeNull();
  });

  test('forecast QNH from surface_pressure reduced through the ISA, not the model MSL pressure', () => {
    // Elevated grid point (LGKZ-like, 660 m) on a cold day: station pressure 940 hPa. Independent
    // ISA reduction (hypsometric form QNH = p·(1 + p0^n·L/T0 · h / p^n)^(1/n), n = 0.190263,
    // L = 0.0065 K/m, T0 = 288.15 K): 1017.05 hPa. The model's MSLP (reduced with the actual cold
    // column) is a few hPa higher; using it would make the pressure altitude too low.
    const hours = ['2026-01-10T08:00', '2026-01-10T09:00'];
    const hourly = { time: hours, pressure_msl: [1023, 1023], surface_pressure: [940, 940], temperature_2m: [-10, -10], dew_point_2m: [-12, -12], wind_speed_10m: [0, 0], wind_direction_10m: [0, 0] } as unknown as Hourly;
    const loc: OpenMeteoLocation = { hourly, latitude: 40.45, longitude: 21.28, elevation: 660 };
    const s = sampleSurface(hourly, T('2026-01-10T08:30Z'), 660)!;
    near(s.qnh, 1017.05, 0.05);
    near(s.mslp, 1023, 1e-9);
    near(s.psfc, 940, 1e-9);
    const c = surfaceConditions(loc, T('2026-01-10T08:30Z'))!;
    near(c.qnhHpa!, 1017.05, 0.05);
    // Pressure altitude at the grid elevation from that QNH = the station pressure's own PA.
    near(pressureAltitudeFt(660 * M_TO_FT, c.qnhHpa!), 145366.45 * (1 - Math.pow(940 / 1013.25, 0.190284)), 1e-6);
    // Without the elevation (or without surface_pressure) the MSL pressure is used as before.
    near(sampleSurface(hourly, T('2026-01-10T08:30Z'))!.qnh, 1023, 1e-9);
    // At sea level the station pressure is the QNH.
    near(qnhFromStationPressure(1009.3, 0), 1009.3, 1e-9);
  });

  test('chooseSurface: current METAR near the time wins (gaps filled from the forecast); else the forecast', () => {
    const metar = parseMetar('METAR LGAV 151320Z 05009KT 010V070 9999 FEW025 SCT050 17/12 Q1024 NOSIG', NOW);
    const fc = surfaceConditions(locs[1], T('2026-11-15T14:00Z'), 'ECMWF IFS 0.25°');
    const now = T('2026-11-15T13:36Z');
    const a = chooseSurface({ metar, forecast: fc, timeMs: T('2026-11-15T14:00Z'), nowMs: now })!;
    expect(a).toMatchObject({ source: 'metar', label: 'METAR LGAV 151320Z', tempC: 17, dewC: 12, qnhHpa: 1024, wind: { dirTrueDeg: 50, speedKt: 9, gustKt: null } });
    // flight 3 h later: forecast
    expect(chooseSurface({ metar, forecast: fc, timeMs: T('2026-11-15T16:30Z'), nowMs: now })!.source).toBe('forecast');
    // METAR 2 h old: forecast
    expect(chooseSurface({ metar, forecast: fc, timeMs: T('2026-11-15T14:00Z'), nowMs: T('2026-11-15T15:30Z') })!.source).toBe('forecast');
    // no forecast: METAR only when current, else null
    expect(chooseSurface({ metar, forecast: null, timeMs: T('2026-11-15T20:00Z'), nowMs: now })).toBeNull();
    // missing METAR temperature/QNH are filled from the forecast
    const bare = parseMetar('METAR LGAV 151320Z 05009KT 9999 NSC', NOW);
    const b = chooseSurface({ metar: bare, forecast: fc, timeMs: T('2026-11-15T13:30Z'), nowMs: now })!;
    expect(b.source).toBe('metar'); expect(b.tempC).toBe(fc!.tempC); expect(b.qnhHpa).toBe(fc!.qnhHpa);
  });

  test('surfaceFromMetar: VRB and calm have no direction; perf wind keeps VRB speed and gusts', () => {
    const vrb = surfaceFromMetar(parseMetar('METAR LGTG 151320Z VRB03KT CAVOK 12/05 Q1020', NOW))!;
    expect(vrb.wind).toEqual({ dirTrueDeg: null, speedKt: 3, gustKt: null });
    // VRB: no direction, the speed is kept (the performance check treats it as full crosswind)
    expect(toPerfWind(vrb)).toEqual({ dirTrueDeg: null, speedKt: 3, gustKt: null });
    expect(toPerfWind(surfaceFromMetar(parseMetar('METAR LGTG 151320Z VRB15G25KT 9999 12/05 Q1020', NOW)))).toEqual({ dirTrueDeg: null, speedKt: 15, gustKt: 25 });
    const calm = surfaceFromMetar(parseMetar('METAR LGTG 151320Z 00000KT CAVOK 12/05 Q1020', NOW))!;
    expect(calm.wind).toEqual({ dirTrueDeg: null, speedKt: 0, gustKt: null });
    expect(toPerfWind(calm)).toEqual({ dirTrueDeg: null, speedKt: 0, gustKt: null });
    expect(toPerfWind(null)).toBeNull();
    expect(surfaceFromMetar(parseMetar('METAR LGSO 151320Z NIL', NOW))).toBeNull();
    const g = surfaceFromMetar(parseMetar('METAR LGAV 151320Z 27015G27KT 9999 FEW030 14/08 Q1009', NOW))!;
    expect(toPerfWind(g)).toEqual({ dirTrueDeg: 270, speedKt: 15, gustKt: 27 });
  });
});

describe('availability and fetching', () => {
  test('forecastAvailability by model horizon and the forecast endpoint’s 92 past days', () => {
    expect(forecastAvailability('2026-11-30', 'ecmwf_ifs025', NOW)).toMatchObject({ kind: 'forecast', endpoint: 'forecast' });
    expect(forecastAvailability('2026-12-01', 'ecmwf_ifs025', NOW)).toEqual({ kind: 'too-far', availableFrom: '2026-11-16', lastDate: '2026-11-30' });
    expect(forecastAvailability('2026-12-01', 'gfs_seamless', NOW).kind).toBe('forecast');
    expect(forecastAvailability('2026-11-23', 'icon_seamless', NOW).kind).toBe('too-far');
    expect(forecastAvailability('2026-08-15', 'ecmwf_ifs025', NOW).kind).toBe('forecast');
    expect(forecastAvailability('2026-08-01', 'ecmwf_ifs025', NOW)).toMatchObject({ kind: 'historical', endpoint: 'historical' });
    expect(forecastAvailability('', 'ecmwf_ifs025', NOW).kind).toBe('invalid');
  });

  test('buildUrl lists every point and every level', () => {
    const u = new URL(buildUrl([{ lat: 38.1089, lon: 23.7838 }, { lat: 37.9364, lon: 23.9445 }], '2026-11-15', '2026-11-16', 'gfs_seamless'));
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(u.searchParams.get('latitude')).toBe('38.1089,37.9364');
    expect(u.searchParams.get('longitude')).toBe('23.7838,23.9445');
    expect(u.searchParams.get('models')).toBe('gfs_seamless');
    expect(u.searchParams.get('wind_speed_unit')).toBe('kn');
    expect(u.searchParams.get('hourly')!.split(',')).toHaveLength(9 * 4 + 9);
    expect(u.searchParams.get('hourly')!.split(',')).toContain('surface_pressure');
    expect(buildUrl([{ lat: 1, lon: 2 }], '2026-01-01', '2026-01-01', 'ecmwf_ifs025', 'historical')).toMatch(/^https:\/\/historical-forecast-api\.open-meteo\.com\/v1\/forecast\?/);
  });

  const meta = { last_run_initialisation_time: 1794722400, last_run_availability_time: 1794747938 };
  function fakeFetch(handler: (url: string) => { status: number; body: unknown }) {
    const calls: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const r = handler(url);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return { f, calls };
  }

  test('fetchRouteWeather: one request (midpoints, then departure), source recorded, cached', async () => {
    const { f, calls } = fakeFetch((url) => (url.includes('/static/meta.json') ? { status: 200, body: meta } : { status: 200, body: fixture }));
    const req = { date: '2026-11-15', model: 'ecmwf_ifs025' as const, legMidpoints: [{ lat: 38.1089, lon: 23.7838 }], departure: { lat: 37.9364, lon: 23.9445 }, destination: null, fetch: f, now: () => NOW };
    const rw = await fetchRouteWeather(req);
    expect(rw.status).toBe('ok');
    expect(rw.legs[0]!.latitude).toBe(38); expect(rw.legs[0]!.longitude).toBe(23.75);
    expect(rw.departure!.longitude).toBe(24); expect(rw.destination).toBeNull();
    expect(rw.source).toMatchObject({ provider: 'Open-Meteo', model: 'ecmwf_ifs025', endpoint: 'forecast', fetchedMs: NOW, coverFromMs: T('2026-11-15T00:00Z'), coverToMs: T('2026-11-16T23:00Z'), run: { runMs: 1794722400000, availableMs: 1794747938000 } });
    expect(rw.message).toBe('ECMWF IFS 0.25°, run 15 Nov 06Z, fetched 13:36Z');
    expect(describeSource(rw.source!)).toBe(rw.message);
    const om = calls.filter((c) => c.includes('/v1/forecast'));
    expect(om).toHaveLength(1);
    expect(new URL(om[0]).searchParams.get('latitude')).toBe('38.1089,37.9364');
    expect(new URL(om[0]).searchParams.get('end_date')).toBe('2026-11-16');
    await fetchRouteWeather(req);
    expect(calls.filter((c) => c.includes('/v1/forecast'))).toHaveLength(1); // cached
    await fetchRouteWeather({ ...req, force: true });
    expect(calls.filter((c) => c.includes('/v1/forecast'))).toHaveLength(2);
  });

  test('fetchRouteWeather: falls back to one day at the edge of the range; reports errors without throwing', async () => {
    const reason = "Parameter 'end_date' is out of allowed range from 2026-08-14 to 2026-11-30";
    const { f, calls } = fakeFetch((url) =>
      url.includes('/static/') ? { status: 404, body: {} } : url.includes('end_date=2026-11-16') ? { status: 400, body: { error: true, reason } } : { status: 200, body: fixture });
    const rw = await fetchRouteWeather({ date: '2026-11-15', model: 'ecmwf_ifs025', legMidpoints: [{ lat: 38, lon: 23 }, { lat: 38, lon: 24 }], departure: null, destination: null, fetch: f, now: () => NOW });
    expect(rw.status).toBe('ok');
    expect(rw.source!.run).toBeNull();
    expect(rw.message).toBe('ECMWF IFS 0.25°, fetched 13:36Z');
    expect(calls.filter((c) => c.includes('/v1/forecast')).map((c) => new URL(c).searchParams.get('end_date'))).toEqual(['2026-11-16', '2026-11-15']);

    clearCache();
    const bad = fakeFetch(() => ({ status: 400, body: { error: true, reason } }));
    const e = await fetchRouteWeather({ date: '2026-11-15', model: 'ecmwf_ifs025', legMidpoints: [{ lat: 38, lon: 23 }], departure: null, destination: null, fetch: bad.f, now: () => NOW });
    expect(e).toMatchObject({ status: 'error', legs: [null], source: null });
    expect(e.message).toContain('out of allowed range');

    const net = await fetchRouteWeather({ date: '2026-11-15', model: 'ecmwf_ifs025', legMidpoints: [{ lat: 38, lon: 23 }], departure: null, destination: null, fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch, now: () => NOW });
    expect(net.status).toBe('error');
  });

  test('fetchRouteWeather: beyond the model horizon does not fetch', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: fixture }));
    const rw = await fetchRouteWeather({ date: '2026-12-20', model: 'ecmwf_ifs025', legMidpoints: [{ lat: 38, lon: 23 }], departure: null, destination: null, fetch: f, now: () => NOW });
    expect(rw.status).toBe('unavailable');
    expect(rw.message).toBe('ECMWF IFS 0.25° forecast reaches 2026-11-30; winds for 2026-12-20 from 2026-12-05');
    expect(calls).toHaveLength(0);
  });

  test('fetchRouteWeather: old dates use the historical-forecast API and no model run', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: fixture }));
    const rw = await fetchRouteWeather({ date: '2026-03-10', model: 'ecmwf_ifs025', legMidpoints: [{ lat: 38, lon: 23 }], departure: null, destination: null, fetch: f, now: () => NOW });
    expect(rw.source).toMatchObject({ endpoint: 'historical', run: null });
    expect(rw.message).toBe('ECMWF IFS 0.25°, archived forecast, fetched 13:36Z');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^https:\/\/historical-forecast-api/);
  });
});
