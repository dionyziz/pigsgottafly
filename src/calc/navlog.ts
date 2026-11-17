// The navlog: times, winds, WCA/TH/MH/DEV/CH/GS/ETE/fuel per leg.
//
// Rules (PLAN-v3 "Calculations", ported from the v2 app js/app.js calc()):
//   - block start + taxi out = take-off; legs flown in sequence; landing + taxi in = block stop.
//   - first and last legs at pattern TAS, the others at cruise TAS (LegOverride.tasKt wins); a
//     single-leg route is both first and last, so pattern TAS. Legs into and out of an
//     intermediate aerodrome with a touch-and-go or stop request (NavlogInput.patternLegs) are at
//     pattern TAS too, and a stop's minutes on the ground (groundAfterLegMin) are added to the
//     timeline after the leg that lands there; so is the circuit between a touch-and-go and a full
//     stop at the same aerodrome (circuitAfterLegMin), whose fuel is added to the trip fuel.
//   - wind/temperature per leg sampled at the leg midpoint, leg altitude and mid-leg time; since GS
//     depends on the wind and the mid-leg time on GS, iterate (4 passes, as v2). The sampled wind
//     is rounded as written on the sheet (direction 1..360, speed kt) before the wind triangle.
//   - variation per leg from WMM2025 at the midpoint on the flight date (LegGeometry.variation);
//     deviation from the compass card.
//   - rounding as on the paper sheet: nav.computeLeg(); totals with nav.summarize().
//   - trip fuel = Σ leg fuel (each rounded up); fuel total on the sheet = trip + taxi allowance
//     (× (1 + intermediate full stops): each stop is another start-up, taxi and take-off).
//   - the timeline (leg start/end, landing, block stop) uses the unrounded leg minutes (as v2); the
//     written ETE column rounds each leg.
//   - sunset at the destination (AIP GEN 2.7 tables when given, else NOAA).
import type { RefSunTable } from '../shared/ref.js';
import type { ClockUtc, CompassCard, IsoDate, LegOverride } from '../shared/types.js';
import type { LegGeometry } from './legs.js';
import type { ComputedLeg, NavTotals } from './nav.js';
import { computeLeg, fmtClock, norm360, parseClock, summarize } from './nav.js';
import { sunsetMinutes } from './sun.js';

/** Wind/temperature at a point; dir = FROM, true. */
export interface WindSample {
  dirDeg: number;
  speedKt: number;
  tempC: number;
}

/**
 * Synchronous wind lookup over data fetched beforehand (src/data/weather.ts builds one from the
 * Open-Meteo responses). legIndex lets the provider use per-leg midpoint data.
 * Returns null when there is no data (the leg is then computed with calm wind and flagged).
 */
export type WindProvider = (q: {
  legIndex: number;
  lat: number;
  lon: number;
  altFt: number;
  timeMs: number;
}) => WindSample | null;

export interface NavlogAircraft {
  cruiseTasKt: number;
  patternTasKt: number;
  /** Planning burn, L/h. */
  burnLph: number;
  /** Fixed start-up/taxi/take-off/landing allowance, L. */
  taxiAllowanceL: number;
  /** Compass card points, or null (no DEV/CH columns). */
  card: [number, number][] | null;
  /** Expiry of the card used (CompassCard.expires); a warning is raised when expired on the flight date. */
  cardExpires?: IsoDate | null;
  /** Name of the card used, for the warning text. */
  cardName?: string | null;
}

