// Shared constants and tiny helpers that both the client and the API use.
import type {
  FlightDoc,
  FlightOptions,
  FlightSummary,
  LegKey,
  PersonDetails,
  PilotSettings,
  RoutePoint,
  Station,
  WindModel,
} from './types.js';

export const APP_NAME = "Pig's Gotta Fly";

/**
 * Settings of a NEW pilot. Pilot-specific values (taxi times, reserve, home aerodrome) start
 * unset: the app asks for them. Only neutral computational defaults are filled.
 */
export const DEFAULT_SETTINGS: PilotSettings = {
  taxiOutMin: null,
  taxiInMin: null,
  reserveMin: null,
  finalReserveMin: 0,
  windModel: 'ecmwf_ifs025',
  enrouteAerodromeRadiusNm: 2,
  // handledAerodromes: optional, missing = none (kept out of the defaults: migration 003 embeds them)
};

/** Generic suggestions shown as input PLACEHOLDERS only; never stored without the pilot typing them. */
export const SETTING_SUGGESTIONS = { taxiOutMin: 10, taxiInMin: 10, reserveMin: 45 } as const;

/** Profile fields the app asks for on first use (onboarding) before anything else. */
export function profileMissing(p: { fullName: string; phone: string; homeAerodrome: string | null }): ('fullName' | 'phone' | 'homeAerodrome')[] {
  const out: ('fullName' | 'phone' | 'homeAerodrome')[] = [];
  if (!p.fullName.trim()) out.push('fullName');
  if (!p.phone.trim()) out.push('phone');
  if (!p.homeAerodrome) out.push('homeAerodrome');
  return out;
}

export const WIND_MODELS: Record<WindModel, string> = {
  ecmwf_ifs025: 'ECMWF IFS 0.25°',
  gfs_seamless: 'GFS',
  icon_seamless: 'ICON',
  best_match: 'Open-Meteo best match',
};

/** Seat layout of an aircraft, in station order: [{ seat, station }] (first = PIC default). */
export function seatLayout(stations: Station[]): { id: string; label: string; station: Station }[] {
  return stations.filter((s) => s.kind === 'seat').flatMap((st) => (st.seats || []).map((p) => ({ id: p.id, label: p.label, station: st })));
}
/** The station a seat belongs to, or undefined. */
export function seatStation(stations: Station[], seatId: string): Station | undefined {
  return seatLayout(stations).find((x) => x.id === seatId)?.station;
}
/** Seat ids used when a flight has no aircraft yet (the four-seat single layout). */
export const FALLBACK_SEATS = ['front-left', 'front-right', 'rear-left', 'rear-right'];
/** The PIC's default seat: front left if the aircraft has it, else its first seat (API and client). */
export function picSeat(seatIds: string[]): string {
  return seatIds.includes('front-left') ? 'front-left' : seatIds[0] ?? 'front-left';
}

/**
 * Manifest validation shared by the API and the client. Returns problems ([] = valid).
 * @param seats the aircraft's seat ids (seatLayout(...).map(s => s.id)), or null if no aircraft.
 */
export function validateCrew(crew: { role: string; seat: string }[], seats: string[] | null): string[] {
  const errs: string[] = [];
  const pics = crew.filter((c) => c.role === 'PIC').length;
  if (crew.length && pics !== 1) errs.push(`exactly one PIC is required (found ${pics})`);
  const seen = new Set<string>();
  for (const c of crew) {
    if (!c.seat) errs.push('every person needs a seat');
    else if (seen.has(c.seat)) errs.push(`two people in seat ${c.seat}`);
    else seen.add(c.seat);
    if (c.seat && seats && !seats.includes(c.seat)) errs.push(`seat ${c.seat} does not exist on this aircraft`);
  }
  const cap = seats ? seats.length : FALLBACK_SEATS.length;
  if (crew.length > cap) errs.push(`${crew.length} people but only ${cap} seats`);
  return errs;
}

/** Export kinds: route /flights/:id/export/:kind. */
export const EXPORT_KINDS = ['navlog', 'form731', 'gendec', 'fpl', 'wb', 'performance', 'briefing'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const EXPORT_LABEL: Record<ExportKind, string> = {
  navlog: 'Navigation log',
  form731: 'Form 731',
  gendec: 'General Declaration',
  fpl: 'Flight plan (AFTN)',
  wb: 'Weight & balance',
  performance: 'Take-off & landing performance',
  briefing: 'NOTAM briefing',
};

/** Legs per MD4.2 navlog sheet. */
export const LEGS_PER_SHEET = 9;
/** Compass cards expiring within this many days of the flight date are warned. */
export const CARD_EXPIRY_WARN_DAYS = 90;

export const EMPTY_PERSON: PersonDetails = {
  fullName: '',
  phone: '',
  dateOfBirth: null,
  weightKg: null,
  idNumber: '',
  idType: '',
  nationality: '',
  relation: '',
};

export const DEFAULT_FLIGHT_OPTIONS: FlightOptions = {
  windModel: 'ecmwf_ifs025',
  compassCard: null,
  category: 'normal',
  alternates: [],
  remarks: '',
  departureRunway: null,
  arrivalRunway: null,
  departureSurface: null,
  arrivalSurface: null,
  aerodromeRequests: [],
};

export const EMPTY_SUMMARY: FlightSummary = {
  title: '',
  date: '',
  blockOff: '',
  aircraft: '',
  route: [],
  from: '',
  to: '',
  distNm: null,
  eteMin: null,
  fuelL: null,
};

/** A complete FlightDoc with every field at its empty default. */
export function emptyFlightDoc(date: string): FlightDoc {
  return {
    title: '',
    date,
    blockOff: '',
    aircraftId: null,
    taxiOutMin: null,
    taxiInMin: null,
    fobL: null,
    route: [],
    legOverrides: {},
    atc: null,
    crew: [],
    baggageKg: {},
    options: { ...DEFAULT_FLIGHT_OPTIONS },
    summary: { ...EMPTY_SUMMARY, date },
  };
}

/** Key of the leg a → b in FlightDoc.legOverrides. */
export function legKey(a: Pick<RoutePoint, 'uid'>, b: Pick<RoutePoint, 'uid'>): LegKey {
  return `${a.uid}>${b.uid}`;
}

/** Random id for route point uids, ATC rows, etc. (not for database ids). */
export function uid(n = 8): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

/** Automatic flight title: the route's distinct consecutive names joined by arrows. */
export function autoTitle(route: Pick<RoutePoint, 'name'>[]): string {
  const names = route.map((p) => p.name).filter((n, i, a) => n && n !== a[i - 1]);
  if (names.length > 1) return names.join(' → ');
  // a local flight from and to the same field: 'LGTT → LGTT'
  if (names.length === 1 && route.length > 1 && route[0].name === route[route.length - 1].name) return `${names[0]} → ${names[0]}`;
  return 'Untitled flight';
}
