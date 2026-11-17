// Domain types shared by the client, the API and the tests. THIS FILE IS THE CONTRACT.
//
// Units (everywhere, unless a name says otherwise):
//   mass kg, arm m (aft of the datum), moment kg·m, fuel volume L, speed kt, altitude/elevation ft,
//   route distance NM, runway distance m, angles degrees (true unless named "mag"), temperature °C,
//   pressure hPa.
// Dates are ISO 'YYYY-MM-DD' strings; clock times are 'HH:MM' UTC strings; record timestamps are
// epoch milliseconds (numbers).
//
// Imports inside src/shared and src/calc use explicit '.js' extensions: the API (Vercel, Node ESM)
// imports these files too.

import type { MapLayers } from './mapLayers.js';

export type Id = string;
/** 'YYYY-MM-DD' */
export type IsoDate = string;
/** 'HH:MM', UTC. '' = not set. */
export type ClockUtc = string;
/** Milliseconds since the Unix epoch. */
export type EpochMs = number;

export interface LatLon {
  lat: number;
  lon: number;
}

// --------------------------------------------------------------------------------------------
// Pilot (the account) and profile

/** Open-Meteo model ids (see WIND_MODELS in constants.ts). */
export type WindModel = 'ecmwf_ifs025' | 'gfs_seamless' | 'icon_seamless' | 'best_match';

/**
 * Per-pilot planning defaults; copied into a new flight where the flight has its own field.
 * A new pilot starts with null here; sign-up saves taxi out/in as 15 min when left empty
 * (SETTING_SUGGESTIONS in constants.ts), other fields stay null until set.
 * Calculations treat null as "not set" and warn.
 */
export interface PilotSettings {
  /** Block start → take-off, minutes. null = not set yet. Copied to new flights. */
  taxiOutMin: number | null;
  /** Landing → block stop, minutes. null = not set yet. Copied to new flights. */
  taxiInMin: number | null;
  /** Fuel on board default = required + this many minutes at the planning burn. null = not set. */
  reserveMin: number | null;
  /**
   * Final reserve included IN "required" fuel, minutes (default 0: required = allowance + trip,
   * as on the paper navlog). Set e.g. 30 to plan a VFR-day final reserve inside "required".
   */
  finalReserveMin: number;
  /** Winds/temperatures aloft model. */
  windModel: WindModel;
  /** Aerodromes within this distance of the route are listed in the ATC list (default 2 NM). */
  enrouteAerodromeRadiusNm: number;
  /**
   * Alternate aerodrome (ICAO, or the AIP id of one without) pre-filled on new flights (FPL item
   * 16); editable per flight. Missing or null = none.
   */
  defaultAlternate?: string | null;
  /**
   * No longer used (kept so old profiles stay valid): whether a handler submits the General
   * Declaration now comes from the AIP handling hours and NOTAMs, with a per-flight override
   * (FlightOptions.genDecHandled).
   */
  handledAerodromes?: string[];
  /** Map layers of a new flight (copied to FlightOptions.mapLayers). Missing or null = all shown. */
  mapLayers?: MapLayers | null;
}

/** Identity details used on the forms (Form 731, GenDec, FPL item 19 C/). */
export interface PersonDetails {
  fullName: string;
  phone: string;
  /** null = unknown */
  dateOfBirth: IsoDate | null;
  /** Body mass for W&B, kg. null = unknown. */
  weightKg: number | null;
  /** ID card or passport number. */
  idNumber: string;
  idType: 'ID' | 'PASSPORT' | '';
  /** e.g. 'GREEK' / 'GR' as printed on the forms. */
  nationality: string;
  /** Relation printed on Form 731, e.g. an aeroclub member code, 'FRIEND', 'FAMILY'. */
  relation: string;
}

export type PersonKey = keyof PersonDetails;

export interface Pilot extends PersonDetails {
  id: Id;
  /** From Google sign-in ('' in local mode). */
  email: string;
  /** Google display name (not the form name: that is fullName). */
  name: string;
  picture: string;
  /** Pilot licence number, e.g. 'EL.FCL.6094'. */
  licenceNo: string;
  /** ICAO of the home aerodrome; new flights go home → home. null = not set (asked on first use). */
  homeAerodrome: string | null;
  defaultAircraftId: Id | null;
  settings: PilotSettings;
  created: EpochMs;
  lastLogin: EpochMs;
}

