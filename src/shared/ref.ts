// Shared reference data (AIRAC-tagged, read-only to pilots). The same records ship with the client
// (src/data/ref/*.json, typed by src/data/ref/index.ts) and are seeded into the ref_* tables
// (api/_lib/migrations) for the API. Generated from data/aip.js, data/vfr.js and data/sun.js by
// tools/build_ref.ts.

import type { IsoDate } from './types.js';

export interface RefAirac {
  /** e.g. '2609' (AIRAC AMDT 09/26). */
  id: string;
  /** e.g. 'AIRAC AMDT 09/26 (wef 29 OCT 2026)'. */
  name: string;
  effective: IsoDate;
}

export interface RefFrequency {
  /** AIP service, e.g. 'TWR', 'APP', 'ATIS', 'AFIS', 'G/A/G'. */
  service: string;
  callsign: string;
  /** MHz as printed, e.g. '122.650'. */
  mhz: string;
  /** 'primary' | 'secondary' (backup, RGA). */
  role: string;
  remark: string;
}

export interface RefAerodrome {
  /** ICAO, or an upper-case slug for aerodromes without one (e.g. 'KALAMATA-TRIODHON'). */
  id: string;
  icao: string | null;
  name: string;
  lat: number;
  lon: number;
  elevFt: number | null;
  /** Runway pairs as in the AIP, e.g. ['03/21'], ['08R/26L', '08C/26C']. */
  runways: string[];
  freqs: RefFrequency[];
  /** Aerodrome traffic zones (circles). */
  zones: { radiusNm: number; lat: number; lon: number }[];
  water: boolean;
  /** AIP section, e.g. 'AD 2 LGAV', 'AD 1.6.5'. */
  source: string;
  notes: string;
  /** Operational hours and handling (AD 2.3 / AD 1.6.N.3–4); present in data generated since migration 012. */
  hours?: RefAdHours;
}

// ---------------------------------------------------------------- operational hours (AD 2.3)
// The AIP text is kept verbatim; `parsed` is what src/calc/adHours.ts (parseHours) made of it, and is
// checked against every aerodrome's text by tests/unit/calc/adHours.test.ts.

/** A time of day: minutes after 00:00 UTC, or sunrise / sunset with an offset. */
export type HoursClock = { utc: number } | { sun: 'SR' | 'SS'; offsetMin: number };

/** When a rule applies within its days. */
export type HoursTime =
  /** All day. */
  | { t: 'H24' }
  /** Sunrise to sunset. */
  | { t: 'HJ' }
  /** Sunset to sunrise. */
  | { t: 'HN' }
  /** Hours of service to meet operational requirements: promulgated by NOTAM (AD 1.1.1.4.2.2). */
  | { t: 'HO' }
  /** No specific hours (notified on contact with the AD administration). */
  | { t: 'HX' }
  /** Hours of scheduled operations. */
  | { t: 'HS' }
  /** On request (prior notice). */
  | { t: 'OR' }
  /** During the aerodrome's operating hours (a service such as handling marked HO). */
  | { t: 'AD' }
  /** Not available. */
  | { t: 'NIL' }
  /** Closed on these days (a NOTAM schedule's 'SAT SUN CLSD'). */
  | { t: 'CLSD' }
  | { t: 'window'; from: HoursClock; to: HoursClock };

/** Inclusive date range of a season ('MM-DD'), or the summer / winter time periods (EU daylight saving). */
export type HoursSeason = { from: string; to: string } | 'summer' | 'winter';

export interface HoursRule {
  /** Omitted: all year. */
  season?: HoursSeason;
  /** ISO weekdays (1 = MON … 7 = SUN); omitted: every day. */
  days?: number[];
  /** Greek public holidays (HOL): the rule applies on them (with or without `days`). */
  holidays?: boolean;
  /** The days in `days` exclude public holidays (e.g. 'MON-FRI EXC HOL'). */
  exceptHolidays?: boolean;
  /** One or more periods of the day (several windows are OR-ed). */
  times: HoursTime[];
}

