// What the NOTAM briefing and the filing routes need to know about a flight, computed on the server
// from the stored flight and the current reference data: planned altitudes (the same defaults as the
// editor: src/calc/altitudes.ts, overridden per leg), the block-off … block-on window, the
// aerodromes the flight uses and the aerodromes near the route.
import { defaultAltitudes } from '../../src/calc/altitudes.js';
import { distanceNm, parseClock } from '../../src/calc/nav.js';
import { DEFAULT_FLIGHT_OPTIONS } from '../../src/shared/constants.js';
import type { RefAerodrome, RefAirspace, RefFis, RefSunTable, RefVfrPoint, RefVfrRoute } from '../../src/shared/ref.js';
import { requestTiming } from '../../src/shared/requests.js';
import type { RoutePoint } from '../../src/shared/types.js';
import { accessibleSql } from './access.js';
import type { Queryable } from './db.js';
import { notFound } from './http.js';
import { distanceToRoute } from './notams.js';

export interface RefDocs {
  airac: string;
  aerodromes: RefAerodrome[];
  airspaces: RefAirspace[];
  fis: RefFis | null;
  vfrPoints: RefVfrPoint[];
  vfrRoutes: RefVfrRoute[];
  /** AIP GEN 2.7 sunset tables by ICAO. */
  sun: Record<string, RefSunTable>;
}

let refCache: { airac: string; at: number; docs: RefDocs } | null = null;

/** Reference data of the current AIRAC (cached per process; re-read when the AIRAC changes). */
export async function loadRef(db: Queryable): Promise<RefDocs> {
  const [cur] = await db.query<{ id: string }>('SELECT id FROM ref_airac WHERE current LIMIT 1');
  if (!cur) throw notFound('no reference data loaded');
  if (refCache && refCache.airac === cur.id) return refCache.docs;
  const docs = async <T>(table: string) =>
    (await db.query<{ doc: T }>(`SELECT doc FROM ${table} WHERE airac = $1 ORDER BY id`, [cur.id])).map((r) => r.doc);
  const [fis] = await db.query<{ doc: RefFis }>('SELECT doc FROM ref_fis WHERE airac = $1', [cur.id]);
  const sun = Object.fromEntries(
    (
      await db.query<{ icao: string; doc: RefSunTable }>('SELECT icao, doc FROM ref_sun WHERE airac = $1', [cur.id])
    ).map((r) => [r.icao, r.doc]),
  );
  const out: RefDocs = {
    airac: cur.id,
    aerodromes: await docs<RefAerodrome>('ref_aerodromes'),
    airspaces: await docs<RefAirspace>('ref_airspaces'),
    fis: fis?.doc ?? null,
    vfrPoints: await docs<RefVfrPoint>('ref_waypoints'),
    vfrRoutes: await docs<RefVfrRoute>('ref_vfr_routes'),
    sun,
  };
  refCache = { airac: cur.id, at: Date.now(), docs: out };
  return out;
}

export interface FlightContext {
  id: string;
  route: RoutePoint[];
  alternates: string[];
  /** Effective altitude per leg, ft (NaN = no rule gave one). */
  altitudesFt: number[];
  /** Block-off and block-on, UTC ms (whole day when block-off is not set). */
  blockOff: number;
  blockOn: number;
  /** True when block-off is set (the window is the flight, not the whole day). */
  timed: boolean;
  /** Aerodromes used: ICAO → 'departure' | 'destination' | 'intermediate stop' | 'alternate'. */
  used: Map<string, string>;
  ref: RefDocs;
  /** Registration of the flight's aircraft (e.g. 'SX-ASV'), or null when it has none. */
  registration: string | null;
}

/** Default cruise speed for the time window when neither the summary nor the aircraft gives one. */
const FALLBACK_TAS_KT = 90;