/** Fields a pilot may change on their own profile (PUT /api/me). */
export type PilotUpdate = Partial<
  Pick<
    Pilot,
    | 'fullName'
    | 'phone'
    | 'dateOfBirth'
    | 'weightKg'
    | 'idNumber'
    | 'idType'
    | 'nationality'
    | 'relation'
    | 'licenceNo'
    | 'homeAerodrome'
    | 'defaultAircraftId'
  >
> & { settings?: Partial<PilotSettings> };

// --------------------------------------------------------------------------------------------
// Aircraft (hangar)

export type WakeCategory = 'L' | 'M' | 'H' | 'J';
export type FuelType = 'AVGAS' | 'MOGAS' | 'JET A-1';

/** One fuel approved for the aircraft. */
export interface FuelGrade {
  type: FuelType;
  /**
   * kg per litre. Kept in the record for older clients, but not per aircraft: the W&B always uses
   * the standard density of the type (FUEL_DENSITY in fuel.ts: AVGAS 0.72, MOGAS 0.75, Jet A-1 0.80),
   * and the hangar saves that value.
   */
  densityKgPerL: number;
}

export interface FuelSpec {
  /**
   * The approved fuels, at least one, each type once. The first is the aircraft's usual fuel: a
   * flight that gives only a total (FlightDoc.fobL without FlightOptions.fuelL) carries that one.
   * Mixed tanks are allowed: the W&B mass is the sum of litres × standard density per type.
   * (Before migration 014 this was a single `type` + `densityKgPerL`; normalizeFuelSpec reads both.)
   */
  types: FuelGrade[];
  /** Total tank capacity, L. */
  totalL: number;
  /** Usable fuel, L (SX-ASV 144, SX-ASG 182). FOB above this is warned. */
  usableL: number;
  /** Unusable fuel, L (15 for the F172M). */
  unusableL: number;
  /** True if the empty mass from the weighing report already includes the unusable fuel. */
  unusableIncludedInEmptyMass: boolean;
  /** 'standard', 'long-range', … (free text). */
  tanks: string;
  /** Planning burn rate, L/h (30). Used for every leg. */
  burnLph: number;
  /** Fixed start-up/taxi/take-off/landing allowance, L (4), added once to the trip fuel. */
  taxiAllowanceL: number;
}

export type StationKind = 'seat' | 'baggage' | 'fuel';

/** One seat of a seat station, e.g. { id: 'front-left', label: 'Front left' }. */
export interface SeatPosition {
  /** Unique within the aircraft. */
  id: string;
  label: string;
}

/** A loading station of the W&B sheet. */
export interface Station {
  /** Stable id: 'front', 'rear', 'bag1', 'bag2', 'fuel' for the seeded aircraft. */
  id: string;
  name: string;
  kind: StationKind;
  /** Arm, m aft of the datum. */
  armM: number;
  /** Adjustable seats: arm range, m (front seats 0.85–1.17). */
  armRangeM?: [number, number] | null;
  /** Max load at the station, kg (baggage areas). */
  maxKg?: number | null;
  /** Seat stations: the seats at this station (their count is the station's capacity). */
  seats?: SeatPosition[] | null;
}

/** Envelope polygon vertex: [cg arm m, mass kg]. */
export type EnvelopePoint = [number, number];
/** Moment envelope vertex: [moment kg·m, mass kg]. */
export type MomentEnvelopePoint = [number, number];

export type WbCategory = 'normal' | 'utility';

export interface Envelope {
  category: WbCategory;
  maxKg: number;
  /** CG envelope, closed implicitly. */
  polygon: EnvelopePoint[];
  /** Moment envelope (the club calculator's "torque" limits), optional. */
  momentPolygon?: MomentEnvelopePoint[] | null;
  /** e.g. utility: no rear passengers, no baggage. */
  notes?: string;
}

