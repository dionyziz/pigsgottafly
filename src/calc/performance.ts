// Take-off and landing performance (MD 4.4): runway from the wind, wind components, PA/DA, AFM table
// interpolation with corrections and club factors, compared with the declared distances.
//
// Two methods (PerfMethod), both on the same AFM tables (data/aircraft/reims-f172m.json):
//
//   'da' (default; was 'club'): the Aeroclub Mesogeion MD 4.4 method, reverse-engineered from 90 answers of
//     its online calculator (tests/fixtures/club-wbp-cases.json, tests/unit/calc/club.test.ts):
//       - enter the AFM table at the DENSITY altitude (the MD 4.4 sheet lists DA), no separate
//         temperature correction; DA below 0 ft uses the 0 ft column;
//       - interpolate (and above the heaviest row, extrapolate) linearly in mass; take-off uses the
//         zero-wind column;
//       - headwind: −10 % per 5 kt for BOTH take-off and landing (the AFM landing-table note; the
//         club does not use the take-off table's 10/20 kt columns, which give shorter distances);
//       - condition factor = RWYCC/grass factor × (1 + 0.05 × adverse slope %) (printed rounded);
//       - safety factor 1.33 (take-off) / 1.43 (landing).
//     One deliberate difference: the club uses |headwind component|, so a tailwind is credited as
//     a headwind (a bug). We apply the tailwind rule below instead.
//
//   'afm': the AFM method: enter the table at PRESSURE altitude, interpolate mass, altitude and
//     the take-off table's headwind columns (0/10/20 kt; no credit beyond the last column),
//     +10 % per 15 °C above the table's standard temperature (proportional), landing −10 % per
//     5 kt headwind; then the same club condition, slope and safety factors.
//
// aerodromePerformance (one MD 4.4 block), when no method is forced, computes BOTH methods for both
// take-off and landing and uses the longer distance (TODR, or LDR); the other is returned as
// `alternative` so the pilot sees both. Neither method is always the longer one:
//   - hot day: the AFM's +10 %/15 °C at PA is longer than the club's table-at-DA landing figure;
//   - cold day: the club enters the table at DA, which is BELOW PA (e.g. LGKZ 2165 ft at −10 °C:
//     DA ≈ −310 ft), while the AFM gives no credit for cold, so the AFM take-off distance is up to
//     ~20 % longer (TODR 754 m vs 618 m at 1043 kg, calm);
//   - headwind: the club's −10 %/5 kt is less generous than the AFM's 10/20 kt take-off columns,
//     so the club figure is the longer one.
//
// Both methods: TAILWIND (no AFM data): +10 % per 2 kt of tailwind (the usual Cessna POH rule),
// warned above 10 kt. Headwind credit is capped at 50 % (25 kt). Below the lightest table mass the
// lightest row is used; below 0 ft the 0 ft column is used (no extrapolation to shorter distances).
// The AFM grass increments (+7 %/+20 % of the total) are NOT added: the club's surface factors
// (short dry grass ×1.2, …) replace them.
import type { PerformanceTables, DistancePair } from '../shared/types.js';
import type { RefRunway } from '../shared/ref.js';
import { norm180, norm360, rad } from './nav.js';

/** 'da': AFM table at density altitude with the planning factors (the default); 'afm': the AFM method at pressure altitude. */
export type PerfMethod = 'da' | 'afm';
export const DEFAULT_PERF_METHOD: PerfMethod = 'da';

export interface WindComponents {
  /** Positive = headwind, negative = tailwind, kt. */
  headwindKt: number;
  /** Magnitude, kt. */
  crosswindKt: number;
  /** Side the crosswind comes from ('' when calm). */
  crossFrom: 'L' | 'R' | '';
}

/**
 * Head/crosswind on a runway. Use the same reference for both angles (both magnetic, or both true).
 * @param runwayHdgDeg runway heading
 * @param windDirDeg direction the wind blows FROM
 */