export interface HoursSpec {
  /**
   * Rules in order; at a given instant the first rule whose season and day match decides. No rule
   * matches: closed (for a schedule) — a spec of only H24 / HO / … always matches.
   */
  rules: HoursRule[];
  /** Qualifiers as printed: 'HAF', 'HASP', 'by arrangement', 'O/R', '48H PN', other providers' hours. */
  notes: string[];
  /** The parser could not represent all of the text: shown as the raw text and evaluated as unknown. */
  partial: boolean;
  /** Short summary, e.g. 'H24', 'HJ', 'HO', 'MON-SAT 1000-1700', 'Summer: AD hours'. */
  label: string;
}

export interface RefAdHoursField {
  /** The AIP text, verbatim (lines joined with '\n'). */
  text: string;
  parsed: HoursSpec;
}

export interface RefAdHours {
  /** e.g. 'LGAV AD 2.3', 'AD 1.6.5.3'. */
  source: string;
  /** Item 1, AD administration (operating hours). */
  ad: RefAdHoursField;
  /** Item 7, ATS (null when not published). */
  ats: RefAdHoursField | null;
  /** Item 9, handling; else the AD 1.6.N.4 handling section ('NIL'). */
  handling: RefAdHoursField & { source: string };
  /** Item 2, customs and immigration (null when not published). */
  customs: RefAdHoursField | null;
  /** Item 12, remarks, verbatim ('' = NIL). */
  remarks: string;
}

/**
 * One runway direction with its declared distances (AD 2.12/2.13). null = not published/known. The
 * detail fields (RefRunwayDetail) are present in data generated since migration 005.
 */
export interface RefRunway extends Partial<RefRunwayDetail> {
  aerodromeId: string;
  /** This direction, e.g. '03', '26L'. */
  designator: string;
  /** The opposite direction, e.g. '21'. */
  reciprocal: string;
  /**
   * Magnetic heading: the true heading minus the aerodrome's AIP variation brought to the AIRAC date
   * (the Greek AIP prints no magnetic bearing); designator × 10 only when headingMagSource is 'designator'.
   */
  headingMagDeg: number;
  headingTrueDeg: number | null;
  lengthM: number | null;
  widthM: number | null;
  /** e.g. 'ASPH', 'CONC', 'GRASS'. */
  surface: string | null;
  toraM: number | null;
  todaM: number | null;
  asdaM: number | null;
  ldaM: number | null;
  /** Average slope along this direction, %: positive = uphill. */
  slopePct: number | null;
  /**
   * Published slope whose direction is unknown (the AIP prints the same value, or the same sign, for both
   * directions and gives no threshold elevations), %, ≥ 0. Set only when slopePct is null; performance
   * applies it as ADVERSE in both phases (upslope for take-off, downslope for landing).
   */
  slopeUnsignedPct?: number | null;
  thresholdElevFt: number | null;
}

export interface RefRunwayIntersection {
  toraM: number | null;
  todaM: number | null;
  asdaM: number | null;
  remark: string;
}

/** Provenance and detail fields generated by tools/build_ref_runways.ts (present in src/data/ref/runways.json and ref_runways.doc from migration 005). */
export interface RefRunwayDetail {
  thrLat: number | null;
  thrLon: number | null;
  headingTrueSource: 'aip' | 'thr-coordinates' | null;
  magVarDeg: number | null;
  headingMagSource: 'true-minus-aip-var' | 'true-minus-nearby-aip-var' | 'designator';
  slopeText: string | null;
  slopeSource: 'aip' | 'aip-magnitude-thr-sign' | 'thr-elevations' | 'aip-unsigned' | null;
  thresholdElevSource: 'aip' | 'aerodrome-elevation' | null;
  surfaceText: string | null;
  strength: string | null;
  declaredRemark: string | null;
  intersections: RefRunwayIntersection[];
  /** AIP references, e.g. 'LGKR AD 2.12 (AD 2 LGKR-5 (AIRAC AMDT 11/25))'. */
  source: { physical: string | null; declared: string | null; magVar: string | null };
  /** Fields the AIP does not publish for this direction (null in the record or derived). */
  gaps: string[];
  /** Inconsistencies found in the published data (e.g. TRUE BRG vs the threshold coordinates). */
  notes: string[];
  /** Values changed from what the table prints, with the reason (tools/parse_runways.py OVR). */
  corrections: string[];
}

export interface RefAtcUnitRef {
  callsign: string;
  freqs: string[];
  hours?: string;
}

