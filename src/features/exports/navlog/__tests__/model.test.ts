// The MD 4.2 sheet model: cells as computeNavlog results formatted like the paper sheet,
// multi-sheet splitting, header weather (forecast vs METAR), terminal information, notes.
import { describe, expect, test } from 'vitest';
import { REF, SUN_TABLES, aerodrome, vfrPoint } from '../../../../data/ref';
import { aircraftFromTypeJson, emptyFlightDoc, legKey, DEFAULT_SETTINGS } from '../../../../shared';
import type { Aircraft, AtcEntry, CompassCard, FlightDoc, RoutePoint } from '../../../../shared';
import type { RouteWeather, OpenMeteoLocation } from '../../../../data/weather';
import { parseMetar, type MetarTafResult } from '../../../../data/weatherMetar';
import { fmtHdg, fmtHmm, fmtSigned } from '../../../../calc';
import { generateAtcList, atcInput } from '../../../../data/atc';
import reims from '../../../../../data/aircraft/reims-f172m.json';
import cards from '../../../../../data/aircraft/compass-cards.json';
import { buildNavlogDocument, computeFlightNavlog, fmtSurfaceWind, LEGS_PER_SHEET, runwayInUse, terminalRows } from '../model';

const ref = { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes, sunTables: SUN_TABLES };
let n = 0;
const ad = (icao: string): RoutePoint => { const a = aerodrome(icao)!; return { uid: `u${n++}`, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon }; };
const vfr = (id: string): RoutePoint => { const p = vfrPoint(id)!; return { uid: `u${n++}`, kind: 'vfr', refId: id, name: p.name, lat: p.lat, lon: p.lon }; };
const custom = (name: string, lat: number, lon: number): RoutePoint => ({ uid: `u${n++}`, kind: 'custom', refId: null, name, lat, lon });

const AC: Aircraft = {
  ...aircraftFromTypeJson(reims),
  id: 'ac1', registration: 'SX-ASV', cruiseTasKt: 92, patternTasKt: 80,
  compassCards: (cards as unknown as Record<string, CompassCard[]>)['SX-ASV'],
  created: 0, updated: 0,
};
AC.fuel = { ...AC.fuel, burnLph: 30, taxiAllowanceL: 4, usableL: 144 };
const SETTINGS = { ...DEFAULT_SETTINGS, taxiOutMin: 15, taxiInMin: 15, reserveMin: 60 };
const DATE = '2026-11-20';

function flight(route: RoutePoint[], extra: Partial<FlightDoc> = {}): FlightDoc {
  return { ...emptyFlightDoc(DATE), blockOff: '09:00', taxiOutMin: 15, taxiInMin: 15, aircraftId: 'ac1', route, ...extra };
}
/** Same wind typed on every leg (no network). */
function windAll(route: RoutePoint[], dir: number, kt: number): FlightDoc['legOverrides'] {
  const o: FlightDoc['legOverrides'] = {};
  for (let i = 0; i + 1 < route.length; i++) o[legKey(route[i], route[i + 1])] = { windDirDeg: dir, windKt: kt, tempC: 10 };
  return o;
}
function build(doc: FlightDoc, o: { weather?: RouteWeather | null; metar?: MetarTafResult | null; nowMs?: number; aircraft?: Aircraft | null } = {}) {
  const aircraft = o.aircraft === undefined ? AC : o.aircraft;
  const computed = computeFlightNavlog({ doc, aircraft, settings: SETTINGS, weather: o.weather ?? null, ref });
  const atc = doc.atc ?? generateAtcList(atcInput(doc.route, computed.altitudesFt, REF, 2));
  const out = buildNavlogDocument({ doc, aircraft, computed, atc, aerodromes: REF.aerodromes, weather: o.weather ?? null, metar: o.metar ?? null, nowMs: o.nowMs ?? Date.parse('2026-11-15T12:00:00Z') });
  return { computed, out, atc };
}