export function windComponents(runwayHdgDeg: number, windDirDeg: number, windKt: number): WindComponents {
  if (!(windKt > 0)) return { headwindKt: 0, crosswindKt: 0, crossFrom: '' };
  const a = rad(norm180(windDirDeg - runwayHdgDeg));
  const cross = windKt * Math.sin(a);
  return { headwindKt: windKt * Math.cos(a), crosswindKt: Math.abs(cross), crossFrom: cross > 1e-9 ? 'R' : cross < -1e-9 ? 'L' : '' };
}

/**
 * Pressure altitude, ft, from the ISA barometric formula: elevation + the height of the QNH level
 * above the 1013.25 hPa level (145366.45 × (1 − (QNH/1013.25)^0.190284)). About 27.3 ft/hPa near
 * sea level; the club calculator uses the linear 27 ft/hPa from 1013 hPa (agrees within ~15 ft
 * for QNH 990–1035), the "30 ft/hPa" rule of thumb overstates it by ~10 %.
 */
export function pressureAltitudeFt(elevFt: number, qnhHpa: number): number {
  return elevFt + 145366.45 * (1 - Math.pow(qnhHpa / 1013.25, 0.190284));
}

/**
 * QNH from a station pressure: the pressure reduced from the station elevation to sea level through
 * the ISA, i.e. the inverse of pressureAltitudeFt (pressureAltitudeFt(elev, qnh) = the pressure
 * altitude of stationHpa). Used for forecast surface pressure (Open-Meteo surface_pressure at the
 * grid point's elevation).
 */
export function qnhFromStationPressure(stationHpa: number, elevFt: number): number {
  const paStation = 145366.45 * (1 - Math.pow(stationHpa / 1013.25, 0.190284));
  return 1013.25 * Math.pow(1 - (paStation - elevFt) / 145366.45, 1 / 0.190284);
}

/** ISA temperature at a pressure altitude, °C (15 − 1.98/1000 ft). */
export function isaTempC(pressureAltFt: number): number {
  return 15 - (1.98 * pressureAltFt) / 1000;
}

/** Density altitude, ft: PA + 120 ft per °C above ISA (the MD 4.4 / club rule). */
export function densityAltitudeFt(pressureAltFt: number, oatC: number): number {
  return pressureAltFt + 120 * (oatC - isaTempC(pressureAltFt));
}

export interface RunwayChoice {
  runway: RefRunway;
  wind: WindComponents;
}

const runwayHeadingMag = (r: RefRunway): number => {
  if (isFinite(r.headingMagDeg)) return r.headingMagDeg;
  const n = parseInt(r.designator, 10);
  return isFinite(n) ? norm360(n * 10) : 0;
};

/** Wind (true) → components on a runway (magnetic heading), with variation E positive. */
export function runwayWind(runway: RefRunway, wind: { dirTrueDeg: number; speedKt: number } | null, variationDeg: number): WindComponents {
  if (!wind || !(wind.speedKt > 0)) return { headwindKt: 0, crosswindKt: 0, crossFrom: '' };
  return windComponents(runwayHeadingMag(runway), wind.dirTrueDeg - variationDeg, wind.speedKt);
}

/**
 * The runway direction with the most headwind (ties within 0.05 kt: the longer TORA/LDA, then the
 * longer runway), considering only the aerodrome's runways. Wind direction is TRUE (forecast);
 * runway headings are magnetic: pass the variation (E positive) to convert. Calm: the first runway,
 * or `preferred` (a designator) if given.
 */
export function selectRunway(
  runways: RefRunway[],
  wind: { dirTrueDeg: number; speedKt: number } | null,
  variationDeg: number,
  preferred?: string | null,
): RunwayChoice | null {
  if (!runways.length) return null;
  const calm = !wind || !(wind.speedKt > 0);
  if (calm) {
    const r = (preferred && runways.find((x) => x.designator === preferred)) || runways[0];
    return { runway: r, wind: runwayWind(r, wind, variationDeg) };
  }
  const len = (r: RefRunway) => Math.max(r.toraM ?? 0, r.ldaM ?? 0);
  let best: RunwayChoice | null = null;
  for (const r of runways) {
    const w = runwayWind(r, wind, variationDeg);
    if (!best) { best = { runway: r, wind: w }; continue; }
    const d = w.headwindKt - best.wind.headwindKt;
    if (d > 0.05 || (Math.abs(d) <= 0.05 && (len(r) > len(best.runway) || (len(r) === len(best.runway) && (r.lengthM ?? 0) > (best.runway.lengthM ?? 0))))) best = { runway: r, wind: w };
  }
  return best;
}