export interface RefAirspace {
  /** Stable id, e.g. 'ATHINAI-TMA-1'. */
  id: string;
  name: string;
  /** 'TMA' | 'MTMA' | 'CTR' | … */
  kind: string;
  class: string;
  sector: string;
  /** As printed: '1000 FT AGL', 'FL 155', 'SFC'. */
  lower: string;
  upper: string;
  /** [lat, lon] vertices. */
  polygon: [number, number][];
  units: RefAtcUnitRef[];
  note: string;
  source: string;
}

/**
 * An aerodrome's own ATS airspace (CTR or ATZ) from AD 2.17 / AD 1.6.N.17, for the map
 * (src/data/ref/ad-airspaces.json, tools/parse_ad_airspace.py). Exactly one of circle / polygon.
 */
export interface RefAdAirspace {
  /** '<aerodrome id>-CTR' | '<aerodrome id>-ATZ'. */
  id: string;
  aerodromeId: string;
  /** As published, e.g. 'DEKELIA TATOI MIL ATZ'. */
  name: string;
  kind: 'CTR' | 'ATZ';
  mil: boolean;
  /** 'D', 'G'. */
  class: string;
  /** 'SFC'. */
  lower: string;
  /** e.g. '5000 FT' (altitude, QNH), 'FL 100'. */
  upper: string;
  /** Lateral limits as printed. */
  lateral: string;
  circle?: { lat: number; lon: number; radiusNm: number };
  /** Closed ring, [lat, lon] (arcs written out). */
  polygon?: [number, number][];
  /** e.g. 'Limited to East by ATHINAI - ISTANBUL FIR boundaries' (the drawn shape is clipped to the FIR). */
  lateralNote?: string;
  verticalNote?: string;
  units: RefAtcUnitRef[];
  /** ATS unit call sign item as printed. */
  unitsText: string;
  /** Class D only while ATC is provided; AFIS at present (RMZ, class G — see remarks). */
  afis?: boolean;
  remarks: string;
  /** e.g. 'LGSY AD 2.17'. */
  source: string;
}

/**
 * A navigation-warning area from AIP ENR 5 (tools/parse_enr5.ts → tools/enr5_areas.json → build_ref.ts):
 * prohibited, restricted and danger areas (ENR 5.1), military exercise and training areas (ENR 5.2),
 * other activities (ENR 5.3; ENR 5.5 aerial sporting refers to ENR 5.3.1), and the areas of AIP SUPs valid
 * until further notice (time-limited SUPs are left out: an area carries no validity dates). At most one of circle /
 * polygon; neither when the lateral limits cannot be drawn (see geometryNote).
 */
export interface RefArea {
  /** Designator, e.g. 'LGP1', 'LGR20A', 'LGD45', 'LGTSA1'; ENR 5.3 areas get a slug of their name ('LACONIA-1'). */
  id: string;
  /**
   * 'P' prohibited, 'R' restricted, 'D' danger (ENR 5.1); 'MIL' military exercise / training area or
   * TSA/TRA (ENR 5.2); 'ACT' other activity (ENR 5.3: parachuting, aeroclub training, …).
   */
  kind: 'P' | 'R' | 'D' | 'MIL' | 'ACT';
  /** Name as printed, e.g. 'ACROPOLIS', 'SALAMIS'; '' when the AIP prints none. */
  name: string;
  /** Parent designator of a sub-area (LGR20A → 'LGR20'), else omitted. */
  group?: string;
  /** Vertical limits as printed (whitespace normalised), e.g. 'GND', 'GND/MSL', '5000 FT ALT', 'FL 240', 'UNL'. */
  lower: string;
  upper: string;
  /** Lateral limits as printed, one line (whitespace normalised). */
  lateral: string;
  circle?: { lat: number; lon: number; radiusNm: number };
  /** Closed ring, [lat, lon] (arcs written out). */
  polygon?: [number, number][];
  /** Why the shape is approximate or missing (e.g. a border segment drawn as a straight line). */
  geometryNote?: string;
  /** Time of activity as printed, e.g. 'H24', 'SR-SS', 'Activated by NOTAM', 'MON 0400-1200 …'. */
  activity: string;
  /** Remarks as printed (restriction, nature of hazard, authority, …), lines joined with '\n'. */
  remarks: string;
  /** e.g. 'ENR 5.1', 'ENR 5.2', 'ENR 5.3', 'AIP SUP 09/24'. */
  source: string;
  /**
   * Designator as charted when `id` cannot be it: a SUP that gives one area other limits for part of its
   * dates (SUP 39/26 LGD6SW) makes two areas with the same designator, and ids are unique per AIRAC.
   */
  designator?: string;
  /**
   * First and last UTC day the area is in force, 'YYYY-MM-DD', both included: from an AIP SUP's
   * "Effective from" / "to" (a SUP valid UFN has no last day). An area with dated windows is in force
   * from its first window's day to its last one's, within the SUP's dates. Absent: always (ENR 5).
   */
  validFrom?: string;
  validUntil?: string;
  /**
   * The periods of activity a SUP prints with dates, UTC instants 'YYYY-MM-DDTHH:MMZ' (`to` after `from`;
   * a period past midnight ends on the next day). The area is active only within them. Absent: active
   * whenever in force, as `activity` says (H24, activated by NOTAM or EAUP/EUUP, …).
   */
  windows?: AreaWindow[];
}

