// Content validation of the JSON sub-documents of a flight (route, leg overrides, ATC list, baggage,
// options, summary). Everything a client writes is checked for type and range and rebuilt from the
// known fields only, so a stale or buggy client cannot store values that later turn the safety
// numbers (W&B, altitudes, fuel) into NaN or nonsense. Numbers must be JSON numbers: strings,
// booleans and null are not coerced (null / absent means "not set" where a field is optional).
import { DEFAULT_FLIGHT_OPTIONS, EMPTY_SUMMARY, uid, WIND_MODELS } from '../../src/shared/constants.js';
import { FUEL_TYPES } from '../../src/shared/fuel.js';
import { mapLayersOf } from '../../src/shared/mapLayers.js';
import { MAX_STOP_MIN } from '../../src/shared/requests.js';
import type {
  AerodromeRequest,
  AtcEntry,
  AtcRole,
  FlightOptions,
  FlightSummary,
  FuelType,
  LegOverride,
  RoutePoint,
  WbCategory,
  WindModel,
} from '../../src/shared/types.js';
import { badRequest } from './http.js';
import { arr, obj } from './rows.js';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A JSON number in [min, max], or throws. */
function num(v: unknown, field: string, min: number, max: number): number {
  if (!isNum(v) || v < min || v > max) throw badRequest(`${field} must be a number in [${min}, ${max}]`);
  return v;
}
/** null/undefined → null, else num(). */
function optNumber(v: unknown, field: string, min: number, max: number): number | null {
  return v === null || v === undefined ? null : num(v, field, min, max);
}
function text(v: unknown, field: string, max: number): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
  if (v.length > max) throw badRequest(`${field} is too long`);
  return v;
}
function optText(v: unknown, field: string, max: number): string | null {
  return v === null || v === undefined || v === '' ? null : text(v, field, max);
}

// ---------------------------------------------------------------- route

const KINDS = new Set(['aerodrome', 'vfr', 'waypoint', 'custom']);
export const MAX_ROUTE_POINTS = 200;

export function checkRoute(v: unknown): RoutePoint[] {
  const route = arr<RoutePoint>(v, 'route');
  if (route.length > MAX_ROUTE_POINTS) throw badRequest('route has too many points');
  return route.map((p, i) => {
    obj(p, `route[${i}]`);
    if (!KINDS.has(p.kind)) throw badRequest(`route[${i}].kind is invalid`);
    const lat = num(p.lat, `route[${i}].lat`, -90, 90);
    const lon = num(p.lon, `route[${i}].lon`, -180, 180);
    return {
      uid: text(p.uid, `route[${i}].uid`, 40).trim() || uid(),
      kind: p.kind,
      refId: p.refId == null ? null : text(p.refId, `route[${i}].refId`, 100).trim(),
      name: text(p.name, `route[${i}].name`, 60).trim(),
      lat,
      lon,
    };
  });
}

// ---------------------------------------------------------------- leg overrides

/** Plausible limits for a light aircraft's per-leg overrides. */
export const LEG_OVERRIDE_LIMITS: Record<keyof LegOverride, [number, number]> = {
  altFt: [-1500, 60000],
  tasKt: [1, 500],
  windDirDeg: [0, 360],
  windKt: [0, 250],
  tempC: [-90, 60],
};

export function checkLegOverrides(v: unknown): Record<string, LegOverride> {
  const input = obj<Record<string, unknown>>(v, 'legOverrides');
  const keys = Object.keys(input);
  if (keys.length > 4 * MAX_ROUTE_POINTS) throw badRequest('legOverrides has too many legs');
  const out: Record<string, LegOverride> = {};
  for (const key of keys) {
    if (key.length > 100) throw badRequest('legOverrides: leg key is too long');
    const o = obj<Record<string, unknown>>(input[key], `legOverrides[${key}]`);
    const leg: LegOverride = {};
    for (const [f, [min, max]] of Object.entries(LEG_OVERRIDE_LIMITS) as [keyof LegOverride, [number, number]][]) {
      const n = optNumber(o[f], `legOverrides[${key}].${f}`, min, max);
      if (n !== null) leg[f] = n;
    }
    if (Object.keys(leg).length) out[key] = leg;
  }
  return out;
}