export interface PerfConditions {
  massKg: number;
  pressureAltFt: number;
  oatC: number;
  /** Positive head, negative tail, kt. */
  headwindKt: number;
  /** Key of PerformanceFactors.runwayCondition, or null for paved dry. */
  surface: string | null;
  /** Slope in the direction of travel, %: positive uphill. */
  slopePct: number;
  /** Default DEFAULT_PERF_METHOD ('da'). */
  method?: PerfMethod;
}

export interface PerfDistances {
  /** AFM figures after interpolation and temperature correction (and wind), m. */
  groundM: number;
  totalM: number;
  /**
   * The table figures as read (interpolated in altitude and mass, and in headwind for the AFM
   * take-off method) BEFORE the wind and temperature factors: groundM = tableGroundM × wind × temperature.
   */
  tableGroundM: number;
  tableTotalM: number;
  /**
   * Each factor applied, for the MD 4.4 printout. wind: headwind/tailwind factor (1 in the AFM
   * take-off method, where the headwind is a table column); condition = surface × slope.
   */
  factors: { temperature: number; surface: number; slope: number; safety: number; wind?: number; condition?: number };
  /** After all factors: TORR/TODR (take-off) or LDR (landing; groundM = landing roll), m. */
  requiredGroundM: number;
  requiredTotalM: number;
  /** Conditions outside the AFM table (extrapolated). */
  extrapolated: boolean;
  /** Method used; the altitude the table was entered at (PA or DA), ft. */
  method?: PerfMethod;
  tableAltFt?: number;
  /** Notes such as 'tailwind above 10 kt', 'unknown surface'. */
  notes?: string[];
}