export interface AreaWindow {
  from: string;
  to: string;
}

export interface RefFis {
  units: { callsign: string; freqs: string[]; side: string }[];
  /** Boundary between the two FIS sectors, [lat, lon]. */
  boundary: [number, number][];
  source: string;
}

/** The FIR (client map layer, src/data/ref/fir.json from tools/build_fir.ts; not in the ref_* tables). */
export interface RefFir {
  id: string;
  name: string;
  /** Closed ring, [lat, lon]: AIP ENR 2.1 at sea, the OpenStreetMap land borders, approximations noted in the tool. */
  boundary: [number, number][];
  /** A dividing line inside the FIR (ATHINAI CTA / MAKEDONIA CTA), [lat, lon], west to east. */
  divider: { label: string; line: [number, number][] };
  source: string;
}

/** Kinds of radio navigation aid, as the AIP names them ('L' is a locator). */
export type NavaidType = 'VOR' | 'VOR/DME' | 'VORTAC' | 'DME' | 'TACAN' | 'NDB' | 'NDB/DME' | 'L';

/**
 * A radio navigation aid from AIP ENR 4.1 (en-route) and AD 2.19 / AD 1.6.N.19 (aerodrome aids): client map
 * layer, src/data/ref/navaids.json from tools/parse_navaids.ts; not in the ref_* tables. ILS components are not
 * included.
 */
export interface RefNavaid {
  /** '<ident> <type>', e.g. 'ATV VOR/DME' (one ident can name an L and a VOR/DME). */
  id: string;
  ident: string;
  /** Station name as printed, e.g. 'ATHINAI'. */
  name: string;
  type: NavaidType;
  /** MHz for VOR / DME / TACAN (the paired VHF frequency), kHz for NDB / L; null for a DME or TACAN without one. */
  freq: number | null;
  unit: 'MHz' | 'kHz';
  /** DME / TACAN channel, e.g. '91X'. */
  channel: string | null;
  lat: number;
  lon: number;
  /** Elevation of the DME transmitting antenna, ft. */
  elevFt: number | null;
  /** Magnetic variation at the station, degrees east (+) / west (−), and its year. */
  variation: number | null;
  variationYear: number | null;
  /** VOR declination (the alignment of radial 360 to true north), degrees east (+) / west (−). */
  declination: number | null;
  /** 'H24', 'HJ', 'HS', 'HX'. */
  hours: string;
  /** e.g. 'FL 500 / 120 NM' or '50 NM'. */
  coverage: string;
  /** Where it is published, ENR 4.1 first, e.g. ['ENR 4.1', 'LGAV AD 2.19']. */
  sources: string[];
}

export interface RefVfrPoint {
  /** '<chart>/<NAME>' (with '#2' etc. for repeated names on one chart). */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /**
   * Chart the point is printed on (ICAO of the VFR chart whose routes use it), 'AD 3.N' for a heliport's
   * reporting point, or the aerodrome / 'LGGG' for open flightmaps points.
   */
  chart: string;
  /** Where the position comes from: 'table' | 'chart' (printed coordinates) | 'map' | 'ofm' (open flightmaps). */
  src: string;
  /** Every chart / heliport that publishes the point ('LGAV', 'LGTG', 'AD 3.19'); empty for open flightmaps points. */
  charts?: string[];
  /** AIP references of the pages that publish it ('AD 2-LGAV-VFR', 'AD 1.6.29-LGTG-VFR', 'AD 3.19', 'ENR 4.4'), for links. */
  sources?: string[];
}

