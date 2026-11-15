// Pure helpers for the hangar screens: validation of an aircraft, FPL equipment codes, compass card
// status, envelope geometry, and the editing operations of the aircraft page (approved fuels,
// stations and seats, combined limits, envelopes, performance tables, runway condition factors,
// stall speeds, compass cards). The page applies them to its draft (a copy of the AircraftInput),
// so everything an aircraft holds can be created, changed and removed from the page. No DOM, no
// React (unit-tested in tests/unit/screens/hangar.test.ts and hangarScratch.test.ts, which builds
// the owner's SX-ASV and SX-ASG from a blank aircraft with these operations).
import type {
  AircraftInput, CompassCard, Envelope, EnvelopePoint, FuelSpec, FuelType, LandingTable, MassBalance, PerformanceFactors, PerformanceTables,
  Station, StationKind, TakeoffTable,
} from '../../shared/types';
import { DEFAULT_FUEL_DENSITY, FUEL_TYPES } from '../../shared/fuel';
import { isIsoDate, parseIsoDate } from '../../shared/date';
import { parseItem18 } from '../exports/fpl/fpl';

export type IssueLevel = 'error' | 'warning';
export type SectionId = 'identity' | 'fpl' | 'speeds' | 'fuel' | 'mb' | 'performance' | 'compass' | 'documents';

export interface Issue {
  level: IssueLevel;
  section: SectionId;
  /** Dotted path of the field ('fuel.usableL', 'massBalance.stations.2.armM'); '' for the section. */
  path: string;
  message: string;
}

