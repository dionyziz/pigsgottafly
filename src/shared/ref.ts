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
  /** Water aerodrome. */
  water: boolean;
  /** AIP section, e.g. 'AD 2 LGAV', 'AD 1.6.5'. */
  source: string;
  notes: string;
}

/** One runway direction with its declared distances (AD 2.12/2.13). null = not published/known. */
export interface RefRunway {
  aerodromeId: string;
  /** This direction, e.g. '03', '26L'. */
  designator: string;
  /** The opposite direction, e.g. '21'. */
  reciprocal: string;
  /** Magnetic heading used for wind components (designator × 10 when not published). */
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
  thresholdElevFt: number | null;
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

export interface RefFis {
  units: { callsign: string; freqs: string[]; side: string }[];
  /** Boundary between the two FIS sectors, [lat, lon]. */
  boundary: [number, number][];
  source: string;
}

export interface RefVfrPoint {
  /** '<chart>/<NAME>' (with '#2' etc. for repeated names on one chart). */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Chart the point is printed on (ICAO of the VFR chart), or 'LGGG' for open flightmaps points. */
  chart: string;
  /** 'table' | 'chart' | 'map' | 'ofm' (open flightmaps). */
  src: string;
}

export interface RefVfrRoute {
  /** '<chart>:<a>><b>' */
  id: string;
  chart: string;
  /** Point names on that chart. */
  a: string;
  b: string;
  /** Charted altitudes, ft (min = max for a single altitude). */
  minFt: number;
  maxFt: number;
  /** One-way routes are flown a → b only. */
  oneway: boolean;
}

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

export interface RefBundle {
  airac: RefAirac;
  aerodromes: RefAerodrome[];
  runways: RefRunway[];
  airspaces: RefAirspace[];
  fis: RefFis;
  vfrPoints: RefVfrPoint[];
  vfrRoutes: RefVfrRoute[];
  atcUnits: RefAtcUnit[];
}