describe('one sheet', () => {
  const route = [ad('LGTT'), vfr('LGAV/DAPORI'), vfr('LGAV/KORINTHOS'), ad('LGMG')];
  const doc = flight(route, { legOverrides: windAll(route, 300, 15) });
  const { computed, out } = build(doc);
  const s = out.sheets[0];

  test('cells are the navlog values as written on the paper sheet', () => {
    expect(out.sheets).toHaveLength(1);
    expect(s.legs.filter(Boolean)).toHaveLength(3);
    computed.navlog.legs.forEach((r, i) => {
      const c = s.legs[i]!;
      expect(c.tc).toBe(fmtHdg(r.tc));
      expect(c.alt).toBe(String(r.altFt));
      expect(c.wd).toBe('300');
      expect(c.ws).toBe('15');
      expect(c.temp).toBe('10');
      expect(c.tas).toBe(String(i === 0 || i === 2 ? 80 : 92));
      expect(c.wca).toBe(fmtSigned(r.wca!));
      expect(c.th).toBe(fmtHdg(r.th!));
      expect(c.var).toBe(fmtSigned(r.var!));
      expect(c.mh).toBe(fmtHdg(r.mh!));
      expect(c.ch).toBe(fmtHdg(r.ch!));
      expect(c.dist).toBe(String(r.dist));
      expect(c.gs).toBe(String(r.gs));
      expect(c.ete).toBe(fmtHmm(r.ete!));
      expect(c.fuel).toBe(String(r.fuel));
      expect(c.windMissing).toBe(false);
    });
    // remaining distance/time after each leg
    expect(s.legs[2]!.rem).toBe('0');
    expect(s.legs[2]!.ate).toBe('0:00');
    expect(s.legs[0]!.rem).toBe(String(computed.navlog.legs[1].dist + computed.navlog.legs[2].dist));
    expect(s.legs.slice(3).every((x) => x === null)).toBe(true);
  });

  test('checkpoints, header and totals', () => {
    expect(s.topLabel).toBe('DEPARTURE');
    expect(s.topName).toBe('LGTT');
    expect(s.checkpoints.slice(0, 3)).toEqual(['DAPORI', 'KORINTHOS', 'LGMG']);
    expect(s.checkpoints.slice(3).every((x) => x === '')).toBe(true);
    expect(s.bottomLabel).toBe('ARRIVAL');
    expect(s.bottomName).toBe('LGMG');
    expect(s.header).toMatchObject({ date: DATE, aircraft: 'SX-ASV', blockStart: '09:00Z', est: 'EST 30lt/h = 0.5lt/min' });
    const t = computed.navlog.totals;
    expect(s.totals).toMatchObject({ dist: String(t.dist), ete: fmtHmm(t.ete), fuel: String(t.tripFuel + 4) });
    expect(s.totals.sunset).toMatch(/^SUNSET \d\d:\d\dZ$/);
  });

  test('notes box left blank; sources on screen; no weather warnings', () => {
    expect(out).not.toHaveProperty('notes');
    expect(out.sources[0]).toBe('Winds aloft: none, calm wind used');
    expect(out.sources).toContain('wind typed on legs 1, 2, 3');
    expect(out.warnings.some((w) => /calm wind|METAR|forecast/i.test(w))).toBe(false);
  });

  test('terminal information: departure, destination, airspace, FIS', () => {
    const fields = out.terminal.map((r) => r.field);
    expect(fields[0]).toBe('LGTT');
    expect(fields).toContain('LGMG');
    expect(fields[fields.length - 1]).toBe('FIS');
    const tt = out.terminal[0];
    expect(tt.elev).toBe(String(aerodrome('LGTT')!.elevFt));
    expect(tt.rwy).toContain(' / ');
    expect(tt.units[0].unit).toBe('TWR');
    expect(tt.units[0].freqs[0]).toMatch(/^\d{3}\.\d+$/);
  });
});

describe('no wind, no aircraft', () => {
  const route = [ad('LGTT'), ad('LGMG')];
  test('wind cells blank and flagged; warnings', () => {
    const { out } = build(flight(route));
    const L = out.sheets[0].legs[0]!;
    expect(L.wd).toBe('');
    expect(L.ws).toBe('');
    expect(L.windMissing).toBe(true);
    expect(out.sources[0]).toMatch(/calm wind/i);
  });
  test('without an aircraft the sheet still renders', () => {
    const { out } = build(flight(route, { aircraftId: null }), { aircraft: null });
    expect(out.sheets[0].header.aircraft).toBe('');
    expect(out.sheets[0].header.est).toBe('EST —lt/h');
    expect(out.sheets[0].totals.fuel).toBe('');
    expect(out.warnings[0]).toMatch(/No aircraft/);
  });
  test('empty route: one blank sheet', () => {
    const { out } = build(flight([]));
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0].legs.every((x) => x === null)).toBe(true);
    expect(out.sheets[0].totals.dist).toBe('');
  });
});