const fin = (n: unknown): n is number => typeof n === 'number' && isFinite(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Dates and compass cards

export { isIsoDate } from '../../shared/date';

/** Whole days from a to b ('YYYY-MM-DD'); null if either is invalid. */
export function daysFromTo(a: string, b: string): number | null {
  const x = parseIsoDate(a), y = parseIsoDate(b);
  return x === null || y === null ? null : Math.round((y - x) / 86400000);
}

export type CardState = 'valid' | 'expiring' | 'expired' | 'unknown';
/** Status of a compass card on `today`; `warnDays` before expiry it becomes 'expiring'. */
export function cardStatus(card: Pick<CompassCard, 'expires'>, today: string, warnDays: number): { state: CardState; days: number | null } {
  const days = daysFromTo(today, card.expires);
  if (days === null) return { state: 'unknown', days: null };
  if (days < 0) return { state: 'expired', days };
  if (days <= warnDays) return { state: 'expiring', days };
  return { state: 'valid', days };
}

/** Deviation steer − for, normalised to −180…180. */
export function deviationOf(forDeg: number, steerDeg: number): number {
  let d = ((steerDeg - forDeg) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/** A 12-point card (every 30°) with steer = for, for a new swing. */
export function blankCardPoints(): [number, number][] {
  return Array.from({ length: 12 }, (_, i) => [i * 30, i * 30] as [number, number]);
}

// ---------------------------------------------------------------------------------------------
// FPL item 10

/** ICAO 2012 item 10a designators (N = none). */
export const ITEM10A_CODES: { code: string; label: string }[] = [
  { code: 'S', label: 'Standard: VHF RTF, VOR, ILS' },
  { code: 'A', label: 'GBAS landing system' },
  { code: 'B', label: 'LPV (APV with SBAS)' },
  { code: 'C', label: 'LORAN C' },
  { code: 'D', label: 'DME' },
  { code: 'E1', label: 'FMC WPR ACARS' },
  { code: 'E2', label: 'D-FIS ACARS' },
  { code: 'E3', label: 'PDC ACARS' },
  { code: 'F', label: 'ADF' },
  { code: 'G', label: 'GNSS' },
  { code: 'H', label: 'HF RTF' },
  { code: 'I', label: 'Inertial navigation' },
  { code: 'J1', label: 'CPDLC ATN VDL mode 2' },
  { code: 'K', label: 'MLS' },
  { code: 'L', label: 'ILS' },
  { code: 'O', label: 'VOR' },
  { code: 'R', label: 'PBN approved (see PBN/)' },
  { code: 'T', label: 'TACAN' },
  { code: 'U', label: 'UHF RTF' },
  { code: 'V', label: 'VHF RTF' },
  { code: 'W', label: 'RVSM approved' },
  { code: 'X', label: 'MNPS approved' },
  { code: 'Y', label: 'VHF with 8.33 kHz spacing' },
  { code: 'Z', label: 'Other (see COM/ NAV/ DAT/)' },
];
const ITEM10A_RE = /^(N|(S|A|B|C|D|E[1-3]|F|G|H|I|J[1-7]|K|L|M[1-3]|O|P[1-9]|R|T|U|V|W|X|Y|Z)*)$/;

/** Transponder (SSR) designators of item 10b. */
export const SSR_CODES: { code: string; label: string }[] = [
  { code: 'N', label: 'N: none' },
  { code: 'A', label: 'A: Mode A (4 digits)' },
  { code: 'C', label: 'C: Mode A and Mode C' },
  { code: 'E', label: 'E: Mode S, ID, altitude, extended squitter' },
  { code: 'H', label: 'H: Mode S, ID, altitude, enhanced surveillance' },
  { code: 'I', label: 'I: Mode S, ID, no altitude' },
  { code: 'L', label: 'L: Mode S, ID, altitude, ES and enhanced surveillance' },
  { code: 'P', label: 'P: Mode S, altitude, no ID' },
  { code: 'S', label: 'S: Mode S, ID and altitude' },
  { code: 'X', label: 'X: Mode S, no ID, no altitude' },
];
/** ADS-B / ADS-C designators of item 10b (appended after the SSR letter). */
export const ADS_CODES: { code: string; label: string }[] = [
  { code: 'B1', label: 'B1: ADS-B out 1090 MHz' },
  { code: 'B2', label: 'B2: ADS-B out and in 1090 MHz' },
  { code: 'U1', label: 'U1: ADS-B out UAT' },
  { code: 'U2', label: 'U2: ADS-B out and in UAT' },
  { code: 'V1', label: 'V1: ADS-B out VDL mode 4' },
  { code: 'V2', label: 'V2: ADS-B out and in VDL mode 4' },
  { code: 'D1', label: 'D1: ADS-C with FANS 1/A' },
  { code: 'G1', label: 'G1: ADS-C with ATN' },
];

/** Splits item 10a into designators ('SDFGY' → ['S','D','F','G','Y']; 'SE1J1' → ['S','E1','J1']). */
export function split10a(s: string): string[] {
  return (s.toUpperCase().match(/[A-Z][1-9]?/g) || []).filter((c) => c.length === 1 || /^[EJMP]/.test(c[0]));
}
/** Joins designators in the ICAO order (N alone; otherwise S first, then alphabetical). */
export function join10a(codes: string[]): string {
  const set = [...new Set(codes.map((c) => c.toUpperCase()))].filter((c) => c !== 'N');
  if (!set.length) return codes.includes('N') ? 'N' : '';
  return set.sort((a, b) => (a === 'S' ? -1 : b === 'S' ? 1 : a.localeCompare(b))).join('');
}

/** Splits item 10b into the SSR letter and the ADS designators ('SB2' → { ssr: 'S', ads: ['B2'] }). */
export function split10b(s: string): { ssr: string; ads: string[] } {
  const t = s.toUpperCase().trim();
  const m = /^([NACEHILPSX]?)((?:[BUVDG][12])*)$/.exec(t);
  if (!m) return { ssr: '', ads: [] };
  return { ssr: m[1], ads: m[2].match(/[BUVDG][12]/g) || [] };
}
export function join10b(ssr: string, ads: string[]): string {
  if (ssr === 'N' || !ssr) return ssr === 'N' ? 'N' : ads.join('');
  return ssr + ads.join('');
}

const PBN_CODES = ['A1', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4', 'L1', 'O1', 'O2', 'O3', 'O4', 'S1', 'S2', 'T1', 'T2'];
/** Invalid PBN/ designators in s ([] = valid). */
export function badPbn(s: string): string[] {
  const t = s.toUpperCase().replace(/\s+/g, '');
  if (!t) return [];
  const parts = t.match(/[A-Z][0-9]?/g) || [];
  if (parts.join('') !== t) return [t];
  return parts.filter((p) => !PBN_CODES.includes(p));
}

// ---------------------------------------------------------------------------------------------
// Geometry

/** True if the polygon's non-adjacent edges cross (closed implicitly). */
export function selfIntersects(poly: [number, number][]): boolean {
  const n = poly.length;
  if (n < 4) return false;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inter = (p1: number[], p2: number[], p3: number[], p4: number[]) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (inter(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Signed area (shoelace); 0 for a degenerate polygon. */
export function polygonArea(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Point in polygon (ray casting); points on an edge count as inside. */
export function insidePolygon(pt: [number, number], poly: [number, number][]): boolean {
  if (poly.length < 3) return false;
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const onSeg = Math.abs((xj - xi) * (y - yi) - (yj - yi) * (x - xi)) < 1e-9 && x >= Math.min(xi, xj) - 1e-9 && x <= Math.max(xi, xj) + 1e-9 && y >= Math.min(yi, yj) - 1e-9 && y <= Math.max(yi, yj) + 1e-9;
    if (onSeg) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Moment envelope [moment kg·m, mass kg] equivalent to a CG envelope [arm m, mass kg]. An edge
 * with a sloping arm limit becomes a curve in moment space, so such edges are split into `steps`
 * segments; edges of constant arm or constant mass stay straight. Moments rounded to 0.1 kg·m.
 */
export function momentPolygonFromCg(poly: EnvelopePoint[], steps = 8): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const [a1, m1] = poly[i], [a2, m2] = poly[(i + 1) % poly.length];
    const curved = Math.abs(a2 - a1) > 1e-9 && Math.abs(m2 - m1) > 1e-9;
    const n = curved ? steps : 1;
    for (let k = 0; k < n; k++) {
      const t = k / n, a = a1 + (a2 - a1) * t, m = m1 + (m2 - m1) * t;
      out.push([Math.round(a * m * 10) / 10, Math.round(m * 10) / 10]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Stations

/** A new station id unique among `stations`, from a kind ('bag' → 'bag3'). */
export function newStationId(stations: Station[], base: string): string {
  const ids = new Set(stations.map((s) => s.id));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base}${i}`)) return `${base}${i}`;
}
/** A new seat id unique among all seats of the aircraft. */
export function newSeatId(stations: Station[], stationId: string): string {
  const ids = new Set(stations.flatMap((s) => (s.seats || []).map((p) => p.id)));
  for (let i = 1; ; i++) if (!ids.has(`${stationId}-${i}`)) return `${stationId}-${i}`;
}

const STATION_DEFAULTS: Record<StationKind, { id: string; name: string }> = {
  seat: { id: 'seats', name: 'Seats' },
  baggage: { id: 'bag', name: 'Baggage area' },
  fuel: { id: 'fuel', name: 'Fuel' },
};

/** Adds a station of a kind (a seat station gets one seat); returns it. */
export function addStation(mb: MassBalance, kind: StationKind): Station {
  const id = newStationId(mb.stations, STATION_DEFAULTS[kind].id);
  const s: Station = { id, name: STATION_DEFAULTS[kind].name, kind, armM: 0, armRangeM: null, maxKg: null, seats: null };
  if (kind === 'seat') s.seats = [{ id: newSeatId(mb.stations, id), label: 'Seat' }];
  mb.stations.push(s);
  return s;
}
/** Changes a station's kind: seats only on seat stations, a max load only on baggage areas. */
export function setStationKind(mb: MassBalance, i: number, kind: StationKind): void {
  const x = mb.stations[i];
  x.kind = kind;
  if (kind === 'seat' && !x.seats?.length) x.seats = [{ id: newSeatId(mb.stations, x.id), label: 'Seat' }];
  if (kind !== 'seat') { x.seats = null; x.armRangeM = null; }
  if (kind !== 'baggage') x.maxKg = null;
}
/** Removes a station and its id from the combined limits (limits left empty go). */
export function removeStation(mb: MassBalance, i: number): void {
  const [gone] = mb.stations.splice(i, 1);
  if (!gone) return;
  mb.combinedLimits = mb.combinedLimits.map((c) => ({ ...c, stations: c.stations.filter((x) => x !== gone.id) })).filter((c) => c.stations.length);
}
export function addSeat(mb: MassBalance, i: number, label = 'Seat'): void {
  const x = mb.stations[i];
  x.seats = [...(x.seats || []), { id: newSeatId(mb.stations, x.id), label }];
}
export function removeSeat(mb: MassBalance, i: number, k: number): void {
  const x = mb.stations[i];
  x.seats = (x.seats || []).filter((_, j) => j !== k);
}
/** Seat adjustment range: either end may be typed first (the other starts at the arm); both empty = none. */
export function setArmRange(s: Station, end: 0 | 1, v: number | null): void {
  const cur = s.armRangeM ?? null;
  const other = cur ? cur[end === 0 ? 1 : 0] : null;
  if (v == null && other == null) { s.armRangeM = null; return; }
  const lo = end === 0 ? (v ?? s.armM) : (cur?.[0] ?? s.armM);
  const hi = end === 1 ? (v ?? s.armM) : (cur?.[1] ?? s.armM);
  s.armRangeM = [lo, hi];
}
/** Moves item i of a list by d (−1 up, +1 down). */
export function moveItem<T>(xs: T[], i: number, d: -1 | 1): void {
  const j = i + d;
  if (j < 0 || j >= xs.length) return;
  [xs[i], xs[j]] = [xs[j], xs[i]];
}
/** A new combined limit over the baggage areas. */
export function addCombinedLimit(mb: MassBalance): void {
  mb.combinedLimits.push({ stations: mb.stations.filter((s) => s.kind === 'baggage').map((s) => s.id), maxKg: 0 });
}
/** A utility category, starting as a copy of the normal CG envelope. */
export function addUtilityEnvelope(mb: MassBalance): Envelope {
  const n = mb.envelopes.normal;
  mb.envelopes.utility = { category: 'utility', maxKg: n.maxKg, polygon: n.polygon.map((q) => [...q] as [number, number]), momentPolygon: null, notes: '' };
  return mb.envelopes.utility;
}

// ---------------------------------------------------------------------------------------------
// Approved fuels

/** Adds an approved fuel at its default density (no-op if already listed). */
export function addFuelType(f: FuelSpec, t: FuelType): void {
  if (f.types.some((g) => g.type === t)) return;
  f.types.push({ type: t, densityKgPerL: DEFAULT_FUEL_DENSITY[t] });
}
/** Removes an approved fuel (the last one stays). */
export function removeFuelType(f: FuelSpec, t: FuelType): void {
  if (f.types.length <= 1) return;
  f.types = f.types.filter((g) => g.type !== t);
}
/** Makes a fuel the first one (the fuel a flight's plain total means). */
export function makePrimaryFuel(f: FuelSpec, t: FuelType): void {
  const i = f.types.findIndex((g) => g.type === t);
  if (i > 0) f.types.unshift(...f.types.splice(i, 1));
}
/** Fuel types not approved on this aircraft yet. */
export const otherFuelTypes = (f: FuelSpec): FuelType[] => FUEL_TYPES.filter((t) => !f.types.some((g) => g.type === t));

// ---------------------------------------------------------------------------------------------
// Planning factors, stall speeds, compass cards

/** Runway surface / condition factors as an ordered list (the record keeps insertion order). */
export const runwayConditions = (f: PerformanceFactors): [string, number][] => Object.entries(f.runwayCondition);
export function setRunwayConditions(f: PerformanceFactors, entries: [string, number][]): void {
  f.runwayCondition = Object.fromEntries(entries);
}
/** Adds a condition under a name not used yet; returns the name. */
export function addRunwayCondition(f: PerformanceFactors, name = 'new condition', factor = 1.1): string {
  const names = new Set(Object.keys(f.runwayCondition));
  let n = name;
  for (let i = 2; names.has(n); i++) n = `${name} ${i}`;
  f.runwayCondition = { ...f.runwayCondition, [n]: factor };
  return n;
}
/** Stall IAS table (flaps up / partial / full × bank 0, 20, 40, 60°), all 0. */
export function addStallSpeeds(p: PerformanceTables): void {
  p.stallIasKt = { flapsUp: [0, 0, 0, 0], flaps10: [0, 0, 0, 0], flaps40: [0, 0, 0, 0] };
}
/** 'YYYY-MM-DD' + n years (29 Feb → 28 Feb); '' if invalid. */
export function addYears(d: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return '';
  return `${+m[1] + n}-${m[2]}-${m[3] === '29' && m[2] === '02' ? '28' : m[3]}`;
}
/** A new deviation card swung `today`, valid two years, steer = for every 30°. */
export function addCompassCard(a: AircraftInput, today: string): CompassCard {
  const names = new Set(a.compassCards.map((c) => c.name));
  const name = !names.has('Magnetic compass') ? 'Magnetic compass' : `Card ${a.compassCards.length + 1}`;
  const c: CompassCard = { name, swung: today, expires: addYears(today, 2), source: '', points: blankCardPoints() };
  a.compassCards.push(c);
  return c;
}

// ---------------------------------------------------------------------------------------------
// FPL item 18

/**
 * Indicators of the hangar's "other item 18" text that the flight plan leaves out
 * (src/features/exports/fpl/fpl.ts): DOF/ REG/ DEP/ DEST/ ALTN/ EET/ come from the flight, PBN/
 * from the PBN field, OPR/ from the operator, TYP/ is only written with type ZZZZ. RMK/ text is
 * kept (added to the flight's RMK/), and so are NAV/, COM/ and the others.
 */
export function item18Dropped(a: Pick<AircraftInput, 'equipment' | 'operator' | 'icaoType'>): { indicator: string; why: string }[] {
  const out: { indicator: string; why: string }[] = [];
  for (const p of parseItem18(a.equipment.item18Extras || '')) {
    if (out.some((d) => d.indicator === p.indicator)) continue;
    let why = '';
    if (['DOF', 'REG', 'DEP', 'DEST', 'ALTN', 'EET'].includes(p.indicator)) why = 'comes from the flight';
    else if (p.indicator === 'PBN' && a.equipment.pbn) why = 'comes from the PBN/ field';
    else if (p.indicator === 'OPR' && a.operator.trim()) why = 'comes from the operator';
    else if (p.indicator === 'TYP' && /^[A-Z][A-Z0-9]{1,3}$/.test(a.icaoType) && a.icaoType !== 'ZZZZ') why = 'only used with type ZZZZ';
    if (why) out.push({ indicator: p.indicator, why });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Performance table reshaping (column = pressure altitude, row = mass or headwind)

const ISA = (ft: number) => r2(15 - 1.98 * ft / 1000);

export function addTakeoffAltitude(t: TakeoffTable): TakeoffTable {
  const last = t.altitudesFt[t.altitudesFt.length - 1];
  const alt = last == null ? 0 : last + 2500;
  return {
    ...t,
    altitudesFt: [...t.altitudesFt, alt],
    standardTempC: [...t.standardTempC, Math.round(ISA(alt))],
    rows: t.rows.map((r) => ({ ...r, distances: r.distances.map((hw) => [...hw, [...(hw[hw.length - 1] ?? [0, 0])] as [number, number]]) })),
  };
}
export function removeTakeoffAltitude(t: TakeoffTable, i: number): TakeoffTable {
  return {
    ...t,
    altitudesFt: t.altitudesFt.filter((_, k) => k !== i),
    standardTempC: t.standardTempC.filter((_, k) => k !== i),
    rows: t.rows.map((r) => ({ ...r, distances: r.distances.map((hw) => hw.filter((_, k) => k !== i)) })),
  };
}
export function addTakeoffMassRow(t: TakeoffTable): TakeoffTable {
  const prev = t.rows[t.rows.length - 1];
  const headwindKt = prev ? [...prev.headwindKt] : [0];
  const blank = headwindKt.map(() => t.altitudesFt.map(() => [0, 0] as [number, number]));
  return { ...t, rows: [...t.rows, { massKg: prev ? prev.massKg + 100 : 0, liftoffIas: '', headwindKt, distances: prev ? prev.distances.map((hw) => hw.map((p) => [...p] as [number, number])) : blank }] };
}
export function removeTakeoffMassRow(t: TakeoffTable, i: number): TakeoffTable {
  return { ...t, rows: t.rows.filter((_, k) => k !== i) };
}
export function addHeadwind(t: TakeoffTable, row: number): TakeoffTable {
  return {
    ...t,
    rows: t.rows.map((r, k) => k !== row ? r : {
      ...r,
      headwindKt: [...r.headwindKt, (r.headwindKt[r.headwindKt.length - 1] ?? -10) + 10],
      distances: [...r.distances, t.altitudesFt.map((_, a) => [...(r.distances[r.distances.length - 1]?.[a] ?? [0, 0])] as [number, number])],
    }),
  };
}
export function removeHeadwind(t: TakeoffTable, row: number, i: number): TakeoffTable {
  return { ...t, rows: t.rows.map((r, k) => k !== row ? r : { ...r, headwindKt: r.headwindKt.filter((_, j) => j !== i), distances: r.distances.filter((_, j) => j !== i) }) };
}
export function addLandingAltitude(l: LandingTable): LandingTable {
  const last = l.altitudesFt[l.altitudesFt.length - 1];
  const alt = last == null ? 0 : last + 2500;
  return { ...l, altitudesFt: [...l.altitudesFt, alt], standardTempC: [...l.standardTempC, Math.round(ISA(alt))], distances: [...l.distances, [...(l.distances[l.distances.length - 1] ?? [0, 0])] as [number, number]] };
}
export function removeLandingAltitude(l: LandingTable, i: number): LandingTable {
  return { ...l, altitudesFt: l.altitudesFt.filter((_, k) => k !== i), standardTempC: l.standardTempC.filter((_, k) => k !== i), distances: l.distances.filter((_, k) => k !== i) };
}

// ---------------------------------------------------------------------------------------------
// Copy / summary

/** Same-type copy of an aircraft: drops what belongs to the airframe (registration, serial,
 * weighing, colours, compass cards). */
export function sameTypeCopy(a: AircraftInput, registration: string): AircraftInput {
  const c: AircraftInput = JSON.parse(JSON.stringify(a));
  c.registration = registration;
  c.serial = '';
  c.colours = '';
  c.compassCards = [];
  c.massBalance.emptyMassKg = 0;
  c.massBalance.emptyArmM = 0;
  c.massBalance.emptyMomentKgM = 0;
  c.massBalance.weighingDate = null;
  c.massBalance.weighingSource = '';
  return c;
}

/** Values the navlog, W&B or flight plan need that are not set yet (short labels). */
export function missingEssentials(a: AircraftInput): string[] {
  const out: string[] = [];
  if (!(a.cruiseTasKt > 0)) out.push('cruise TAS');
  if (!(a.patternTasKt > 0)) out.push('pattern TAS');
  if (!(a.fuel.burnLph > 0)) out.push('fuel burn');
  if (!(a.fuel.usableL > 0)) out.push('usable fuel');
  if (!(a.massBalance.emptyMassKg > 0)) out.push('empty mass');
  if (!(a.massBalance.mtowKg > 0)) out.push('MTOW');
  if (a.massBalance.envelopes.normal.polygon.length < 3) out.push('CG envelope');
  if (!a.icaoType) out.push('ICAO type');
  if (!a.equipment.item10a || !a.equipment.item10b) out.push('FPL equipment');
  if (!a.colours) out.push('colours');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validation

/**
 * All problems of an aircraft. Errors are inconsistent values that would make calculations wrong
 * (saving is refused); warnings are values not set yet or unusual (saving is allowed).
 */
export function validateAircraft(a: AircraftInput, today: string, cardWarnDays = 90): Issue[] {
  const out: Issue[] = [];
  const err = (section: SectionId, path: string, message: string) => out.push({ level: 'error', section, path, message });
  const warn = (section: SectionId, path: string, message: string) => out.push({ level: 'warning', section, path, message });

  // identity
  if (!a.registration.trim()) err('identity', 'registration', 'Registration is required.');
  else if (!/^[A-Z0-9]{1,3}-?[A-Z0-9]{1,6}$/.test(a.registration)) warn('identity', 'registration', 'Registration is usually letters and digits with one hyphen, e.g. SX-ASV.');
  if (!a.icaoType) warn('identity', 'icaoType', 'ICAO type designator not set (FPL item 9).');
  else if (!/^[A-Z][A-Z0-9]{1,3}$/.test(a.icaoType)) err('identity', 'icaoType', 'ICAO type designator is 2–4 letters/digits starting with a letter, e.g. C172 (or ZZZZ).');
  if (!a.colours.trim()) warn('identity', 'colours', 'Colours and markings not set (FPL item 19 A/).');
  if (a.homeBase && !/^[A-Z]{4}$/.test(a.homeBase)) warn('identity', 'homeBase', 'Home base should be a 4-letter ICAO code.');

  // FPL
  const e = a.equipment;
  if (!e.item10a) warn('fpl', 'equipment.item10a', 'Item 10a not set.');
  else if (!ITEM10A_RE.test(e.item10a)) err('fpl', 'equipment.item10a', `Item 10a “${e.item10a}” has invalid designators (N alone, or e.g. SDFGY).`);
  if (!e.item10b) warn('fpl', 'equipment.item10b', 'Item 10b (transponder) not set.');
  else if (!/^(N|[ACEHILPSX]?(?:[BUVDG][12])*)$/.test(e.item10b)) err('fpl', 'equipment.item10b', `Item 10b “${e.item10b}” is invalid (N, or a transponder letter then ADS codes, e.g. SB2).`);
  const bad = badPbn(e.pbn);
  if (bad.length) err('fpl', 'equipment.pbn', `Unknown PBN designators: ${bad.join(', ')}.`);
  else if (e.pbn && e.pbn.replace(/\s+/g, '').length / 2 > 8) err('fpl', 'equipment.pbn', 'At most 8 PBN designators.');
  const has10aR = split10a(e.item10a).includes('R');
  if (has10aR && !e.pbn) warn('fpl', 'equipment.pbn', 'Item 10a has R: give the PBN/ capabilities.');
  if (!has10aR && e.pbn) warn('fpl', 'equipment.pbn', 'PBN/ is given but item 10a has no R.');
  const dropped = item18Dropped(a);
  if (dropped.length) warn('fpl', 'equipment.item18Extras', `Left out of the flight plan: ${dropped.map((d) => `${d.indicator}/ (${d.why})`).join(', ')}.`);
  if (e.dinghies) {
    if (!Number.isInteger(e.dinghies.number) || e.dinghies.number < 1) err('fpl', 'equipment.dinghies.number', 'Number of dinghies must be a whole number of at least 1.');
    if (!Number.isInteger(e.dinghies.capacity) || e.dinghies.capacity < 1) err('fpl', 'equipment.dinghies.capacity', 'Dinghy capacity must be a whole number of at least 1.');
    if (!e.dinghies.colour.trim()) warn('fpl', 'equipment.dinghies.colour', 'Dinghy colour not set.');
  }

  // speeds
  if (!(a.cruiseTasKt > 0)) warn('speeds', 'cruiseTasKt', 'Cruise TAS not set: the navlog needs it.');
  if (!(a.patternTasKt > 0)) warn('speeds', 'patternTasKt', 'Pattern TAS not set: the first and last legs use it.');
  if (a.cruiseTasKt > 0 && a.patternTasKt > a.cruiseTasKt) warn('speeds', 'patternTasKt', 'Pattern TAS is higher than cruise TAS.');
  if (a.climbTasKt != null && a.cruiseTasKt > 0 && a.climbTasKt > a.cruiseTasKt) warn('speeds', 'climbTasKt', 'Climb TAS is higher than cruise TAS.');

  // fuel
  const f = a.fuel;
  if (!f.types.length) err('fuel', 'fuel.types', 'Give at least one approved fuel.');
  if (new Set(f.types.map((g) => g.type)).size !== f.types.length) err('fuel', 'fuel.types', 'A fuel type is listed twice.');
  f.types.forEach((g, i) => {
    if (!(g.densityKgPerL >= 0.5 && g.densityKgPerL <= 1)) err('fuel', `fuel.types.${i}.densityKgPerL`, `${g.type} density must be between 0.5 and 1.0 kg/L.`);
  });
  if (!(f.usableL > 0)) warn('fuel', 'fuel.usableL', 'Usable fuel not set: fuel on board cannot be checked.');
  if (f.totalL > 0 && f.usableL > f.totalL) err('fuel', 'fuel.usableL', 'Usable fuel is more than the total capacity.');
  if (f.totalL > 0 && f.usableL > 0 && Math.abs(f.usableL + f.unusableL - f.totalL) > 0.5 && f.usableL + f.unusableL < f.totalL)
    warn('fuel', 'fuel.totalL', `Usable + unusable (${r2(f.usableL + f.unusableL)} L) is less than the total ${f.totalL} L (fine if the tank option limits usable fuel).`);
  if (f.totalL > 0 && f.usableL + f.unusableL > f.totalL + 0.5) err('fuel', 'fuel.unusableL', `Usable + unusable (${r2(f.usableL + f.unusableL)} L) is more than the total ${f.totalL} L.`);
  if (!(f.burnLph > 0)) warn('fuel', 'fuel.burnLph', 'Burn rate not set: fuel per leg cannot be computed.');
  else if (f.burnLph > 500) err('fuel', 'fuel.burnLph', 'Burn rate looks wrong (over 500 L/h).');

  // mass & balance
  const mb = a.massBalance;
  if (!(mb.mtowKg > 0)) warn('mb', 'massBalance.mtowKg', 'MTOW not set.');
  if (!(mb.emptyMassKg > 0)) warn('mb', 'massBalance.emptyMassKg', 'Empty mass not set: enter it from the weighing report.');
  else {
    if (mb.mtowKg > 0 && mb.emptyMassKg >= mb.mtowKg) err('mb', 'massBalance.emptyMassKg', 'Empty mass is not below MTOW.');
    if (!(mb.emptyArmM > 0)) warn('mb', 'massBalance.emptyArmM', 'Empty CG arm not set.');
    else if (mb.emptyMomentKgM > 0 && Math.abs(mb.emptyMassKg * mb.emptyArmM - mb.emptyMomentKgM) > Math.max(0.5, mb.emptyMomentKgM * 0.002))
      warn('mb', 'massBalance.emptyMomentKgM', `Empty moment ${mb.emptyMomentKgM} differs from mass × arm = ${r2(mb.emptyMassKg * mb.emptyArmM)} kg·m.`);
    if (!mb.weighingDate) warn('mb', 'massBalance.weighingDate', 'Weighing date not set.');
  }
  if (mb.weighingDate && !isIsoDate(mb.weighingDate)) err('mb', 'massBalance.weighingDate', 'Weighing date is not a valid date.');
  if (mb.mlwKg != null && mb.mtowKg > 0 && mb.mlwKg > mb.mtowKg) warn('mb', 'massBalance.mlwKg', 'Max landing mass is above MTOW.');

  const ids = new Set<string>();
  const seatIds = new Set<string>();
  mb.stations.forEach((s, i) => {
    const p = `massBalance.stations.${i}`;
    if (!s.id) err('mb', `${p}.id`, `Station ${i + 1} has no id.`);
    else if (ids.has(s.id)) err('mb', `${p}.id`, `Two stations have the id “${s.id}”.`);
    ids.add(s.id);
    if (!s.name.trim()) err('mb', `${p}.name`, `Station ${s.id || i + 1} has no name.`);
    if (!fin(s.armM) || s.armM < -5 || s.armM > 30) err('mb', `${p}.armM`, `Arm of ${s.name || s.id} must be a number of metres.`);
    if (s.armRangeM) {
      const [lo, hi] = s.armRangeM;
      if (!(lo < hi)) err('mb', `${p}.armRangeM`, `Seat adjustment range of ${s.name} must go from lower to higher arm.`);
      else if (s.armM < lo || s.armM > hi) warn('mb', `${p}.armRangeM`, `Arm ${s.armM} m of ${s.name} is outside its adjustment range ${lo}–${hi} m.`);
    }
    if (s.kind === 'seat') {
      if (!s.seats || !s.seats.length) err('mb', `${p}.seats`, `Seat station ${s.name} has no seats.`);
      for (const seat of s.seats || []) {
        if (!seat.id || !seat.label.trim()) err('mb', `${p}.seats`, `A seat of ${s.name} has no name.`);
        if (seatIds.has(seat.id)) err('mb', `${p}.seats`, `Seat id “${seat.id}” is used twice.`);
        seatIds.add(seat.id);
      }
    }
    if (s.kind === 'baggage' && s.maxKg != null && !(s.maxKg > 0)) err('mb', `${p}.maxKg`, `Max load of ${s.name} must be positive (or empty for no limit).`);
  });
  const fuelStations = mb.stations.filter((s) => s.kind === 'fuel');
  if (fuelStations.length === 0) warn('mb', 'massBalance.stations', 'No fuel station: W&B needs the fuel arm.');
  if (fuelStations.length > 1) err('mb', 'massBalance.stations', 'Only one fuel station is supported.');
  if (!mb.stations.some((s) => s.kind === 'seat')) warn('mb', 'massBalance.stations', 'No seat stations: the manifest needs seats.');
  mb.combinedLimits.forEach((c, i) => {
    const missing = c.stations.filter((id) => !ids.has(id));
    if (missing.length) err('mb', `massBalance.combinedLimits.${i}`, `Combined limit refers to unknown station ${missing.join(', ')}.`);
    if (c.stations.length < 2) warn('mb', `massBalance.combinedLimits.${i}`, 'A combined limit should cover at least two stations.');
    if (!(c.maxKg > 0)) err('mb', `massBalance.combinedLimits.${i}`, 'Combined limit must be positive.');
  });

  const env = (cat: 'normal' | 'utility') => {
    const en = mb.envelopes[cat];
    if (!en) return;
    const p = `massBalance.envelopes.${cat}`;
    const label = cat === 'normal' ? 'Normal' : 'Utility';
    if (en.polygon.length < 3) {
      (cat === 'normal' ? warn : err)('mb', `${p}.polygon`, `${label} CG envelope needs at least 3 points.`);
    } else {
      if (en.polygon.some(([x, y]) => !fin(x) || !fin(y))) err('mb', `${p}.polygon`, `${label} CG envelope has an empty value.`);
      else if (selfIntersects(en.polygon)) err('mb', `${p}.polygon`, `${label} CG envelope crosses itself: list the points in order around the outline.`);
      else if (Math.abs(polygonArea(en.polygon)) < 1e-9) err('mb', `${p}.polygon`, `${label} CG envelope has no area.`);
      const top = Math.max(...en.polygon.map((q) => q[1]));
      if (en.maxKg > 0 && Math.abs(top - en.maxKg) > 0.5) warn('mb', `${p}.polygon`, `${label} CG envelope tops out at ${top} kg but its max mass is ${en.maxKg} kg.`);
    }
    if (!(en.maxKg > 0)) warn('mb', `${p}.maxKg`, `${label} max mass not set.`);
    else if (mb.mtowKg > 0 && en.maxKg > mb.mtowKg) err('mb', `${p}.maxKg`, `${label} max mass is above MTOW.`);
    const mp = en.momentPolygon;
    if (mp && mp.length) {
      if (mp.length < 3) err('mb', `${p}.momentPolygon`, `${label} moment envelope needs at least 3 points.`);
      else if (mp.some(([x, y]) => !fin(x) || !fin(y))) err('mb', `${p}.momentPolygon`, `${label} moment envelope has an empty value.`);
      else if (selfIntersects(mp)) err('mb', `${p}.momentPolygon`, `${label} moment envelope crosses itself.`);
    }
  };
  env('normal');
  env('utility');
  if (mb.envelopes.utility && mb.envelopes.utility.maxKg > mb.envelopes.normal.maxKg && mb.envelopes.normal.maxKg > 0)
    err('mb', 'massBalance.envelopes.utility.maxKg', 'Utility max mass is above the normal max mass.');
  if (mb.emptyMassKg > 0 && mb.emptyArmM > 0 && mb.envelopes.normal.polygon.length >= 3) {
    const arms = mb.envelopes.normal.polygon.map((q) => q[0]);
    if (mb.emptyArmM < Math.min(...arms) - 0.15 || mb.emptyArmM > Math.max(...arms) + 0.15)
      warn('mb', 'massBalance.emptyArmM', 'Empty CG arm is far outside the envelope arms: check the units (metres).');
  }

  // performance
  const t = a.performance.takeoff;
  const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
  if (t.rows.length) {
    if (!ascending(t.altitudesFt)) err('performance', 'performance.takeoff.altitudesFt', 'Take-off table: pressure altitudes must increase left to right.');
    if (t.standardTempC.length !== t.altitudesFt.length) err('performance', 'performance.takeoff.standardTempC', 'Take-off table: one standard temperature per altitude.');
    if (!ascending(t.rows.map((r) => r.massKg))) err('performance', 'performance.takeoff.rows', 'Take-off table: masses must increase top to bottom.');
    t.rows.forEach((r, i) => {
      if (!ascending(r.headwindKt)) err('performance', `performance.takeoff.rows.${i}`, `Take-off ${r.massKg} kg: headwinds must increase.`);
      if (r.distances.length !== r.headwindKt.length || r.distances.some((hw) => hw.length !== t.altitudesFt.length)) err('performance', `performance.takeoff.rows.${i}`, `Take-off ${r.massKg} kg: table shape does not match the headings.`);
      if (r.distances.some((hw) => hw.some(([g, tot]) => !(g > 0) || !(tot >= g)))) warn('performance', `performance.takeoff.rows.${i}`, `Take-off ${r.massKg} kg: every distance should be positive and the total at least the ground run.`);
    });
    if (mb.mtowKg > 0 && Math.max(...t.rows.map((r) => r.massKg)) < mb.mtowKg) warn('performance', 'performance.takeoff.rows', 'Take-off table does not reach MTOW: heavier take-offs are extrapolated.');
  } else warn('performance', 'performance.takeoff', 'No take-off table: take-off distances cannot be computed.');
  const l = a.performance.landing;
  if (l.distances.length) {
    if (!ascending(l.altitudesFt)) err('performance', 'performance.landing.altitudesFt', 'Landing table: pressure altitudes must increase left to right.');
    if (l.standardTempC.length !== l.altitudesFt.length || l.distances.length !== l.altitudesFt.length) err('performance', 'performance.landing', 'Landing table: one temperature and one distance pair per altitude.');
    if (l.distances.some(([g, tot]) => !(g > 0) || !(tot >= g))) warn('performance', 'performance.landing', 'Landing table: every distance should be positive and the total at least the ground roll.');
  } else warn('performance', 'performance.landing', 'No landing table: landing distances cannot be computed.');
  const pf = a.performance.factors;
  if (!(pf.safetyFactorTakeoff >= 1)) err('performance', 'performance.factors.safetyFactorTakeoff', 'Take-off safety factor must be at least 1.');
  if (!(pf.safetyFactorLanding >= 1)) err('performance', 'performance.factors.safetyFactorLanding', 'Landing safety factor must be at least 1.');
  if (!(pf.slopeFactorPer2Pct >= 1)) err('performance', 'performance.factors.slopeFactorPer2Pct', 'Slope factor must be at least 1.');
  for (const [k, v] of Object.entries(pf.runwayCondition)) {
    if (!k.trim()) err('performance', 'performance.factors.runwayCondition', 'A runway condition has no name.');
    if (!(v >= 1)) err('performance', 'performance.factors.runwayCondition', `Runway condition “${k}” factor must be at least 1.`);
  }
  if (!(pf.maxCrosswindKt.takeoff > 0) || !(pf.maxCrosswindKt.landing > 0)) err('performance', 'performance.factors.maxCrosswindKt', 'Crosswind limits must be positive.');

  // compass cards
  const names = new Set<string>();
  a.compassCards.forEach((c, i) => {
    const p = `compassCards.${i}`;
    if (!c.name.trim()) err('compass', `${p}.name`, `Card ${i + 1} has no name.`);
    else if (names.has(c.name)) err('compass', `${p}.name`, `Two cards are called “${c.name}”.`);
    names.add(c.name);
    if (!isIsoDate(c.swung)) err('compass', `${p}.swung`, `${c.name || 'Card'}: swing date is missing or invalid.`);
    if (!isIsoDate(c.expires)) err('compass', `${p}.expires`, `${c.name || 'Card'}: expiry date is missing or invalid.`);
    else if (isIsoDate(c.swung) && (daysFromTo(c.swung, c.expires) ?? 0) <= 0) err('compass', `${p}.expires`, `${c.name}: expires before it was swung.`);
    else {
      const st = cardStatus(c, today, cardWarnDays);
      if (st.state === 'expired') warn('compass', `${p}.expires`, `${c.name}: expired ${-st.days!} days ago.`);
      else if (st.state === 'expiring') warn('compass', `${p}.expires`, `${c.name}: expires in ${st.days} days.`);
    }
    if (c.points.length < 2) err('compass', `${p}.points`, `${c.name || 'Card'}: needs at least two headings.`);
    const fors = c.points.map((q) => q[0]);
    if (c.points.some(([fo, s]) => !fin(fo) || !fin(s) || fo < 0 || fo >= 360 || s < 0 || s >= 360)) err('compass', `${p}.points`, `${c.name || 'Card'}: headings must be 0–359°.`);
    else if (new Set(fors).size !== fors.length) err('compass', `${p}.points`, `${c.name || 'Card'}: a heading is listed twice.`);
    else if (c.points.some(([fo, s]) => Math.abs(deviationOf(fo, s)) > 10)) warn('compass', `${p}.points`, `${c.name}: a deviation is over 10°; check the card.`);
  });
  if (!a.compassCards.length) warn('compass', 'compassCards', 'No compass card: compass headings equal magnetic headings.');

  return out;
}

/** Issues of one field path (exact) or under it (prefix + '.'). */
export function issuesAt(issues: Issue[], path: string, exact = false): Issue[] {
  return issues.filter((i) => i.path === path || (!exact && i.path.startsWith(path + '.')));
}