export interface MassBalance {
  /** e.g. 'Forward face of firewall'. */
  datum: string;
  emptyMassKg: number;
  emptyArmM: number;
  emptyMomentKgM: number;
  /** Date of the weighing report. */
  weighingDate: IsoDate | null;
  /** Reference to the weighing report. */
  weighingSource: string;
  includesOil: boolean;
  mtowKg: number;
  /** Max landing mass; null = same as MTOW. */
  mlwKg: number | null;
  stations: Station[];
  /** e.g. bag1 + bag2 ≤ 54 kg. */
  combinedLimits: { stations: string[]; maxKg: number }[];
  envelopes: { normal: Envelope; utility: Envelope | null };
}

/** [ground run/roll m, total distance over a 15 m (50 ft) obstacle m] */
export type DistancePair = [number, number];

export interface TakeoffTableRow {
  massKg: number;
  /** Lift-off IAS, kt. */
  liftoffIasKt: number | null;
  /** Headwind columns, kt (e.g. [0, 10, 20]). */
  headwindKt: number[];
  /** distances[headwindIndex][altitudeIndex] */
  distances: DistancePair[][];
}

export interface TakeoffTable {
  source: string;
  flaps: string;
  /** Pressure altitudes of the table columns, ft. */
  altitudesFt: number[];
  /** Standard temperature at each altitude column, °C. */
  standardTempC: number[];
  rows: TakeoffTableRow[];
  /** Fractional increase per 15 °C above standard (0.10). */
  tempIncreasePer15C: number;
  /** Dry grass: add this fraction of the total distance to both distances (0.07). */
  grassAddFractionOfTotal: number;
  notes: string[];
}

export interface LandingTable {
  source: string;
  flaps: string;
  massKg: number;
  /** Approach IAS, kt. */
  approachIasKt: number | null;
  altitudesFt: number[];
  standardTempC: number[];
  /** distances[altitudeIndex], zero wind. */
  distances: DistancePair[];
  /** Fractional decrease per 5 kt headwind (0.10). */
  headwindDecreasePer5Kt: number;
  /** Fractional increase per 15 °C above standard (0.10). */
  tempIncreasePer15C: number;
  /** Dry grass: add this fraction of the total distance to both distances (0.20). */
  grassAddFractionOfTotal: number;
  notes: string[];
}

/** Club (MD 4.4) factors applied on top of the AFM figures. */
export interface PerformanceFactors {
  source: string;
  safetyFactorTakeoff: number;
  safetyFactorLanding: number;
  /** Surface condition → factor, e.g. 'short dry grass': 1.2, 'paved RWYCC 5': 1.15. */
  runwayCondition: Record<string, number>;
  /** Factor for each 2% of adverse slope (upslope for take-off, downslope for landing): 1.1. */
  slopeFactorPer2Pct: number;
  maxCrosswindKt: { takeoff: number; landing: number };
  notes: string[];
}

export interface PerformanceTables {
  takeoff: TakeoffTable;
  landing: LandingTable;
  factors: PerformanceFactors;
  /** Stall IAS by angle of bank 0/20/40/60°, power off, at MTOW. */
  stallIasKt: { flapsUp: number[]; flaps10: number[]; flaps40: number[] } | null;
}

/** ICAO FPL equipment and item 19 data. */
export interface Equipment {
  /** Item 10a, e.g. 'S', 'SDFGY'. */
  item10a: string;
  /** Item 10b, e.g. 'C' (Mode C), 'S', 'SB2'. */
  item10b: string;
  /** Item 18 PBN/ ('' for none). */
  pbn: string;
  /** Extra item 18 text for this aircraft, e.g. 'NAV/…' (without DOF/REG/RMK, which are generated). */
  item18Extras: string;
  /** Item 19 R/: emergency radio. */
  emergencyRadio: { uhf: boolean; vhf: boolean; elt: boolean };
  /** Item 19 S/: survival equipment. */
  survival: { polar: boolean; desert: boolean; maritime: boolean; jungle: boolean };
  /** Item 19 J/: life jackets. present=false strikes J entirely. */
  jackets: { present: boolean; light: boolean; fluorescein: boolean; uhf: boolean; vhf: boolean };
  /** Item 19 D/: dinghies, or null for none. */
  dinghies: { number: number; capacity: number; covered: boolean; colour: string } | null;
  /** Item 19 N/ remarks for this aircraft (free text). */
  remarks: string;
}

