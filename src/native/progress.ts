// Where the aircraft is along the planned route (the iPhone app's Fly screen, PGF.progress): the
// active leg, the next waypoint with its distance and bearing, the cross-track error, ETE/ETA, the
// leg's planned altitude and heading, and the radio frequency for here and the next one ahead.
// Pure: the app calls it with a GPS fix and what PGF.computeFlight returned.
//
// The active leg is the nearest leg ahead: the leg nearest the aircraft, or the next one once the
// aircraft is past COMPLETE_FRAC of it, so legs advance as the waypoints are passed. The aircraft's track tells the
// two directions of an out-and-back leg apart; without one, the earlier leg wins, unless the app
// passes the leg it showed last (lastLegIndex: legs before it are not gone back to).
import { distanceNm, norm180, norm360, pointInPolygon, R_NM, rad, trueCourse } from '../calc';
import { fisSide } from '../data/atc';
import type { AtcEntry, LatLon } from '../shared';

/** Past this share of a leg, the leg is flown and the next one is active. */
export const COMPLETE_FRAC = 0.9;
/** Further than this from the active leg, the aircraft is off the route. */
export const OFF_ROUTE_NM = 2;
/** Below this GPS groundspeed (taxiing, stopped) the navlog's GS gives the ETE. */
export const MIN_GPS_GS_KT = 30;
/** Within this of the departure or destination aerodrome, its own frequency is the one to use. */
export const AERODROME_FREQ_NM = 10;

export interface ProgressPoint extends LatLon {
  name: string;
  uid?: string;
}

/** What progress needs of a leg (computeFlight's legs and navlog rows). */
export interface ProgressLeg {
  from: ProgressPoint;
  to: ProgressPoint;
  distNm: number;
  /** Variation at the leg, E positive (magnetic = true − variation). */
  variation: number;
}
export interface ProgressNavlogLeg {
  altFt: number | null;
  gs?: number | null;
  mh?: number | null;
  ch?: number | null;
}

/** The flight's ATC list with what tells where each row applies (computeFlight's `atc`). */
export interface ProgressAtc {
  entries: AtcEntry[];
  /** Per entry: the legs it relates to (atcEntryLegs), null when not known (a row added by hand). */
  legs: (number[] | null)[];
  /** Per entry: the aerodrome of an aerodrome row (where it is and its zone), else null. */
  aerodromes: ({ lat: number; lon: number; zoneNm: number } | null)[];
  /** Per entry: an airspace row's lateral limits, [lat, lon] polygons, else null. */
  polygons: ([number, number][][] | null)[];
  /** The FIS sectors: their boundary ([lat, lon]) and the callsign of each side's unit. */
  fis: { boundary: [number, number][]; units: { side: string; callsign: string }[] } | null;
}

export interface ProgressInput {
  legs: ProgressLeg[];
  navlog: ProgressNavlogLeg[];
  atc: ProgressAtc | null;
  position: {
    lat: number;
    lon: number;
    altFt?: number | null;
    trackDeg?: number | null;
    gsKt?: number | null;
    /** Epoch ms or an ISO time. */
    time: number | string;
  };
  /** The leg shown last: earlier legs are not gone back to (out-and-back routes without a track). */
  lastLegIndex?: number | null;
}

export interface ProgressFreq {
  callsign: string;
  service: string;
  primary: string;
  backups: string[];
  group: string;
}

export interface Progress {
  legIndex: number | null;
  toWaypoint: (ProgressPoint & { index: number }) | null;
  /** To the next waypoint, NM. */
  distNm: number | null;
  /** To the next waypoint, degrees true and magnetic. */
  bearingDeg: number | null;
  bearingMagDeg: number | null;
  /** Off the active leg, NM: positive right of the course, negative left. */
  crossTrackNm: number | null;
  /** Along the active leg, 0 at its start, 1 at its end (beyond: < 0 or > 1). */
  legFraction: number | null;
  /** Groundspeed used for the ETE and where it came from. */
  gsKt: number | null;
  gsSource: 'gps' | 'navlog' | null;
  /** To the next waypoint, minutes, and the time there (epoch ms). */
  eteMin: number | null;
  eta: number | null;
  /** To the destination along the route, NM and minutes, and the time there (epoch ms). */
  remainingNm: number | null;
  eteDestMin: number | null;
  etaDest: number | null;
  /** The active leg's planned altitude (ft), magnetic and compass heading (degrees). */
  plannedAltFt: number | null;
  plannedHdg: number | null;
  plannedCh: number | null;
  freq: ProgressFreq | null;
  nextFreq: ProgressFreq | null;
  offRoute: boolean;
  /** Past the last waypoint. */
  arrived: boolean;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Along-track (from a, NM, signed) and cross-track (NM, positive right of a → b) of p. */
export function alongCross(p: LatLon, a: LatLon, b: LatLon): { along: number; cross: number } {
  const d13 = distanceNm(a, p) / R_NM;
  if (d13 === 0) return { along: 0, cross: 0 };
  const dt = rad(trueCourse(a, p) - trueCourse(a, b));
  const xt = Math.asin(Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(dt))));
  const c = Math.cos(xt);
  const at = Math.acos(Math.max(-1, Math.min(1, c === 0 ? 1 : Math.cos(d13) / c)));
  return { along: (Math.cos(dt) < 0 ? -at : at) * R_NM, cross: xt * R_NM };
}

