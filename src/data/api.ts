// Typed fetch wrappers for /api/… (contract: src/shared/api.ts). Throws ApiRequestError on non-2xx;
// `auth` is true for 401 (the app then shows the sign-in screen).
import type {
  Aircraft,
  AircraftInput,
  Flight,
  FlightCopyRequest,
  FlightCreateRequest,
  FlightDoc,
  FlightListItem,
  FlightUpdateResponse,
  LoginResponse,
  MetarTafResponse,
  Passenger,
  PassengerInput,
  Pilot,
  PilotUpdate,
  RefAirac,
  RefBundle,
  SessionResponse,
  Waypoint,
  WaypointInput,
} from '../shared';

export class ApiRequestError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
    this.name = 'ApiRequestError';
  }
  /** Not signed in. */
  get auth() { return this.status === 401; }
  /** Network failure (offline): status 0. */
  get offline() { return this.status === 0; }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/' + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch (e) {
    throw new ApiRequestError(0, 'offline', null);
  }
  const out = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== 'undefined' && path !== 'session') window.dispatchEvent(new Event('pgf:unauthorized'));
  if (!res.ok) throw new ApiRequestError(res.status, (out && (out as any).error) || `HTTP ${res.status}`, out);
  return out as T;
}

function crud<T, I>(base: string) {
  return {
    list: () => request<T[]>('GET', base),
    get: (id: string) => request<T>('GET', `${base}/${encodeURIComponent(id)}`),
    create: (input: I) => request<T>('POST', base, input),
    update: (id: string, patch: Partial<I>) => request<T>('PUT', `${base}/${encodeURIComponent(id)}`, patch),
    remove: (id: string) => request<null>('DELETE', `${base}/${encodeURIComponent(id)}`),
  };
}

export const api = {
  session: () => request<SessionResponse>('GET', 'session'),
  login: (credential: string) => request<LoginResponse>('POST', 'login', { credential }),
  logout: () => request<{ ok: true }>('POST', 'logout'),

  me: {
    get: () => request<Pilot>('GET', 'me'),
    update: (patch: PilotUpdate) => request<Pilot>('PUT', 'me', patch),
  },
  aircraft: crud<Aircraft, AircraftInput>('aircraft'),
  passengers: crud<Passenger, PassengerInput>('passengers'),
  waypoints: crud<Waypoint, WaypointInput>('waypoints'),

  /** Raw flight endpoints; the editor should save through flightStore (offline-tolerant). */
  flights: {
    list: (trash = false) => request<FlightListItem[]>('GET', trash ? 'flights?trash=1' : 'flights'),
    get: (id: string) => request<Flight>('GET', `flights/${encodeURIComponent(id)}`),
    create: (input: FlightCreateRequest = {}) => request<Flight>('POST', 'flights', input),
    /** 409 → ApiRequestError with body = the current Flight. */
    update: (id: string, flight: FlightDoc, version: number) => request<FlightUpdateResponse>('PUT', `flights/${encodeURIComponent(id)}`, { flight, version }),
    trash: (id: string) => request<null>('DELETE', `flights/${encodeURIComponent(id)}`),
    restore: (id: string) => request<Flight>('POST', `flights/${encodeURIComponent(id)}/restore`),
    copy: (id: string, req: FlightCopyRequest = {}) => request<Flight>('POST', `flights/${encodeURIComponent(id)}/copy`, req),
    opened: (id: string) => request<null>('POST', `flights/${encodeURIComponent(id)}/opened`),
  },

  ref: {
    airac: () => request<RefAirac>('GET', 'ref/airac'),
    bundle: () => request<RefBundle>('GET', 'ref/bundle'),
  },
  weather: {
    metar: (icaos: string[]) => request<MetarTafResponse>('GET', `weather/metar?ids=${icaos.map(encodeURIComponent).join(',')}`),
  },
};