describe('long routes continue on further sheets', () => {
  // 13 legs: LGTT, 12 custom points, LGTT
  const pts = [ad('LGTT')];
  for (let i = 0; i < 12; i++) pts.push(custom(`P${i + 1}`, 38.0 + 0.1 * Math.sin(i), 23.5 + 0.08 * i));
  pts.push(ad('LGTT'));
  const doc = flight(pts, { legOverrides: windAll(pts, 200, 10) });
  const { out, computed } = build(doc);

  test('9 legs per sheet; continuation sheet starts where the previous ended', () => {
    expect(computed.legs).toHaveLength(13);
    expect(out.sheets).toHaveLength(2);
    const [a, b] = out.sheets;
    expect(a.legs.filter(Boolean)).toHaveLength(LEGS_PER_SHEET);
    expect(b.legs.filter(Boolean)).toHaveLength(4);
    expect(a.bottomLabel).toBe('');
    expect(a.bottomName).toBe('P9');
    expect(b.topLabel).toBe('');
    expect(b.topName).toBe('P9');
    expect(b.checkpoints[0]).toBe('P10');
    expect(b.bottomLabel).toBe('ARRIVAL');
    expect(b.bottomName).toBe('LGTT');
    // second sheet first row = leg 10
    expect(b.legs[0]!.tc).toBe(fmtHdg(computed.navlog.legs[9].tc));
    // totals of the whole flight on every sheet
    expect(a.totals).toEqual(b.totals);
    expect(a.index).toBe(0);
    expect(b.count).toBe(2);
  });
});

describe('surface weather in the header', () => {
  const route = [ad('LGAV'), ad('LGKR')];
  const hours = Array.from({ length: 48 }, (_, h) => new Date(Date.parse(DATE + 'T00:00:00Z') + h * 3600000).toISOString().slice(0, 16));
  const loc = (temp: number, dir: number, spd: number, qnh: number): OpenMeteoLocation => ({
    hourly: {
      time: hours,
      pressure_msl: hours.map(() => qnh), temperature_2m: hours.map(() => temp), dew_point_2m: hours.map(() => temp - 7),
      wind_speed_10m: hours.map(() => spd), wind_direction_10m: hours.map(() => dir),
      cloud_cover_low: hours.map(() => 0), cloud_cover_mid: hours.map(() => 0), cloud_cover_high: hours.map(() => 0),
    } as OpenMeteoLocation['hourly'],
  });
  const weather: RouteWeather = {
    status: 'ok', message: 'ECMWF IFS 0.25°, fetched 08:00Z', legs: [null], departure: loc(14, 33, 12, 1018.4), destination: loc(18, 175, 8, 1015),
    source: { provider: 'Open-Meteo', model: 'ecmwf_ifs025', modelLabel: 'ECMWF IFS 0.25°', endpoint: 'forecast', run: null, fetchedMs: 0, coverFromMs: null, coverToMs: null },
  };

  test('forecast at the departure (first sheet), sources listed', () => {
    const { out } = build(flight(route), { weather });
    const h = out.sheets[0].header;
    expect(h.temp).toBe('14/07');
    expect(h.wind).toBe('03012KT');
    expect(h.qnh).toBe('1018');
    expect(h.sky).toBe('SKC');
    // LGAV 03L/R and 21L/R: north-easterly wind → 03L/R
    expect(h.runway).toBe('03L/R');
    expect(out.sources[0]).toBe('Winds aloft ECMWF IFS 0.25°, fetched 08:00Z');
    expect(out.sources[1]).toBe('LGAV forecast 09:00Z');
    expect(out.sources[2]).toMatch(/^LGKR forecast \d\d:\d\dZ$/);
    // leg midpoint had no data: flagged
    expect(out.sheets[0].legs[0]!.windMissing).toBe(true);
  });

  test('a current METAR wins over the forecast', () => {
    const obs = Date.parse(DATE + 'T08:50:00Z');
    const m = parseMetar('METAR LGAV 200850Z 21015G25KT CAVOK 17/09 Q1011', obs);
    const metar: MetarTafResult = { status: 'ok', message: '', source: 'aviationweather.gov', fetchedMs: obs, stations: { LGAV: { metar: m, taf: null, observedMs: obs } } };
    const { out } = build(flight(route), { weather, metar, nowMs: obs + 10 * 60000 });
    const h = out.sheets[0].header;
    expect(h).toMatchObject({ temp: '17/09', wind: '21015G25KT', qnh: '1011', sky: 'CAVOK', runway: '21L/R' });
    expect(out.sources[1]).toMatch(/^METAR LGAV 200850Z/);
    expect(out.sources[2]).toMatch(/^LGKR forecast/);
  });

  test('chosen runway on the flight wins', () => {
    const { out } = build(flight(route, { options: { ...emptyFlightDoc(DATE).options, departureRunway: '21R' } }), { weather });
    expect(out.sheets[0].header.runway).toBe('21R');
  });
});