export interface RefVfrRoute {
  /** '<chart>:<a>><b>' */
  id: string;
  chart: string;
  /** Point names on that chart. */
  a: string;
  b: string;
  /** Charted altitudes, ft (min = max for a single altitude); both null when the chart draws the
   *  segment but prints no altitude for it. */
  minFt: number | null;
  maxFt: number | null;
  /** One-way routes are flown a → b only. */
  oneway: boolean;
  /** Charted for helicopters only (HEL ONLY), military aircraft only (MIL ONLY) or jets only (JET ONLY);
   *  absent for a route open to every VFR flight. */
  kind?: VfrRouteKind;
}

export type VfrRouteKind = 'hel' | 'mil' | 'jet';

/** An ATC unit for the generated ATC list. */
export interface RefAtcUnit {
  id: string;
  kind: 'aerodrome' | 'airspace' | 'fis';
  /** RefAerodrome.id or RefAirspace.name or 'FIS'. */
  owner: string;
  callsign: string;
  service: string;
  freqs: { mhz: string; role: string; remark: string }[];
}

/** Sunset tables (AIP GEN 2.7), minutes after 00:00 UTC per day of a leap year (366 entries). */
export interface RefSunTable {
  lat: number;
  lon: number;
  ss: (number | null)[];
  /** End of civil twilight. */
  tw: (number | null)[];
}

/** One AIRAC cycle as the clients ship it (src/data/ref/cycles/<id>/, listed by cycles/index.ts). */
export interface RefCycle {
  airac: RefAirac;
  aerodromes: RefAerodrome[];
  runways: RefRunway[];
  airspaces: RefAirspace[];
  fis: RefFis;
  vfrPoints: RefVfrPoint[];
  vfrRoutes: RefVfrRoute[];
  atcUnits: RefAtcUnit[];
  areas: RefArea[];
  adAirspaces: RefAdAirspace[];
  navaids: RefNavaid[];
  sun: Record<string, RefSunTable>;
  /** AIP section → eAIP PDF path (tools/aip_files.ts). */
  aipFiles: Record<string, string>;
}
/** What the native core ships of a cycle: what the server's bundle (GET /api/ref/bundle) lacks. */
export type RefCoreCycle = Pick<RefCycle, 'airac' | 'adAirspaces' | 'navaids' | 'sun' | 'aipFiles'>;

/**
 * The UTC day ('YYYY-MM-DD') that decides the AIRAC in effect. AIRAC data takes effect at 0000 UTC on its
 * effective date. PGF_AIRAC_DATE (Node only: the unit and API tests set it, so their expectations do not change
 * on a cycle's date) overrides the clock.
 */
export function airacDay(now: number = Date.now()): string {
  const pinned = typeof process !== 'undefined' ? process.env?.PGF_AIRAC_DATE : undefined;
  return pinned || new Date(now).toISOString().slice(0, 10);
}

/** The cycle in effect on a day: the latest whose effective date has come, else (none yet) the earliest. */
export function cycleOn<T extends { airac: RefAirac }>(cycles: readonly T[], day: string): T {
  if (!cycles.length) throw new Error('no AIRAC cycle');
  const sorted = [...cycles].sort((a, b) => a.airac.effective.localeCompare(b.airac.effective));
  return sorted.filter((c) => c.airac.effective <= day).at(-1) ?? sorted[0];
}

export interface RefBundle {
  airac: RefAirac;
  aerodromes: RefAerodrome[];
  runways: RefRunway[];
  airspaces: RefAirspace[];
  fis: RefFis;
  vfrPoints: RefVfrPoint[];
  vfrRoutes: RefVfrRoute[];
  atcUnits: RefAtcUnit[];
  /** Aerodrome CTRs and ATZs (client map layer; not in the ref_* tables). */
  adAirspaces?: RefAdAirspace[];
  /** ENR 5 areas (ref_areas, from migration 017). */
  areas?: RefArea[];
  /** The FIR boundary (client map layer). */
  fir?: RefFir;
  /** Radio navigation aids (client map layer; not in the ref_* tables). */
  navaids?: RefNavaid[];
}