/** Legs nearer than this to each other count as equally near (the earlier one wins). */
const TIE_NM = 0.05;

/**
 * The active leg: the leg nearest the aircraft (its distance to the leg's segment; a leg flown the
 * other way than the track counts as far), the earlier one of legs equally near; once the aircraft
 * is past COMPLETE_FRAC of it, the next leg.
 */
export function activeLeg(
  legs: ProgressLeg[],
  p: LatLon,
  trackDeg: number | null,
  lastLegIndex: number | null = null,
): { index: number; along: number; cross: number } | null {
  if (!legs.length) return null;
  const last = legs.length - 1;
  const start = fin(lastLegIndex) ? Math.max(0, Math.min(last, Math.floor(lastLegIndex))) : 0;
  const at = (i: number) => {
    const L = legs[i];
    const len = L.distNm > 0 ? L.distNm : distanceNm(L.from, L.to);
    const { along, cross } = alongCross(p, L.from, L.to);
    return { index: i, along, cross, len, frac: len > 0 ? along / len : 1 };
  };
  let best: (ReturnType<typeof at> & { score: number }) | null = null;
  for (let i = start; i <= last; i++) {
    const x = at(i);
    const L = legs[i];
    // distance to the leg's segment: to its start before it, to its end past it
    let score = x.frac < 0 ? distanceNm(p, L.from) : x.frac > 1 ? distanceNm(p, L.to) : Math.abs(x.cross);
    // flying the other way than this leg: another leg over the same ground is the one being flown
    if (fin(trackDeg) && x.len > 0 && Math.abs(norm180(trackDeg - trueCourse(L.from, L.to))) > 100) score += 1000;
    if (!best || score < best.score - TIE_NM) best = { ...x, score };
  }
  let cur = best!;
  while (cur.frac >= COMPLETE_FRAC && cur.index < last) cur = { ...at(cur.index + 1), score: 0 };
  return { index: cur.index, along: cur.along, cross: cur.cross };
}

const SERVICE_RANK = ['TWR', 'AFIS', 'INFO', 'A/A', 'RADIO', 'APP', 'RDR', 'CTL', 'GND', 'DEL', 'ATIS'];
const serviceRank = (s: string) => {
  const r = Math.min(...s.split('/').map((x) => (SERVICE_RANK.includes(x) ? SERVICE_RANK.indexOf(x) : 99)));
  return Number.isFinite(r) ? r : 99;
};
const freqOf = (e: AtcEntry): ProgressFreq => ({
  callsign: e.callsign,
  service: e.service,
  primary: e.primary,
  backups: e.backups,
  group: e.group,
});

/**
 * The unit to talk to at a point on leg `legIndex`: an aerodrome's (its tower, AFIS…) within its
 * zone (the departure and destination within AERODROME_FREQ_NM), else the airspace (TMA) the point
 * is in, else the FIS sector's, else whatever the list relates to that leg.
 */
export function freqAt(atc: ProgressAtc | null, legIndex: number, p: LatLon, lastLeg: number): AtcEntry | null {
  if (!atc) return null;
  const rows = atc.entries
    .map((e, k) => ({ e, k }))
    .filter(({ e, k }) => e.primary && (atc.legs[k] === null || atc.legs[k].includes(legIndex)));
  // aerodromes: the nearest one whose zone the point is in
  let ad: { d: number; rows: { e: AtcEntry; k: number }[] } | null = null;
  for (const r of rows) {
    const a = atc.aerodromes[r.k];
    if (!a || !['departure', 'enroute', 'destination'].includes(r.e.role)) continue;
    if (r.e.role === 'departure' && legIndex !== 0) continue;
    if (r.e.role === 'destination' && legIndex !== lastLeg) continue;
    const d = distanceNm(p, a);
    const reach = r.e.role === 'enroute' ? a.zoneNm : Math.max(a.zoneNm, AERODROME_FREQ_NM);
    if (d > reach) continue;
    if (!ad || d < ad.d - 1e-9) ad = { d, rows: [r] };
    else if (Math.abs(d - ad.d) <= 1e-9) ad.rows.push(r);
  }
  if (ad) return [...ad.rows].sort((x, y) => serviceRank(x.e.service) - serviceRank(y.e.service))[0].e;
  const airspace = rows.find(
    ({ e, k }) => e.role === 'airspace' && (atc.polygons[k] ?? []).some((poly) => pointInPolygon(p, poly)),
  );
  if (airspace) return airspace.e;
  const fis = rows.filter(({ e }) => e.role === 'fis');
  if (fis.length) {
    const side = atc.fis ? fisSide(p, atc.fis.boundary) : null;
    const unit = atc.fis?.units.find((u) => u.side === side);
    return (unit && fis.find(({ e }) => (e.sourceKey ?? '').includes(unit.callsign))?.e) || fis[0].e;
  }
  return null;
}