/** Compass deviation card: points [for (magnetic heading), steer (compass heading)]. */
export interface CompassCard {
  /** e.g. 'Magnetic compass', 'GMU (G1000 heading)'. */
  name: string;
  swung: IsoDate;
  expires: IsoDate;
  source: string;
  points: [number, number][];
  /** The compass swing report as a file (PDF or image) stored with the aircraft; null/absent = none. */
  report?: AttachmentRef | null;
}

/** File types accepted as aircraft attachments (compass swing reports). */
export const ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
/** Largest attachment, bytes (base64 in a JSON body stays under the API's 5 MB body limit). */
export const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;

/** A file stored with an aircraft (GET /api/aircraft/:id/attachments/:fileId gives its content). */
export interface AttachmentRef {
  id: Id;
  name: string;
  mime: AttachmentType;
  /** Bytes. */
  size: number;
  uploaded: EpochMs;
}
/** POST /api/aircraft/:id/attachments body; GET returns AttachmentRef & { data }. */
export interface AttachmentInput {
  name: string;
  mime: AttachmentType;
  /** File content, base64 (no data: prefix). */
  data: string;
}
export interface Attachment extends AttachmentRef {
  data: string;
}

// Aircraft photo and documents (POH/AFM, weighing report, … as PDFs). Stored in aircraft_attachments
// (kind 'photo' / 'document', migration 015) in chunks, because a POH (10–40 MB) is far above the
// serverless request and response limits (~4.5 MB): the client uploads and downloads it chunk by
// chunk (AIRCRAFT_FILE_CHUNK_BYTES each, base64 in JSON) and assembles a Blob to view or save.
export type AircraftFileKind = 'photo' | 'document';
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DOCUMENT_TYPES = ['application/pdf'] as const;
/** Bytes per chunk (2 MiB: 2.8 MB as base64, well within the request/response limits). */
export const AIRCRAFT_FILE_CHUNK_BYTES = 2 * 1024 * 1024;
/** The photo is resized in the browser (longest side PHOTO_MAX_PX) before upload. */
export const PHOTO_MAX_PX = 1600;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 80 * 1024 * 1024;

/** A photo or document of an aircraft (metadata; the content comes chunk by chunk). */
export interface AircraftFile {
  id: Id;
  kind: AircraftFileKind;
  /** Shown name, e.g. 'POH', 'Weighing report 2024' ('' for the photo). */
  title: string;
  /** Original file name. */
  name: string;
  mime: string;
  /** Bytes. */
  size: number;
  /** Number of chunks of the content. */
  chunks: number;
  uploaded: EpochMs;
}
/** POST /api/aircraft/:id/files: starts an upload; the file appears once all chunks are in (POST …/complete). */
export interface AircraftFileStart {
  kind: AircraftFileKind;
  name: string;
  title: string;
  mime: string;
  size: number;
}
/** GET /api/aircraft/:id/files */
export interface AircraftFiles {
  photo: AircraftFile | null;
  documents: AircraftFile[];
}

export interface Aircraft {
  id: Id;
  /** e.g. 'SX-ASV' (FPL item 7 drops the hyphen). */
  registration: string;
  /** e.g. 'Reims/Cessna F172M'. */
  makeModel: string;
  /** ICAO type designator, e.g. 'C172'. */
  icaoType: string;
  wake: WakeCategory;
  serial: string;
  /**
   * The operator's name as the forms print it (GenDec, FPL OPR/, W&B sheet): the name of the linked
   * operator (operatorId) when there is one, else free text kept from before operators existed.
   */
  operator: string;
  /** The operator (src/shared/operators.ts) this aircraft is assigned to. */
  operatorId: Id | null;
  /** ICAO of the home base. */
  homeBase: string;
  /** Colours and markings (FPL item 19 A/), e.g. 'WHITE BLUE STRIPES'. */
  colours: string;
  cruiseTasKt: number;
  patternTasKt: number;
  climbTasKt: number | null;
  fuel: FuelSpec;
  massBalance: MassBalance;
  performance: PerformanceTables;
  equipment: Equipment;
  compassCards: CompassCard[];
  notes: string;
  created: EpochMs;
  updated: EpochMs;
}