/** Linear interpolation of y over sorted xs; clamps below xs[0] when clampLow, extrapolates above. */
function interp1(xs: number[], ys: number[], x: number, clampLow: boolean, clampHigh: boolean): { y: number; extrapolated: boolean } {
  const n = xs.length;
  if (n === 0) return { y: NaN, extrapolated: true };
  if (n === 1) return { y: ys[0], extrapolated: x !== xs[0] };
  if (x <= xs[0]) {
    if (clampLow || x === xs[0]) return { y: ys[0], extrapolated: false };
    const t = (x - xs[0]) / (xs[1] - xs[0]);
    return { y: ys[0] + t * (ys[1] - ys[0]), extrapolated: true };
  }
  if (x >= xs[n - 1]) {
    if (clampHigh || x === xs[n - 1]) return { y: ys[n - 1], extrapolated: false };
    const t = (x - xs[n - 2]) / (xs[n - 1] - xs[n - 2]);
    return { y: ys[n - 2] + t * (ys[n - 1] - ys[n - 2]), extrapolated: true };
  }
  let i = 0;
  while (x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return { y: ys[i] + t * (ys[i + 1] - ys[i]), extrapolated: false };
}

function interpPair(xs: number[], pairs: DistancePair[], x: number): { v: DistancePair; extrapolated: boolean } {
  const g = interp1(xs, pairs.map((p) => p[0]), x, true, false);
  const t = interp1(xs, pairs.map((p) => p[1]), x, true, false);
  return { v: [g.y, t.y], extrapolated: g.extrapolated || t.extrapolated };
}

/** Condition factors (surface × slope). */
function conditionFactors(tables: PerformanceTables, surface: string | null, adverseSlopePct: number, notes: string[]) {
  let s = 1;
  if (surface) {
    const f = tables.factors.runwayCondition[surface];
    if (f == null) notes.push(`Unknown runway condition "${surface}": factor 1.0 used.`);
    else s = f;
  }
  const per2 = tables.factors.slopeFactorPer2Pct || 1;
  // Linear: the club's 1.1 per 2 % is 1 + 0.05 per 1 % (3 % upslope = ×1.15, not 1.1^1.5).
  const slope = 1 + ((per2 - 1) / 2) * Math.max(0, adverseSlopePct);
  // The club prints the product rounded to 0.01 (1.15 × 1.05 → "1.21") but computes with the
  // unrounded 1.2075; so do we.
  return { surface: s, slope, condition: s * slope };
}

/** Headwind (+) / tailwind (−) factor on distances; headwind credit 'per5' per 5 kt. */
function windFactor(headwindKt: number, per5: number, notes: string[]): number {
  if (headwindKt < 0) {
    const tail = -headwindKt;
    if (tail > 10) notes.push(`Tailwind ${tail.toFixed(1)} kt: above 10 kt, no data (distance +10 % per 2 kt extrapolated).`);
    return 1 + 0.05 * tail;
  }
  return Math.max(0.5, 1 - (per5 * headwindKt) / 5);
}

function tempFactor(tableAlts: number[], stdTemps: number[], pa: number, oat: number, per15: number): number {
  const std = stdTemps.length === tableAlts.length && stdTemps.length ? interp1(tableAlts, stdTemps, pa, false, false).y : isaTempC(pa);
  return 1 + per15 * Math.max(0, oat - std) / 15;
}

function finish(tableGroundM: number, tableTotalM: number, f: { temperature: number; wind: number }, cond: { surface: number; slope: number; condition: number }, safety: number, extrapolated: boolean, method: PerfMethod, tableAltFt: number, notes: string[]): PerfDistances {
  const groundM = tableGroundM * (f.temperature * f.wind);
  const totalM = tableTotalM * (f.temperature * f.wind);
  return {
    groundM,
    totalM,
    tableGroundM,
    tableTotalM,
    factors: { temperature: f.temperature, surface: cond.surface, slope: cond.slope, safety, wind: f.wind, condition: cond.condition },
    requiredGroundM: groundM * cond.condition * safety,
    requiredTotalM: totalM * cond.condition * safety,
    extrapolated,
    method,
    tableAltFt,
    notes,
  };
}

/** TORR (requiredGroundM) and TODR (requiredTotalM). */
export function takeoffDistances(tables: PerformanceTables, c: PerfConditions): PerfDistances {
  const method = c.method ?? DEFAULT_PERF_METHOD;
  const t = tables.takeoff;
  const notes: string[] = [];
  const rows = [...t.rows].sort((a, b) => a.massKg - b.massKg);
  if (!rows.length || !t.altitudesFt.length) throw new Error('no take-off table');
  const masses = rows.map((r) => r.massKg);
  const alt = method === 'da' ? densityAltitudeFt(c.pressureAltFt, c.oatC) : c.pressureAltFt;
  let extrapolated = alt > t.altitudesFt[t.altitudesFt.length - 1] || c.massKg > masses[masses.length - 1];

  /** Distances for headwind column index hi, at (mass, alt). */
  const atColumn = (hi: number): DistancePair => {
    const perMass = rows.map((r) => interpPair(t.altitudesFt, r.distances[hi], alt).v);
    const g = interp1(masses, perMass.map((p) => p[0]), c.massKg, true, false).y;
    const tt = interp1(masses, perMass.map((p) => p[1]), c.massKg, true, false).y;
    return [g, tt];
  };

  let ground: number, total: number, temperature = 1, wind = 1;
  if (method === 'da') {
    [ground, total] = atColumn(0);
    wind = windFactor(c.headwindKt, tables.landing.headwindDecreasePer5Kt || 0.1, notes);
  } else {
    const cols = rows[0].headwindKt;
    if (c.headwindKt > 0) {
      const hw = Math.min(c.headwindKt, cols[cols.length - 1]);
      const pairs = cols.map((_, i) => atColumn(i));
      ground = interp1(cols, pairs.map((p) => p[0]), hw, true, true).y;
      total = interp1(cols, pairs.map((p) => p[1]), hw, true, true).y;
    } else {
      [ground, total] = atColumn(0);
      wind = windFactor(c.headwindKt, 0.1, notes);
    }
    temperature = tempFactor(t.altitudesFt, t.standardTempC, c.pressureAltFt, c.oatC, t.tempIncreasePer15C);
  }
  if (c.headwindKt < -10) extrapolated = true;
  const cond = conditionFactors(tables, c.surface, c.slopePct, notes);
  return finish(ground, total, { temperature, wind }, cond, tables.factors.safetyFactorTakeoff || 1, extrapolated, method, alt, notes);
}

/** LRR (requiredGroundM) and LDR (requiredTotalM). The AFM table is for the maximum mass only. */
export function landingDistances(tables: PerformanceTables, c: PerfConditions): PerfDistances {
  const method = c.method ?? DEFAULT_PERF_METHOD;
  const l = tables.landing;
  const notes: string[] = [];
  if (!l.altitudesFt.length) throw new Error('no landing table');
  const alt = method === 'da' ? densityAltitudeFt(c.pressureAltFt, c.oatC) : c.pressureAltFt;
  const p = interpPair(l.altitudesFt, l.distances, alt);
  let extrapolated = p.extrapolated || c.headwindKt < -10;
  if (l.massKg > 0 && c.massKg > l.massKg + 1e-9) { extrapolated = true; notes.push(`Landing mass above the table mass ${l.massKg} kg.`); }
  const wind = windFactor(c.headwindKt, l.headwindDecreasePer5Kt || 0.1, notes);
  const temperature = method === 'da' ? 1 : tempFactor(l.altitudesFt, l.standardTempC, c.pressureAltFt, c.oatC, l.tempIncreasePer15C);
  const ground = p.v[0];
  const total = p.v[1];
  // Downhill is adverse for landing.
  const cond = conditionFactors(tables, c.surface, -c.slopePct, notes);
  return finish(ground, total, { temperature, wind }, cond, tables.factors.safetyFactorLanding || 1, extrapolated, method, alt, notes);
}

export interface AerodromePerfInput {
  phase: 'takeoff' | 'landing';
  aerodromeElevFt: number;
  runways: RefRunway[];
  /**
   * Surface wind (true) at the time of take-off/landing; null = unknown (calm assumed, flagged).
   * dirTrueDeg null with a speed = variable (VRB): no runway choice from it, no headwind credit,
   * and the whole speed counts as crosswind. gustKt: the crosswind limit is checked against the
   * gust's crosswind component as well (the distances use the mean wind).
   */
  wind: SurfaceWind | null;
  qnhHpa: number;
  oatC: number;
  variationDeg: number;
  massKg: number;
  tables: PerformanceTables;
  /** Runway forced by the pilot (FlightOptions.departureRunway/arrivalRunway). */
  runway: string | null;
  surface: string | null;
  /**
   * Omitted: BOTH methods and the longer distance is used (TODR for take-off, LDR for landing;
   * see the header: the club method is shorter than the AFM on hot days for landing and on cold
   * days for take-off). Given: that method only.
   */
  method?: PerfMethod;
}

export interface SurfaceWind {
  /** FROM, true; null = variable (VRB) or, with speed 0, calm. */
  dirTrueDeg: number | null;
  speedKt: number;
  gustKt?: number | null;
}

export interface AerodromePerf {
  runway: RefRunway | null;
  wind: WindComponents;
  pressureAltFt: number;
  densityAltFt: number;
  isaDevC: number;
  distances: PerfDistances | null;
  /** Available: TORA/TODA (take-off) or LDA (landing), m; null if unpublished. */
  availableGroundM: number | null;
  availableTotalM: number | null;
  /** available − required (m), null if unknown; negative = does not fit. */
  marginM: number | null;
  crosswindOk: boolean;
  /** Crosswind component of the gust, kt (null without a gust above the mean). */
  crosswindGustKt: number | null;
  /** The wind was variable (VRB): crosswind = its whole speed, no headwind credit. */
  variableWind: boolean;
  tailwind: boolean;
  /**
   * No method given: the other method's result (the one not used because it is shorter), for
   * display next to the one used. Null when a method was forced.
   */
  alternative: PerfDistances | null;
  warnings: string[];
}

/**
 * Slope for the distances (%, + = uphill in the direction of travel). When the AIP gives only an
 * unsigned value (slopeUnsignedPct), it is applied as adverse: uphill for take-off, downhill for landing.
 */
export function slopeForPhase(runway: RefRunway | null, takeoff: boolean): number | null {
  if (!runway) return null;
  if (runway.slopePct != null) return runway.slopePct;
  const u = runway.slopeUnsignedPct;
  if (u != null && u > 0) return takeoff ? u : -u;
  return null;
}

const isGrass = (s: string | null) => !!s && /GRASS|GRS|TURF|GRAVEL|DIRT|EARTH|SOIL/i.test(s);

/** Everything for one MD 4.4 block. */
export function aerodromePerformance(input: AerodromePerfInput): AerodromePerf {
  const warnings: string[] = [];
  const pa = pressureAltitudeFt(input.aerodromeElevFt, input.qnhHpa);
  const da = densityAltitudeFt(pa, input.oatC);
  const isaDevC = input.oatC - isaTempC(pa);
  const takeoff = input.phase === 'takeoff';

  const w = input.wind;
  const variableWind = !!w && w.dirTrueDeg == null && w.speedKt > 0.5;
  const meanWind = w && w.dirTrueDeg != null && w.speedKt > 0 ? { dirTrueDeg: w.dirTrueDeg, speedKt: w.speedKt } : null;
  const gustKt = w && w.gustKt != null && isFinite(w.gustKt) && w.gustKt > w.speedKt ? w.gustKt : null;

  let runway: RefRunway | null = null;
  let wind: WindComponents = { headwindKt: 0, crosswindKt: 0, crossFrom: '' };
  if (input.runway) {
    runway = input.runways.find((r) => r.designator === input.runway) ?? null;
    if (!runway) warnings.push(`Runway ${input.runway} is not in the aerodrome data.`);
    else wind = runwayWind(runway, meanWind, input.variationDeg);
  }
  if (!runway) {
    const ch = selectRunway(input.runways, meanWind, input.variationDeg, null);
    if (ch) { runway = ch.runway; wind = ch.wind; }
  }
  if (!runway) {
    warnings.push('No runway data for this aerodrome.');
    if (meanWind) wind = { headwindKt: 0, crosswindKt: meanWind.speedKt, crossFrom: '' };
  }
  if (!w) warnings.push('No surface wind: calm assumed.');
  // Variable wind: may come from any side. Whole speed as crosswind, no headwind credit.
  if (variableWind && w) {
    wind = { headwindKt: 0, crosswindKt: w.speedKt, crossFrom: '' };
    warnings.push(`Variable wind ${Math.round(w.speedKt)} kt${gustKt ? ` gusting ${Math.round(gustKt)} kt` : ''}: runway not chosen from the wind, full crosswind and no headwind assumed.`);
  }
  let crosswindGustKt: number | null = null;
  if (gustKt != null) {
    if (variableWind || !runway) crosswindGustKt = gustKt;
    else if (meanWind) crosswindGustKt = runwayWind(runway, { dirTrueDeg: meanWind.dirTrueDeg, speedKt: gustKt }, input.variationDeg).crosswindKt;
  }

  const tailwind = wind.headwindKt < -0.05;
  const xLimit = takeoff ? input.tables.factors.maxCrosswindKt?.takeoff : input.tables.factors.maxCrosswindKt?.landing;
  const xMax = Math.max(wind.crosswindKt, crosswindGustKt ?? 0);
  const crosswindOk = !(xLimit != null && xMax > xLimit + 1e-9);
  if (!crosswindOk) {
    const gustPart = crosswindGustKt != null && crosswindGustKt > wind.crosswindKt ? `, ${crosswindGustKt.toFixed(1)} kt in gusts,` : '';
    warnings.push(`Crosswind ${wind.crosswindKt.toFixed(1)} kt${gustPart} exceeds the ${takeoff ? 'take-off' : 'landing'} limit of ${xLimit} kt.`);
  }
  if (tailwind) warnings.push(`Tailwind ${(-wind.headwindKt).toFixed(1)} kt${runway ? ` on runway ${runway.designator}` : ''}.`);

  let surface = input.surface;
  if (!surface && runway && isGrass(runway.surface)) {
    const fallback = Object.keys(input.tables.factors.runwayCondition).find((k) => /short dry grass/i.test(k)) ?? null;
    surface = fallback;
    warnings.push(`Runway ${runway.designator} is ${runway.surface}: choose the surface condition${fallback ? ` (${fallback} assumed)` : ''}.`);
  }

  let distances: PerfDistances | null = null;
  let alternative: PerfDistances | null = null;
  try {
    const cond: PerfConditions = {
      massKg: input.massKg,
      pressureAltFt: pa,
      oatC: input.oatC,
      headwindKt: wind.headwindKt,
      surface,
      slopePct: slopeForPhase(runway, takeoff) ?? 0,
      method: input.method,
    };
    const compute = takeoff ? takeoffDistances : landingDistances;
    if (input.method) distances = compute(input.tables, cond);
    else {
      // Both methods; the longer TODR / LDR is used (conservative), the other is kept for display.
      // (Take-off: TODR and TORR come from the same table row, so they order the same way.)
      const da = compute(input.tables, { ...cond, method: 'da' });
      const afm = compute(input.tables, { ...cond, method: 'afm' });
      const afmLonger = afm.requiredTotalM > da.requiredTotalM + 1e-9;
      distances = afmLonger ? afm : da;
      alternative = afmLonger ? da : afm;
    }
    warnings.push(...(distances.notes || []));
    if (distances.extrapolated) warnings.push('Outside the AFM table: distances extrapolated.');
  } catch {
    warnings.push('No performance tables for this aircraft.');
  }
  if (runway && runway.slopePct == null) {
    const u = runway.slopeUnsignedPct;
    if (u != null && u > 0) warnings.push(`Slope of runway ${runway.designator} published as ${u} % without direction: ${takeoff ? 'upslope' : 'downslope'} (adverse) assumed.`);
    else warnings.push(`Slope of runway ${runway.designator} unknown: none assumed.`);
  }

  let availableGroundM: number | null = null;
  let availableTotalM: number | null = null;
  if (runway) {
    if (takeoff) {
      availableGroundM = runway.toraM;
      availableTotalM = runway.todaM ?? runway.toraM;
    } else {
      availableGroundM = runway.ldaM;
      availableTotalM = runway.ldaM;
    }
    if (availableTotalM == null && runway.lengthM != null) {
      availableGroundM = availableTotalM = runway.lengthM;
      warnings.push(`Declared distances of runway ${runway.designator} not published: runway length ${runway.lengthM} m used.`);
    } else if (availableTotalM == null) warnings.push(`Declared distances of runway ${runway.designator} unknown.`);
  }
  let marginM: number | null = null;
  if (distances) {
    const m: number[] = [];
    if (availableTotalM != null) m.push(availableTotalM - distances.requiredTotalM);
    if (takeoff && availableGroundM != null) m.push(availableGroundM - distances.requiredGroundM);
    if (m.length) marginM = Math.min(...m);
    if (marginM != null && marginM < 0) {
      warnings.push(takeoff
        ? `Take-off does not fit: TODR ${Math.round(distances.requiredTotalM)} m / TORR ${Math.round(distances.requiredGroundM)} m vs TODA ${availableTotalM} m / TORA ${availableGroundM} m.`
        : `Landing does not fit: LDR ${Math.round(distances.requiredTotalM)} m vs LDA ${availableTotalM} m.`);
    }
  }

  return { runway, wind, pressureAltFt: pa, densityAltFt: da, isaDevC, distances, availableGroundM, availableTotalM, marginM, crosswindOk, crosswindGustKt, variableWind, tailwind, alternative, warnings };
}