describe('helpers', () => {
  test('surface wind groups', () => {
    expect(fmtSurfaceWind(null)).toBe('');
    expect(fmtSurfaceWind({ source: 'forecast', label: '', timeMs: 0, tempC: null, dewC: null, qnhHpa: null, wind: { dirTrueDeg: 4, speedKt: 0.4, gustKt: null } })).toBe('00000KT');
    expect(fmtSurfaceWind({ source: 'forecast', label: '', timeMs: 0, tempC: null, dewC: null, qnhHpa: null, wind: { dirTrueDeg: 356, speedKt: 7.6, gustKt: null } })).toBe('36008KT');
    expect(fmtSurfaceWind({ source: 'metar', label: '', timeMs: 0, tempC: null, dewC: null, qnhHpa: null, wind: { dirTrueDeg: null, speedKt: 3, gustKt: null } })).toBe('VRB03KT');
  });
  test('runway in use: calm → first runway', () => {
    expect(runwayInUse(aerodrome('LGTT')!, null, DATE)).toBe(aerodrome('LGTT')!.runways[0].split('/')[0]);
    expect(runwayInUse(null, null, DATE)).toBe('');
  });
  test('terminal rows group an edited ATC list, incl. hand-added rows', () => {
    const e = (group: string, service: string, primary: string, backups: string[], sourceKey: string | null): AtcEntry =>
      ({ id: group + service, role: 'custom', group, callsign: '', service, primary, backups, remark: '', sourceKey });
    const rows = terminalRows([
      e('LGTT DEKELIA / TATOI', 'TWR', '122.650', ['118.500'], 'ad:LGTT:TATOI TOWER'),
      e('LGTT DEKELIA / TATOI', 'GND', '121.700', [], 'ad:LGTT:TATOI GROUND'),
      e('MY NOTES', 'A/A', '123.450', [], null),
      e('LGMG MEGARA', 'A/A', '122.400', [], null),
    ], REF.aerodromes);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ field: 'LGTT', units: [{ unit: 'TWR', freqs: ['122.650', '118.500'] }, { unit: 'GND', freqs: ['121.700'] }] });
    expect(rows[1]).toMatchObject({ field: 'MY NOTES', elev: '', rwy: '', units: [{ unit: 'A/A', freqs: ['123.450'] }] });
    expect(rows[2].field).toBe('LGMG');
  });
  test('terminal rows print the callsign of a hand-added unit', () => {
    const e = (callsign: string, service: string, primary: string, sourceKey: string | null): AtcEntry =>
      ({ id: callsign + service, role: sourceKey ? 'departure' : 'custom', group: sourceKey ? 'LGTT DEKELIA / TATOI' : 'Other', callsign, service, primary, backups: [], remark: '', sourceKey });
    expect(terminalRows([e('SKYROS APPROACH', 'APP', '123.45', null)], REF.aerodromes)[0])
      .toMatchObject({ field: 'Other', units: [{ unit: 'SKYROS APPROACH', freqs: ['123.45'] }] });
    expect(terminalRows([e('SKYROS', 'ATIS', '127.0', null)], REF.aerodromes)[0].units[0].unit).toBe('SKYROS ATIS');
    expect(terminalRows([e('MY RADIO', '', '130.0', null)], REF.aerodromes)[0].units[0].unit).toBe('MY RADIO');
    // Generated rows keep the compact v2 form: the field names the aerodrome.
    expect(terminalRows([e('TATOI TOWER', 'TWR', '122.650', 'ad:LGTT:TATOI TOWER')], REF.aerodromes)[0].units).toEqual([{ unit: 'TWR', freqs: ['122.650'] }]);
  });
});