/** Writable aircraft fields (POST/PUT /api/aircraft). */
export type AircraftInput = Omit<Aircraft, 'id' | 'created' | 'updated'>;

// --------------------------------------------------------------------------------------------
// Passengers and saved waypoints

export interface Passenger extends PersonDetails {
  id: Id;
  /** Where their Form 731 is e-mailed ('' = none yet). */
  email: string;
  notes: string;
  created: EpochMs;
  updated: EpochMs;
}
export type PassengerInput = Omit<Passenger, 'id' | 'created' | 'updated'>;

/** A pilot's saved custom point. */
export interface Waypoint extends LatLon {
  id: Id;
  /** Upper-case name, e.g. 'ZOFRI'. */
  name: string;
  notes: string;
  created: EpochMs;
  updated: EpochMs;
}
export type WaypointInput = Omit<Waypoint, 'id' | 'created' | 'updated'>;

// --------------------------------------------------------------------------------------------
// Flights

/**
 * What a route point refers to:
 *   'aerodrome' → refId = RefAerodrome.id (ICAO where there is one)
 *   'vfr'       → refId = RefVfrPoint.id ('<chart>/<NAME>')
 *   'waypoint'  → refId = Waypoint.id (the pilot's saved point)
 *   'custom'    → refId = null: a one-off named point of this flight
 * name/lat/lon are always stored as a snapshot, so a flight still opens when the reference data
 * changes (new AIRAC) or a saved waypoint is deleted.
 */
export type RoutePointKind = 'aerodrome' | 'vfr' | 'waypoint' | 'custom';

export interface RoutePoint extends LatLon {
  /** Stable id within the flight (random), used to key leg overrides. */
  uid: string;
  kind: RoutePointKind;
  refId: string | null;
  name: string;
}

/** Key of the leg from point a to point b: `${a.uid}>${b.uid}` (see legKey in constants.ts). */
export type LegKey = string;

/** Per-leg values typed over the computed ones. Missing = computed. */
export interface LegOverride {
  altFt?: number;
  tasKt?: number;
  /** Wind FROM, true, and speed. */
  windDirDeg?: number;
  windKt?: number;
  tempC?: number;
}

export type CrewRole = 'PIC' | 'PAX';
/**
 * Seat id: a SeatPosition.id of the flight's aircraft (C172: 'front-left', 'front-right',
 * 'rear-left', 'rear-right'). The W&B arm is that seat's station arm (seatStation() in constants.ts).
 */
export type SeatId = string;

/**
 * One manifest row (flight_crew). The snapshot keeps old forms correct after edits.
 * Rules (validated by the API, 400 on violation): exactly one PIC; one person per seat; every seat
 * must exist on the flight's aircraft (when it has one); no more people than seats.
 * PIC defaults to the first seat (front left).
 */
export interface FlightCrew {
  role: CrewRole;
  /** PAX: the passenger record; PIC: null (the pilot). */
  passengerId: Id | null;
  seat: SeatId;
  snapshot: PersonDetails;
  /**
   * Snapshot fields edited on this flight (e.g. a weight typed for it): they no longer follow the
   * passenger list / profile until "Reset from the saved details". Missing = none.
   */
  overrides?: PersonKey[];
}

export type AtcRole = 'departure' | 'enroute' | 'destination' | 'airspace' | 'fis' | 'custom';

/** One unit in the flight's ATC list (callsign + frequencies). */
export interface AtcEntry {
  /** Stable id within the list (random for custom rows). */
  id: string;
  role: AtcRole;
  /** Heading the entry belongs to, e.g. 'LGTT DEKELIA / TATOI', 'ATHINAI TMA', 'FIS'. */
  group: string;
  /** e.g. 'TATOI TOWER'. */
  callsign: string;
  /** Short unit label, e.g. 'TWR', 'APP', 'INFO', 'ATIS'. */
  service: string;
  /** Primary frequency, MHz as printed, e.g. '122.650'. */
  primary: string;
  /** Backup frequencies, MHz. */
  backups: string[];
  /** e.g. vertical limits of a TMA, opening hours. */
  remark: string;
  /** Generator key (e.g. 'ad:LGTT:TATOI TOWER'); null for rows added by hand. */
  sourceKey: string | null;
}