export interface NavlogInput {
  date: IsoDate;
  /** Block-off 'HH:MM' UTC; '' → 12:00 assumed and NavlogResult.blockOffSet = false. */
  blockOff: ClockUtc;
  /** Minutes; null = not set (0 used, with a warning). */
  taxiOutMin: number | null;
  taxiInMin: number | null;
  legs: LegGeometry[];
  /** Effective altitude of each leg, ft (default or override); NaN = unknown. */
  altitudesFt: number[];
  /** Per-leg overrides, indexed like legs (altFt is ignored here: use altitudesFt). */
  overrides: (LegOverride | undefined)[];
  aircraft: NavlogAircraft;
  winds: WindProvider | null;
  /** AIP GEN 2.7 sunset tables (REF SUN_TABLES); omitted → NOAA sunset. */
  sunTables?: Record<string, RefSunTable>;
  /** Per leg: also flown at pattern TAS (touch-and-go / stop requests: requestTiming()). */
  patternLegs?: boolean[];
  /** Per leg: minutes on the ground after the leg (intermediate stops). */
  groundAfterLegMin?: number[];
  /** Per leg: minutes of the circuit after a touch-and-go at the leg's end, before the full-stop landing there. */
  circuitAfterLegMin?: number[];
}

/** The circuit between a touch-and-go and the full-stop landing at the end of leg `afterLeg`. */
export interface NavlogCircuit {
  afterLeg: number;
  /** Minutes after 00:00 UTC of the flight date: the touch-and-go and the full-stop landing. */
  startMin: number;
  endMin: number;
  /** Whole litres (rounded up, as a leg). */
  fuel: number;
}

export interface NavlogLeg extends ComputedLeg {
  index: number;
  altFt: number;
  tasKt: number;
  /** Wind used (FROM, true) and speed, as written (rounded). NaN if none. */
  windDirDeg: number;
  windKt: number;
  tempC: number;
  /** True when no forecast was available and no override given (calm wind assumed). */
  windMissing: boolean;
  /** Where the wind came from. */
  windSource: 'forecast' | 'override' | 'none';
  /** Magnetic course, rounded, as on the map label (1..360). */
  mc: number;
  /** Variation used, E positive (unrounded; the sheet's VAR column is −round(variation)). */
  variation: number;
  /** Minutes after 00:00 UTC of the flight date: start and end of the leg (unrounded). */
  startMin: number;
  endMin: number;
}

export interface NavlogResult {
  legs: NavlogLeg[];
  /** dist, ete, tripFuel, fuel = tripFuel + taxi allowance. */
  totals: NavTotals;
  /** Minutes after 00:00 UTC of the flight date (may exceed 1440 past midnight). */
  times: { blockOffMin: number; takeoffMin: number; landingMin: number; blockOnMin: number };
  /** Unrounded flight time, take-off → landing, minutes. */
  flightMin: number;
  /** Circuits after a touch-and-go before a full stop at the same aerodrome (their fuel is in totals.tripFuel). */
  circuits: NavlogCircuit[];
  blockOffSet: boolean;
  /** Sunset at the destination, minutes after 00:00 UTC of the flight date; null if unknown. */
  sunsetMin: number | null;
  /** Human-readable warnings: missing winds, crosswind > TAS, unknown altitude… */
  warnings: string[];
  /** The warnings about one leg ('A → B: TAS not set.'): their leg and their text without 'A → B: '. */
  legWarnings: { legIndex: number; text: string; detail: string }[];
}

/** The card a flight uses: FlightOptions.compassCard by name, else the aircraft's first card. */
export function pickCompassCard(
  cards: CompassCard[] | null | undefined,
  name: string | null | undefined,
): CompassCard | null {
  if (!cards || !cards.length) return null;
  return (name ? cards.find((c) => c.name === name) : undefined) ?? cards[0];
}

/** NavlogAircraft from the hangar record, the chosen card and the flight's taxi allowance (null = the aircraft's). */
export function navlogAircraft(
  a: {
    cruiseTasKt: number;
    patternTasKt: number;
    fuel: { burnLph: number; taxiAllowanceL: number };
    compassCards: CompassCard[];
  },
  cardName: string | null = null,
  taxiAllowanceL: number | null = null,
): NavlogAircraft {
  const card = pickCompassCard(a.compassCards, cardName);
  return {
    cruiseTasKt: a.cruiseTasKt,
    patternTasKt: a.patternTasKt,
    burnLph: a.fuel.burnLph,
    taxiAllowanceL: taxiAllowanceL ?? a.fuel.taxiAllowanceL,
    card: card && card.points.length ? card.points : null,
    cardExpires: card ? card.expires : null,
    cardName: card ? card.name : null,
  };
}

