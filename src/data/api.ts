// Typed fetch wrappers for /api/… (contract: src/shared/api.ts). Throws ApiRequestError on non-2xx;
// `auth` is true for 401 (the app then shows the sign-in screen).
import type {
  Aircraft,
  AircraftInput,
  Attachment,
  AttachmentInput,
  AttachmentRef,
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
import type { FileRequest, FilingState } from '../shared/briefing';
import type { FormsState, SigningView } from '../shared/forms';

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
  /** Files stored with an aircraft (compass swing reports). */
  attachments: {
    upload: (aircraftId: string, input: AttachmentInput) => request<AttachmentRef>('POST', `aircraft/${encodeURIComponent(aircraftId)}/attachments`, input),
    get: (aircraftId: string, fileId: string) => request<Attachment>('GET', `aircraft/${encodeURIComponent(aircraftId)}/attachments/${encodeURIComponent(fileId)}`),
    remove: (aircraftId: string, fileId: string) => request<null>('DELETE', `aircraft/${encodeURIComponent(aircraftId)}/attachments/${encodeURIComponent(fileId)}`),
  },
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
  /** Form 731 signatures and the forms e-mailed to HCAA (api/_lib/routes/forms.ts). */
  forms: {
    get: (id: string) => request<FormsState>('GET', `flights/${encodeURIComponent(id)}/forms`),
    requestLinks: (id: string) => request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/731/links`),
    renewLink: (id: string, key: string) => request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/731/links/${encodeURIComponent(key)}/renew`),
    revokeLink: (id: string, key: string) => request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/731/links/${encodeURIComponent(key)}/revoke`),
    send731: (id: string) => request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/731/send`),
    sendGenDec: (id: string) => request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/gendec/send`),
    /** The flight's override of who sends the GenDec: true = a handler, false = the PIC, null = automatic (AIP + NOTAMs). */
    setGenDecHandled: (id: string, handled: boolean | null) => request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/gendec/handled`, { handled }),
  },
  /** The signing page (no sign-in). */
  sign: {
    view: (token: string) => request<SigningView>('GET', `sign/${encodeURIComponent(token)}`),
    sign: (token: string) => request<SigningView>('POST', `sign/${encodeURIComponent(token)}`),
  },
  /** Flight-plan filing through autorouter (api/_lib/routes/filing.ts). 503 = filing not enabled. */
  filing: {
    get: (id: string) => request<FilingState>('GET', `flights/${encodeURIComponent(id)}/filing`),
    file: (id: string, req: FileRequest) => request<FilingState>('POST', `flights/${encodeURIComponent(id)}/filing`, req),
    delay: (id: string, eobt: number) => request<FilingState>('POST', `flights/${encodeURIComponent(id)}/filing/delay`, { eobt }),
    cancel: (id: string, reason?: string) => request<FilingState>('POST', `flights/${encodeURIComponent(id)}/filing/cancel`, { reason }),
    refresh: (id: string) => request<FilingState>('POST', `flights/${encodeURIComponent(id)}/filing/refresh`),
  },
  weather: {
    metar: (icaos: string[]) => request<MetarTafResponse>('GET', `weather/metar?ids=${icaos.map(encodeURIComponent).join(',')}`),
  },
};