/**
 * A request at an aerodrome of the route (PLAN-v3 "Touch-and-go and intermediate-stop requests"):
 * written into FPL item 18 RMK/ in the club's format, and timed (pattern TAS on the legs either
 * side of an intermediate aerodrome, plus the stop's minutes on the ground).
 */
export interface AerodromeRequest {
  /** RoutePoint.uid of the aerodrome point (the request goes when the point is removed). */
  pointUid: string;
  kind: 'touch-and-go' | 'stop';
  /** Minutes on the ground, kind 'stop' only. */
  stopMin?: number;
  /** Runways chosen by hand for the landing and the take-off there (stop or touch-and-go); null/missing = from the wind. */
  landingRunway?: string | null;
  takeoffRunway?: string | null;
  /** Key of PerformanceFactors.runwayCondition; null/missing = paved, dry. */
  surface?: string | null;
}

export interface FlightOptions {
  windModel: WindModel;
  /** CompassCard.name to use; null = the aircraft's first card. */
  compassCard: string | null;
  category: WbCategory;
  /** Alternate aerodromes (ICAO), FPL item 16. */
  alternates: string[];
  /** FPL item 18 RMK/ text. */
  remarks: string;
  /** Runway chosen by hand; null = picked from the wind. */
  departureRunway: string | null;
  arrivalRunway: string | null;
  /** Key of PerformanceFactors.runwayCondition; null = paved, dry. */
  departureSurface: string | null;
  arrivalSurface: string | null;
  /** Touch-and-go / intermediate-stop requests, at most one of each kind per point (missing on older flights = none). */
  aerodromeRequests?: AerodromeRequest[];
  /**
   * Fuel on board at block start per type, L, when the pilot gives it by type (aircraft with more
   * than one approved fuel; the club W&B calculator takes MOGAS and AVGAS litres separately).
   * FlightDoc.fobL is then their sum. null / missing = all of fobL is the aircraft's first fuel.
   */
  fuelL?: Partial<Record<FuelType, number>> | null;
  /**
   * Who sends the General Declaration, overriding the automatic decision (handling per AIP + NOTAMs):
   * true = a handler submits it, false = the PIC sends it; null / missing = automatic.
   */
  genDecHandled?: boolean | null;
  /** The map's layer selection for this flight; missing on older flights (the pilot's setting applies). */
  mapLayers?: MapLayers | null;
}

/** Lobby row data, computed by the client on save. */
export interface FlightSummary {
  title: string;
  date: IsoDate | '';
  blockOff: ClockUtc;
  /** Registration. */
  aircraft: string;
  /** Route [lat, lon] rounded to 3 decimals, for the thumbnail. */
  route: [number, number][];
  /** Names of first and last points. */
  from: string;
  to: string;
  distNm: number | null;
  eteMin: number | null;
  fuelL: number | null;
}

/** The editable document of a flight (what the client PUTs). */
export interface FlightDoc {
  /** '' = automatic ('LGTT → LGMG → LGTT'). */
  title: string;
  date: IsoDate;
  blockOff: ClockUtc;
  aircraftId: Id | null;
  /** Copied from the profile at creation (null if the profile has none yet), editable per flight. */
  taxiOutMin: number | null;
  taxiInMin: number | null;
  /** Fuel on board at block start, L. null = default (required + reserve). */
  fobL: number | null;
  route: RoutePoint[];
  legOverrides: Record<LegKey, LegOverride>;
  /** null = not edited yet: the client shows the generated list. */
  atc: AtcEntry[] | null;
  crew: FlightCrew[];
  /** Baggage per baggage station id, kg (e.g. { bag1: 10 }). */
  baggageKg: Record<string, number>;
  options: FlightOptions;
  summary: FlightSummary;
}

export interface Flight extends FlightDoc {
  id: Id;
  /** Incremented by every successful PUT; PUT with a stale version gets 409. */
  version: number;
  created: EpochMs;
  updated: EpochMs;
  opened: EpochMs;
  /** In the trash. */
  deleted: boolean;
}
