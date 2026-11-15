// HTTP API contract: request and response bodies of /api/… (see ARCHITECTURE.md for the route list).
// Every route except session/login/logout requires a session (or local mode) and is scoped to the
// session's pilot: another pilot's records answer 404, never 403.
import type {
  Aircraft,
  AircraftInput,
  Flight,
  FlightDoc,
  FlightSummary,
  Id,
  Passenger,
  PassengerInput,
  Pilot,
  PilotUpdate,
  Waypoint,
  WaypointInput,
  EpochMs,
} from './types.js';
import type {
  RefAerodrome,
  RefAirac,
  RefAirspace,
  RefAtcUnit,
  RefBundle,
  RefFis,
  RefRunway,
  RefVfrPoint,
  RefVfrRoute,
} from './ref.js';

/** Body of every non-2xx response. */
export interface ApiError {
  error: string;
}

// ---- session ------------------------------------------------------------------------------

/** GET /api/session */
export interface SessionResponse {
  authed: boolean;
  /** 'google': sign in with Google Identity Services using googleClientId; 'local': no sign-in. */
  mode: 'google' | 'local';
  googleClientId: string | null;
  pilot: Pilot | null;
  /** The pilot is an admin (ADMIN_EMAILS): the admin page is theirs. */
  admin?: boolean;
}
/** POST /api/login (Google ID token from GIS). 401 bad token, 403 email not allowed. */
export interface LoginRequest {
  credential: string;
}
export interface LoginResponse {
  ok: true;
  pilot: Pilot;
}
/** POST /api/logout → { ok: true } */

// ---- profile --------------------------------------------------------------------------------

/** GET /api/me → Pilot; PUT /api/me with MeUpdateRequest → Pilot */
export type MeResponse = Pilot;
export type MeUpdateRequest = PilotUpdate;

// ---- hangar, passengers, waypoints -------------------------------------------------------------
// GET /api/aircraft → Aircraft[] (by registration)     POST /api/aircraft (AircraftInput) → 201 Aircraft
//   (becomes the pilot's defaultAircraftId when the pilot has none)
// GET /api/aircraft/:id → Aircraft                       PUT /api/aircraft/:id (Partial<AircraftInput>) → Aircraft
// DELETE /api/aircraft/:id → 204 (flights keep aircraftId = null). Owner only.
// Aircraft responses are HangarAircraft (with `access`); sharing: src/shared/sharing.ts.
// Same shape for /api/passengers (Passenger, PassengerInput; ordered by fullName)
// and /api/waypoints (Waypoint, WaypointInput; ordered by name).
export type AircraftList = Aircraft[];
export type AircraftCreateRequest = AircraftInput;
export type AircraftUpdateRequest = Partial<AircraftInput>;
export type PassengerList = Passenger[];
export type PassengerCreateRequest = PassengerInput;
export type PassengerUpdateRequest = Partial<PassengerInput>;
export type WaypointList = Waypoint[];
export type WaypointCreateRequest = WaypointInput;
export type WaypointUpdateRequest = Partial<WaypointInput>;

// ---- flights ---------------------------------------------------------------------------------

/** GET /api/flights (?trash=1 for the trash) → FlightListItem[], most recently updated/opened first. */
export interface FlightListItem {
  id: Id;
  summary: FlightSummary;
  /** Names of every route point in order (departure, waypoints, intermediate aerodromes, destination), for search. */
  points: string[];
  date: string;
  aircraftId: Id | null;
  version: number;
  created: EpochMs;
  updated: EpochMs;
  opened: EpochMs;
  deleted: boolean;
}

/**
 * POST /api/flights → 201 Flight.
 * Missing fields take defaults: date today (UTC), taxi times from the profile, aircraft = the
 * profile's default aircraft, route home → home when `route` is omitted, PIC on the manifest.
 * `id` (6–24 chars [\w-]) is honoured if free (offline-created flights keep their id).
 */
export type FlightCreateRequest = Partial<FlightDoc> & { id?: string };

/** GET /api/flights/:id → Flight */
export type FlightResponse = Flight;

/**
 * PUT /api/flights/:id → FlightUpdateResponse.
 * 409 when `version` is stale: the body is then the current Flight.
 */
export interface FlightUpdateRequest {
  flight: FlightDoc;
  version: number;
}
export interface FlightUpdateResponse {
  version: number;
  updated: EpochMs;
}

/** DELETE /api/flights/:id → 204 (moves to trash). POST /api/flights/:id/restore → Flight. */
/** POST /api/flights/:id/copy (FlightCopyRequest) → 201 Flight (a new flight, title 'Copy of …'). */
export interface FlightCopyRequest {
  title?: string;
}
/** POST /api/flights/:id/opened → 204 (bumps `opened` for the lobby order). */

// ---- reference data (shared, AIRAC-tagged, read-only) -----------------------------------------
// GET /api/ref/airac → RefAirac (current cycle)
// GET /api/ref/bundle → RefBundle (everything below in one response)
// GET /api/ref/aerodromes | runways | airspaces | fis | vfr-points | vfr-routes | atc-units
export type RefAiracResponse = RefAirac;
export type RefBundleResponse = RefBundle;
export type RefAerodromesResponse = RefAerodrome[];
export type RefRunwaysResponse = RefRunway[];
export type RefAirspacesResponse = RefAirspace[];
export type RefFisResponse = RefFis;
export type RefVfrPointsResponse = RefVfrPoint[];
export type RefVfrRoutesResponse = RefVfrRoute[];
export type RefAtcUnitsResponse = RefAtcUnit[];

// ---- weather (owned by the data agent; api/_lib/routes/weather.ts) ------------------------------

/** GET /api/weather/metar?ids=LGAV,LGTT → MetarTafResponse (aviationweather.gov proxy). */
export interface MetarTafResponse {
  /** Keyed by ICAO; aerodromes that do not report are absent. */
  stations: Record<
    string,
    {
      metar: string | null;
      taf: string | null;
      /** Observation time, epoch ms. */
      observed: EpochMs | null;
    }
  >;
  fetched: EpochMs;
}

// --------------------------------------------------------------------------------------------
// Admin (GET /api/admin/pilots, ADMIN_EMAILS only)

/** An aircraft or operator shared between two pilots; `pilot` is the other side. */
export interface AdminShare {
  kind: 'aircraft' | 'operator';
  /** Registration or operator name. */
  name: string;
  role: 'view' | 'edit';
  pilot: string;
}
export interface AdminPilot {
  id: string;
  email: string;
  name: string;
  created: EpochMs;
  lastLogin: EpochMs;
  flights: number;
  trashedFlights: number;
  aircraft: number;
  passengers: number;
  operators: number;
  sharedByThem: AdminShare[];
  sharedWithThem: AdminShare[];
}