// ---------------------------------------------------------------- ATC list

const ATC_ROLES = new Set<AtcRole>(['departure', 'enroute', 'destination', 'airspace', 'fis', 'custom']);

export function checkAtc(v: unknown): AtcEntry[] | null {
  if (v === null) return null;
  const list = arr<unknown>(v, 'atc');
  if (list.length > 200) throw badRequest('atc has too many entries');
  return list.map((e, i) => {
    const r = obj<Record<string, unknown>>(e, `atc[${i}]`);
    const role = r.role as AtcRole;
    if (!ATC_ROLES.has(role)) throw badRequest(`atc[${i}].role is invalid`);
    const backups = r.backups === undefined || r.backups === null ? [] : arr<unknown>(r.backups, `atc[${i}].backups`);
    if (backups.length > 10) throw badRequest(`atc[${i}].backups has too many entries`);
    return {
      id: text(r.id, `atc[${i}].id`, 100) || uid(),
      role,
      group: text(r.group, `atc[${i}].group`, 200),
      callsign: text(r.callsign, `atc[${i}].callsign`, 100),
      service: text(r.service, `atc[${i}].service`, 50),
      primary: text(r.primary, `atc[${i}].primary`, 20),
      backups: backups.map((b, j) => text(b, `atc[${i}].backups[${j}]`, 20)),
      remark: text(r.remark, `atc[${i}].remark`, 500),
      sourceKey: optText(r.sourceKey, `atc[${i}].sourceKey`, 200),
    };
  });
}

// ---------------------------------------------------------------- baggage

export function checkBaggage(v: unknown): Record<string, number> {
  const input = obj<Record<string, unknown>>(v, 'baggageKg');
  const keys = Object.keys(input);
  if (keys.length > 20) throw badRequest('baggageKg has too many stations');
  const out: Record<string, number> = {};
  for (const k of keys) {
    if (k.length > 60) throw badRequest('baggageKg: station id is too long');
    const n = optNumber(input[k], `baggageKg.${k}`, 0, 1000);
    if (n !== null) out[k] = n;
  }
  return out;
}

// ---------------------------------------------------------------- options

const CATEGORIES = new Set<WbCategory>(['normal', 'utility']);