const PASSES = 4;
const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

/**
 * Computes the whole navlog. Pure and synchronous.
 */
export function computeNavlog(input: NavlogInput): NavlogResult {
  const { legs, aircraft: ac } = input;
  const n = legs.length;
  const warnings: string[] = [];

  const bo = parseClock(input.blockOff);
  const blockOffSet = isFinite(bo);
  const blockOffMin = blockOffSet ? bo : 12 * 60;
  if (n && !blockOffSet) warnings.push('Block start time not set: 12:00Z assumed.');
  const taxiOut = fin(input.taxiOutMin) && input.taxiOutMin >= 0 ? input.taxiOutMin : 0;
  const taxiIn = fin(input.taxiInMin) && input.taxiInMin >= 0 ? input.taxiInMin : 0;
  if (n && !fin(input.taxiOutMin)) warnings.push('Taxi-out time not set: 0 min used.');
  if (n && !fin(input.taxiInMin)) warnings.push('Taxi-in time not set: 0 min used.');
  const takeoffMin = blockOffMin + taxiOut;
  const dayMs = input.date ? Date.parse(input.date + 'T00:00:00Z') : NaN;
  if (n && !isFinite(dayMs)) warnings.push('Flight date not set: winds cannot be looked up.');
  if (n && !input.winds) warnings.push('No winds aloft forecast: calm wind assumed.');
  if (n && !(ac.burnLph > 0)) warnings.push('Aircraft burn rate not set: leg fuel cannot be computed.');

  const tas = legs.map((_, i) => {
    const o = input.overrides[i]?.tasKt;
    if (fin(o) && o > 0) return o;
    return i === 0 || i === n - 1 || input.patternLegs?.[i] ? ac.patternTasKt : ac.cruiseTasKt;
  });
  const alt = legs.map((_, i) => (fin(input.altitudesFt[i]) ? input.altitudesFt[i] : NaN));

  let rows: NavlogLeg[] = [];
  for (let pass = 0; pass < PASSES; pass++) {
    let t = takeoffMin;
    const prev = rows;
    rows = legs.map((L, i) => {
      const o = input.overrides[i] ?? {};
      const startMin = t;
      const guess =
        prev[i] && fin(prev[i].minutesExact) ? prev[i].minutesExact : tas[i] > 0 ? (L.distNm / tas[i]) * 60 : 0;
      const timeMs = dayMs + (startMin + guess / 2) * 60000;
      let w: WindSample | null = null;
      if (input.winds && isFinite(alt[i]) && isFinite(timeMs)) {
        w = input.winds({ legIndex: i, lat: L.mid.lat, lon: L.mid.lon, altFt: alt[i], timeMs });
        if (w && !(fin(w.dirDeg) && fin(w.speedKt))) w = null;
      }
      const wd = fin(o.windDirDeg) ? o.windDirDeg : w ? Math.round(w.dirDeg) % 360 || 360 : NaN;
      const ws = fin(o.windKt) ? o.windKt : w ? Math.round(w.speedKt) : NaN;
      const tempC = fin(o.tempC) ? o.tempC : w && fin(w.tempC) ? Math.round(w.tempC) : NaN;
      const overridden = fin(o.windDirDeg) && fin(o.windKt);
      const windMissing = !w && !overridden;
      const r = computeLeg(
        { tc: L.tcTrue, dist: L.distNm, tas: tas[i], wd: isFinite(wd) ? wd : 0, ws: isFinite(ws) ? ws : 0 },
        { variation: L.variation, card: ac.card, fuelPerHour: ac.burnLph > 0 ? ac.burnLph : 0 },
      );
      if (!(ac.burnLph > 0)) delete r.fuel;
      const flown = fin(r.minutesExact) ? r.minutesExact : tas[i] > 0 ? (L.distNm / tas[i]) * 60 : 0;
      t = startMin + flown;
      const endMin = t;
      const circuit = input.circuitAfterLegMin?.[i];
      if (fin(circuit) && circuit > 0 && i < n - 1) t += circuit;
      const ground = input.groundAfterLegMin?.[i];
      if (fin(ground) && ground > 0 && i < n - 1) t += ground;
      return {
        ...r,
        index: i,
        altFt: alt[i],
        tasKt: tas[i],
        windDirDeg: wd,
        windKt: ws,
        tempC,
        windMissing,
        windSource: overridden ? 'override' : w ? 'forecast' : fin(o.windDirDeg) || fin(o.windKt) ? 'override' : 'none',
        mc: norm360(Math.round(L.mcMag)) || 360,
        variation: L.variation,
        startMin,
        endMin,
      };
    });
  }

  // One start-up/taxi/take-off/landing allowance, plus one per intermediate full stop (a leg
  // followed by ground time), as planFuel({ stops }).
  const stops = n ? (input.groundAfterLegMin ?? []).slice(0, n - 1).filter((m) => fin(m) && m > 0).length : 0;
  const circuits: NavlogCircuit[] = [];
  rows.forEach((r, i) => {
    const c = input.circuitAfterLegMin?.[i];
    if (fin(c) && c > 0 && i < n - 1)
      circuits.push({
        afterLeg: i,
        startMin: r.endMin,
        endMin: r.endMin + c,
        fuel: ac.burnLph > 0 ? Math.ceil((ac.burnLph * c) / 60) : 0,
      });
  });
  const circuitFuel = circuits.reduce((s, c) => s + c.fuel, 0);
  const totals = summarize(rows, (ac.taxiAllowanceL || 0) * (1 + stops));
  totals.tripFuel += circuitFuel;
  totals.fuel += circuitFuel;
  const landingMin = n ? rows[n - 1].endMin : takeoffMin;
  const blockOnMin = landingMin + taxiIn;

  const legWarnings: NavlogResult['legWarnings'] = [];
  rows.forEach((r, i) => {
    const name = `${legs[i].from.name || '?'} → ${legs[i].to.name || '?'}`;
    const warn = (detail: string) => {
      const text = `${name}: ${detail}`;
      warnings.push(text);
      legWarnings.push({ legIndex: i, text, detail });
    };
    if (!isFinite(r.altFt)) warn('altitude unknown (enter one).');
    if (r.wca === undefined) warn('crosswind exceeds TAS; leg cannot be flown as planned.');
    else if (!(fin(r.gs) && r.gs > 0)) warn('ground speed is zero or negative.');
    if (input.winds && r.windMissing && isFinite(r.altFt) && isFinite(dayMs))
      warn('no wind forecast; calm wind assumed.');
    if (!(r.tasKt > 0)) warn('TAS not set.');
  });

  let sunsetMin: number | null = null;
  if (n && input.date && isFinite(dayMs)) {
    sunsetMin = sunsetMinutes(input.date, legs[n - 1].to, input.sunTables ?? {});
    if (sunsetMin !== null && blockOffSet && landingMin > sunsetMin)
      warnings.push(
        `Landing at ${fmtClock(landingMin)}Z is after sunset (${fmtClock(sunsetMin)}Z) at ${legs[n - 1].to.name}.`,
      );
  }
  if (n && ac.cardExpires && input.date && ac.cardExpires < input.date)
    warnings.push(
      `Compass card${ac.cardName ? ` "${ac.cardName}"` : ''} expired on ${ac.cardExpires}: swing required.`,
    );

  return {
    legs: rows,
    totals,
    times: { blockOffMin, takeoffMin, landingMin, blockOnMin },
    flightMin: landingMin - takeoffMin,
    circuits,
    blockOffSet,
    sunsetMin,
    warnings,
    legWarnings,
  };
}