const sameFreq = (a: AtcEntry | null, b: AtcEntry | null) =>
  !!a && !!b && a.primary === b.primary && a.callsign === b.callsign;

export function progress(i: ProgressInput): Progress {
  const { legs, navlog, atc, position } = i;
  const p = { lat: position.lat, lon: position.lon };
  const timeMs = typeof position.time === 'number' ? position.time : Date.parse(String(position.time));
  const none: Progress = {
    legIndex: null,
    toWaypoint: null,
    distNm: null,
    bearingDeg: null,
    bearingMagDeg: null,
    crossTrackNm: null,
    legFraction: null,
    gsKt: null,
    gsSource: null,
    eteMin: null,
    eta: null,
    remainingNm: null,
    eteDestMin: null,
    etaDest: null,
    plannedAltFt: null,
    plannedHdg: null,
    plannedCh: null,
    freq: null,
    nextFreq: null,
    offRoute: false,
    arrived: false,
  };
  if (!fin(p.lat) || !fin(p.lon)) return none;
  const act = activeLeg(legs, p, fin(position.trackDeg) ? position.trackDeg : null, i.lastLegIndex ?? null);
  if (!act) return none;
  const k = act.index;
  const leg = legs[k];
  const row = navlog[k] ?? null;
  const len = leg.distNm > 0 ? leg.distNm : distanceNm(leg.from, leg.to);
  const legFraction = len > 0 ? act.along / len : 1;
  const distNm = distanceNm(p, leg.to);
  const bearingDeg = distNm > 0 ? trueCourse(p, leg.to) : null;
  const arrived = k === legs.length - 1 && legFraction >= 1;
  const gpsGs = fin(position.gsKt) && position.gsKt >= MIN_GPS_GS_KT ? position.gsKt : null;
  const planGs = row && fin(row.gs) && row.gs > 0 ? row.gs : null;
  const gsKt = gpsGs ?? planGs;
  const remainingNm = distNm + legs.slice(k + 1).reduce((s, l) => s + l.distNm, 0);
  const eteMin = gsKt ? (distNm / gsKt) * 60 : null;
  // to the destination: the remaining legs at their planned GS (or the GPS one throughout)
  let eteDestMin: number | null = eteMin;
  if (eteDestMin != null)
    for (let j = k + 1; j < legs.length; j++) {
      const g = gpsGs ?? (fin(navlog[j]?.gs) && navlog[j].gs! > 0 ? navlog[j].gs! : null);
      if (!g) {
        eteDestMin = null;
        break;
      }
      eteDestMin += (legs[j].distNm / g) * 60;
    }
  const freqEntry = freqAt(atc, k, p, legs.length - 1);
  // the next unit ahead: along the rest of this leg, then the legs after it
  let next: AtcEntry | null = null;
  if (atc)
    outer: for (let j = k; j < legs.length; j++) {
      const L = legs[j];
      for (let s = 0; s <= 8; s++) {
        const f = s / 8;
        if (j === k && f * len <= act.along) continue;
        const q = { lat: L.from.lat + (L.to.lat - L.from.lat) * f, lon: L.from.lon + (L.to.lon - L.from.lon) * f };
        const e = freqAt(atc, j, q, legs.length - 1);
        if (e && !sameFreq(e, freqEntry)) {
          next = e;
          break outer;
        }
      }
    }
  return {
    legIndex: k,
    toWaypoint: {
      index: k + 1,
      name: leg.to.name,
      lat: leg.to.lat,
      lon: leg.to.lon,
      ...(leg.to.uid ? { uid: leg.to.uid } : {}),
    },
    distNm,
    bearingDeg,
    bearingMagDeg: bearingDeg == null ? null : norm360(bearingDeg - (fin(leg.variation) ? leg.variation : 0)),
    crossTrackNm: act.cross,
    legFraction,
    gsKt,
    gsSource: gpsGs ? 'gps' : planGs ? 'navlog' : null,
    eteMin,
    eta: eteMin != null && fin(timeMs) ? timeMs + eteMin * 60000 : null,
    remainingNm,
    eteDestMin,
    etaDest: eteDestMin != null && fin(timeMs) ? timeMs + eteDestMin * 60000 : null,
    plannedAltFt: row && fin(row.altFt) ? row.altFt : null,
    plannedHdg: row && fin(row.mh) ? row.mh : null,
    plannedCh: row && fin(row.ch) ? row.ch : null,
    freq: freqEntry ? freqOf(freqEntry) : null,
    nextFreq: next ? freqOf(next) : null,
    offRoute: Math.abs(act.cross) > OFF_ROUTE_NM || (legFraction < 0 && distanceNm(p, leg.from) > OFF_ROUTE_NM),
    arrived,
  };
}