/** The flight's options, merged over `base`; only the known fields, each checked. */
export function checkOptions(v: unknown, base: FlightOptions = DEFAULT_FLIGHT_OPTIONS): FlightOptions {
  const i = obj<Record<string, unknown>>(v, 'options');
  const o: FlightOptions = { ...DEFAULT_FLIGHT_OPTIONS, ...base };
  if ('windModel' in i) {
    if (typeof i.windModel !== 'string' || !Object.hasOwn(WIND_MODELS, i.windModel))
      throw badRequest('options.windModel is unknown');
    o.windModel = i.windModel as WindModel;
  }
  if ('compassCard' in i) o.compassCard = optText(i.compassCard, 'options.compassCard', 100);
  if ('category' in i) {
    if (!CATEGORIES.has(i.category as WbCategory)) throw badRequest('options.category must be normal or utility');
    o.category = i.category as WbCategory;
  }
  if ('alternates' in i) {
    const alts = i.alternates === null ? [] : arr<unknown>(i.alternates, 'options.alternates');
    if (alts.length > 2) throw badRequest('options.alternates: at most two (FPL item 16)');
    // what the editor stores: an aerodrome's ICAO / AIP id, or the text typed (upper-cased)
    o.alternates = alts.map((a, j) => text(a, `options.alternates[${j}]`, 60).trim().toUpperCase()).filter(Boolean);
  }
  if ('remarks' in i) o.remarks = text(i.remarks, 'options.remarks', 1000);
  for (const k of ['departureRunway', 'arrivalRunway'] as const) if (k in i) o[k] = optText(i[k], `options.${k}`, 10);
  for (const k of ['departureSurface', 'arrivalSurface'] as const) if (k in i) o[k] = optText(i[k], `options.${k}`, 60);
  if ('aerodromeRequests' in i) {
    const list = i.aerodromeRequests === null ? [] : arr<unknown>(i.aerodromeRequests, 'options.aerodromeRequests');
    // at most one touch-and-go and one stop per route point
    if (list.length > 2 * MAX_ROUTE_POINTS) throw badRequest('options.aerodromeRequests has too many entries');
    o.aerodromeRequests = list.map((v, j): AerodromeRequest => {
      const r = obj<Record<string, unknown>>(v, `options.aerodromeRequests[${j}]`);
      const pointUid = text(r.pointUid, `options.aerodromeRequests[${j}].pointUid`, 64);
      if (!pointUid) throw badRequest(`options.aerodromeRequests[${j}].pointUid is required`);
      if (r.kind !== 'touch-and-go' && r.kind !== 'stop')
        throw badRequest(`options.aerodromeRequests[${j}].kind must be touch-and-go or stop`);
      const req: AerodromeRequest =
        r.kind === 'stop'
          ? {
              pointUid,
              kind: 'stop',
              stopMin: optNumber(r.stopMin, `options.aerodromeRequests[${j}].stopMin`, 1, MAX_STOP_MIN) ?? 10,
            }
          : { pointUid, kind: 'touch-and-go' };
      // runways and surface chosen for the landing and take-off there (performance)
      for (const k of ['landingRunway', 'takeoffRunway'] as const) {
        const v = optText(r[k], `options.aerodromeRequests[${j}].${k}`, 10);
        if (v) req[k] = v;
      }
      const sf = optText(r.surface, `options.aerodromeRequests[${j}].surface`, 60);
      if (sf) req.surface = sf;
      return req;
    });
  }
  if ('fuelL' in i) {
    if (i.fuelL === null || i.fuelL === undefined) o.fuelL = null;
    else {
      const f = obj<Record<string, unknown>>(i.fuelL, 'options.fuelL');
      const out: Partial<Record<FuelType, number>> = {};
      for (const [k, v] of Object.entries(f)) {
        if (!(FUEL_TYPES as string[]).includes(k)) throw badRequest(`options.fuelL: unknown fuel type ${k}`);
        const n = optNumber(v, `options.fuelL.${k}`, 0, 10000);
        if (n !== null) out[k as FuelType] = n;
      }
      o.fuelL = Object.keys(out).length ? out : null;
    }
  }
  if ('mapLayers' in i) {
    if (i.mapLayers === null || i.mapLayers === undefined) o.mapLayers = null;
    else {
      const l = mapLayersOf(i.mapLayers);
      if (!l) throw badRequest('options.mapLayers must be an object');
      o.mapLayers = l;
    }
  }
  return o;
}

// ---------------------------------------------------------------- summary (lobby row)

export function checkSummary(v: unknown): FlightSummary {
  const i = obj<Record<string, unknown>>(v, 'summary');
  const s: FlightSummary = { ...EMPTY_SUMMARY };
  s.title = text(i.title, 'summary.title', 300);
  const date = text(i.date, 'summary.date', 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('summary.date must be YYYY-MM-DD or empty');
  s.date = date;
  s.blockOff = text(i.blockOff, 'summary.blockOff', 5);
  s.aircraft = text(i.aircraft, 'summary.aircraft', 20);
  const route = i.route === undefined || i.route === null ? [] : arr<unknown>(i.route, 'summary.route');
  if (route.length > MAX_ROUTE_POINTS) throw badRequest('summary.route has too many points');
  s.route = route.map((p, j) => {
    if (!Array.isArray(p) || p.length !== 2) throw badRequest(`summary.route[${j}] must be [lat, lon]`);
    return [num(p[0], `summary.route[${j}][0]`, -90, 90), num(p[1], `summary.route[${j}][1]`, -180, 180)];
  });
  s.from = text(i.from, 'summary.from', 60);
  s.to = text(i.to, 'summary.to', 60);
  s.distNm = optNumber(i.distNm, 'summary.distNm', 0, 1e5);
  s.eteMin = optNumber(i.eteMin, 'summary.eteMin', 0, 1e5);
  s.fuelL = optNumber(i.fuelL, 'summary.fuelL', 0, 1e5);
  return s;
}