export async function flightContext(db: Queryable, pilotId: string, id: string): Promise<FlightContext> {
  const [f] = await db.query(
    `SELECT f.id, f.date, f.block_off, f.taxi_out_min, f.taxi_in_min, f.route, f.leg_overrides, f.options, f.summary, a.cruise_tas_kt, a.registration
     FROM flights f LEFT JOIN aircraft a ON a.id = f.aircraft_id AND ${accessibleSql('a', 'f.pilot_id')}
     WHERE f.id = $1 AND f.pilot_id = $2`,
    [id, pilotId],
  );
  if (!f) throw notFound('no such flight');
  const ref = await loadRef(db);
  const route: RoutePoint[] = Array.isArray(f.route) ? f.route : [];
  const overrides = (f.leg_overrides || {}) as Record<string, { altFt?: number }>;
  const typed = route.slice(1).map((_, i) => overrides[`${route[i].uid}>${route[i + 1].uid}`]?.altFt);
  const altitudesFt =
    route.length > 1
      ? defaultAltitudes(route, ref, typed, requestTiming(route, f.options).patternPoints).map((d, i) =>
          Number.isFinite(typed[i]) ? (typed[i] as number) : d.altFt,
        )
      : [];
  const options = { ...DEFAULT_FLIGHT_OPTIONS, ...(f.options || {}) };
  const alternates: string[] = (Array.isArray(options.alternates) ? options.alternates : []).filter(
    (a: unknown) => typeof a === 'string' && /^[A-Z]{4}$/.test(a),
  );

  const day = Date.parse(`${f.date}T00:00:00Z`);
  const clock = parseClock(f.block_off);
  const timed = Number.isFinite(clock) && Number.isFinite(day);
  let blockOff: number, blockOn: number;
  if (timed) {
    let dist = 0;
    for (let i = 0; i + 1 < route.length; i++) dist += distanceNm(route[i], route[i + 1]);
    const ete =
      Number(f.summary?.eteMin) > 0
        ? Number(f.summary.eteMin)
        : (dist / (Number(f.cruise_tas_kt) || FALLBACK_TAS_KT)) * 60;
    blockOff = day + clock * 60e3;
    blockOn = blockOff + ((Number(f.taxi_out_min) || 0) + ete + (Number(f.taxi_in_min) || 0)) * 60e3;
  } else {
    blockOff = Number.isFinite(day) ? day : Date.now();
    blockOn = blockOff + 24 * 3600e3;
  }

  const used = new Map<string, string>();
  const icaoOf = (p: RoutePoint) => {
    if (p.kind !== 'aerodrome') return null;
    const ad =
      ref.aerodromes.find((a) => a.id === p.refId) ||
      ref.aerodromes.find((a) => a.icao && a.icao === p.name.toUpperCase());
    return ad?.icao ?? null;
  };
  route.forEach((p, i) => {
    const icao = icaoOf(p);
    if (!icao || used.has(icao)) return;
    used.set(icao, i === 0 ? 'departure' : i === route.length - 1 ? 'destination' : 'intermediate stop');
  });
  // a round trip: the last point is also the destination
  if (route.length > 1) {
    const last = icaoOf(route[route.length - 1]);
    if (last && used.get(last) === 'departure') used.set(last, 'departure/destination');
  }
  for (const a of alternates) if (!used.has(a)) used.set(a, 'alternate');

  return {
    id: f.id,
    route,
    alternates,
    altitudesFt,
    blockOff,
    blockOn,
    timed,
    used,
    ref,
    registration: f.registration ?? null,
  };
}

/** Aerodromes (ICAO) within `radiusNm` of the route, not counting the ones the flight uses. */
export function aerodromesNear(ctx: FlightContext, radiusNm: number): string[] {
  return ctx.ref.aerodromes
    .filter((a) => a.icao && !ctx.used.has(a.icao) && distanceToRoute(a, ctx.route).dist <= radiusNm)
    .map((a) => a.icao!);
}
