// Typed fetch wrappers for /api/… (contract: src/shared/api.ts). Throws ApiRequestError on non-2xx;
// `auth` is true for 401 (the app then shows the sign-in screen).
import { reportApiFailure } from '../app/errorReporter';
import type {
  AdminMail,
  AdminPilot,
  AircraftFile,
  AircraftFiles,
  AircraftFileStart,
  AircraftInput,
  AircraftSharing,
  Attachment,
  AttachmentInput,
  AttachmentRef,
  DeclarationsState,
  Flight,
  FlightCopyRequest,
  FlightCreateRequest,
  FlightDoc,
  FlightListItem,
  FlightUpdateResponse,
  HangarAircraft,
  LoginResponse,
  MetarTafResponse,
  OperatorFiles,
  OperatorInput,
  OperatorItem,
  OperatorSharing,
  Passenger,
  PassengerInput,
  Pilot,
  PilotUpdate,
  RefAirac,
  RefBundle,
  SessionResponse,
  ShareRole,
  Waypoint,
  WaypointInput,
  WbPerfContent,
} from '../shared';
import type { FileRequest, FilingState } from '../shared/briefing';
import type { FormsState, SigningView } from '../shared/forms';
import type { AppErrorDetail, AppErrorGroup } from '../shared/monitoring';
import { type EntityKey, invalidate, putEntity } from './entityStore';

/** After a successful mutation: whatever shows `keys` refetches, in this tab and the others. */
function changes<A extends unknown[], R>(
  keys: EntityKey | EntityKey[],
  fn: (...a: A) => Promise<R>,
): (...a: A) => Promise<R> {
  return async (...a: A) => {
    const r = await fn(...a);
    invalidate(keys);
    return r;
  };
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
  /** Not signed in. */
  get auth() {
    return this.status === 401;
  }
  /** Network failure (offline): status 0. */
  get offline() {
    return this.status === 0;
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/' + path, {
      method,
      // always JSON for anything but GET: the API refuses other types (CSRF defence, api/_lib/app.ts)
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch (e) {
    throw new ApiRequestError(0, 'offline', null);
  }
  const out = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== 'undefined' && path !== 'session')
    window.dispatchEvent(new Event('pgf:unauthorized'));
  if (res.status >= 500)
    reportApiFailure(method, path, res.status, (out && typeof out.error === 'string' && out.error) || '');
  if (!res.ok) throw new ApiRequestError(res.status, (out && out.error) || `HTTP ${res.status}`, out);
  return out as T;
}

/** What else a mutation of an entity changes (the server derives it from the entity). */
interface AlsoChanges {
  create?: EntityKey[];
  update?: EntityKey[];
  remove?: EntityKey[];
}

/** List/get/create/update/remove of one entity; every mutation invalidates `key` (plus `also`). */
/** A PUT that outlives the page (fetch keepalive): an editor's autosave when the tab closes. Best effort. */
export function keepalivePut(path: string, body: unknown): void {
  try {
    void fetch('/api/' + path, {
      method: 'PUT',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    /* the body is over the keepalive limit: the page is going anyway */
  }
}

function crud<T, I>(base: string, key: EntityKey, also: AlsoChanges = {}) {
  return {
    list: () => request<T[]>('GET', base),
    get: (id: string) => request<T>('GET', `${base}/${encodeURIComponent(id)}`),
    create: changes([key, ...(also.create ?? [])], (input: I) => request<T>('POST', base, input)),
    update: changes([key, ...(also.update ?? [])], (id: string, patch: Partial<I>) =>
      request<T>('PUT', `${base}/${encodeURIComponent(id)}`, patch),
    ),
    remove: changes([key, ...(also.remove ?? [])], (id: string) =>
      request<null>('DELETE', `${base}/${encodeURIComponent(id)}`),
    ),
  };
}

/** Sharing endpoints of a shared record ('aircraft' or 'operators'): /<base>/:id/shares[/:pilotId].
 * Every change invalidates `keys`; removing someone (yourself: the record leaves your lists) also `removeAlso`. */
function sharesOf<S>(base: string, keys: EntityKey[], removeAlso: EntityKey[]) {
  const at = (id: string) => `${base}/${encodeURIComponent(id)}/shares`;
  return {
    get: (id: string) => request<S>('GET', at(id)),
    add: changes(keys, (id: string, email: string, role: ShareRole) => request<S>('POST', at(id), { email, role })),
    setRole: changes(keys, (id: string, pilotId: string, role: ShareRole) =>
      request<S>('PUT', `${at(id)}/${encodeURIComponent(pilotId)}`, { role }),
    ),
    /** Removes a person; with your own pilot id, removes your own access. */
    remove: changes([...keys, ...removeAlso], (id: string, pilotId: string) =>
      request<null>('DELETE', `${at(id)}/${encodeURIComponent(pilotId)}`),
    ),
  };
}

/** Chunked files of a record ('aircraft' or 'operators'): /<base>/:id/files… (src/data/aircraftFiles.ts).
 * Completing or removing a file invalidates `key` (the aircraft list carries the photo). */
function filesOf<L>(base: string, key: EntityKey) {
  const at = (id: string) => `${base}/${encodeURIComponent(id)}/files`;
  return {
    list: (id: string) => request<L>('GET', at(id)),
    start: (id: string, input: AircraftFileStart) => request<AircraftFile>('POST', at(id), input),
    putChunk: (id: string, fileId: string, seq: number, data: string) =>
      request<null>('PUT', `${at(id)}/${encodeURIComponent(fileId)}/chunks/${seq}`, { data }),
    complete: changes(key, (id: string, fileId: string) =>
      request<AircraftFile>('POST', `${at(id)}/${encodeURIComponent(fileId)}/complete`, {}),
    ),
    chunk: (id: string, fileId: string, seq: number) =>
      request<{ data: string }>('GET', `${at(id)}/${encodeURIComponent(fileId)}/chunks/${seq}`),
    rename: (id: string, fileId: string, title: string) =>
      request<AircraftFile>('PUT', `${at(id)}/${encodeURIComponent(fileId)}`, { title }),
    remove: changes(key, (id: string, fileId: string) =>
      request<null>('DELETE', `${at(id)}/${encodeURIComponent(fileId)}`),
    ),
  };
}
export type FilesApi = ReturnType<typeof filesOf<unknown>>;

export const api = {
  session: () => request<SessionResponse>('GET', 'session'),
  login: (credential: string) => request<LoginResponse>('POST', 'login', { credential }),
  logout: () => request<{ ok: true }>('POST', 'logout'),
  revokeAllSessions: () => request<{ ok: true }>('POST', 'session/revoke-all'),

  me: {
    get: () => request<Pilot>('GET', 'me'),
    /** Stores the answer as the session pilot (every tab sees it). */
    update: async (patch: PilotUpdate) => {
      const p = await request<Pilot>('PUT', 'me', patch);
      putEntity('pilot', p, { broadcast: true });
      return p;
    },
    /** Deletes the account and everything it owns; `confirm` is the account's e-mail ("delete" in local mode). */
    remove: (confirm: string) => request<{ ok: true }>('DELETE', 'me', { confirm }),
  },
  /** Own aircraft and those shared with the pilot, each with `access` (role, owner). */
  aircraft: crud<HangarAircraft, AircraftInput>('aircraft', 'aircraft', {
    create: ['pilot', 'operators'],
    update: ['operators'],
    remove: ['pilot', 'operators'],
  }),
  /** Who has access to an aircraft (src/shared/sharing.ts). */
  shares: sharesOf<AircraftSharing>('aircraft', ['aircraft', 'operators'], ['pilot']),
  /** Files stored with an aircraft (compass swing reports). */
  attachments: {
    upload: (aircraftId: string, input: AttachmentInput) =>
      request<AttachmentRef>('POST', `aircraft/${encodeURIComponent(aircraftId)}/attachments`, input),
    get: (aircraftId: string, fileId: string) =>
      request<Attachment>(
        'GET',
        `aircraft/${encodeURIComponent(aircraftId)}/attachments/${encodeURIComponent(fileId)}`,
      ),
    remove: (aircraftId: string, fileId: string) =>
      request<null>('DELETE', `aircraft/${encodeURIComponent(aircraftId)}/attachments/${encodeURIComponent(fileId)}`),
  },
  /** Aircraft photo and documents (chunked: see src/data/aircraftFiles.ts for upload / download). */
  files: filesOf<AircraftFiles>('aircraft', 'aircraft'),
  /** Operators (src/shared/operators.ts), their sharing and documents (operations manual). A change of
   * an operator changes its aircraft too (the operator's name is printed as theirs). */
  operators: crud<OperatorItem, OperatorInput>('operators', 'operators', {
    update: ['aircraft'],
    remove: ['aircraft'],
  }),
  operatorShares: sharesOf<OperatorSharing>('operators', ['operators'], ['aircraft']),
  operatorFiles: filesOf<OperatorFiles>('operators', 'operators'),
  passengers: crud<Passenger, PassengerInput>('passengers', 'passengers', { remove: ['flights'] }),
  waypoints: crud<Waypoint, WaypointInput>('waypoints', 'waypoints'),

  /** Raw flight endpoints; the editor should save through flightStore (offline-tolerant). */
  flights: {
    list: (trash = false) => request<FlightListItem[]>('GET', trash ? 'flights?trash=1' : 'flights'),
    get: (id: string) => request<Flight>('GET', `flights/${encodeURIComponent(id)}`),
    create: changes('flights', (input: FlightCreateRequest = {}) => request<Flight>('POST', 'flights', input)),
    /** 409 → ApiRequestError with body = the current Flight. */
    update: changes('flights', (id: string, flight: FlightDoc, version: number) =>
      request<FlightUpdateResponse>('PUT', `flights/${encodeURIComponent(id)}`, { flight, version }),
    ),
    trash: changes('flights', (id: string) => request<null>('DELETE', `flights/${encodeURIComponent(id)}`)),
    restore: changes('flights', (id: string) => request<Flight>('POST', `flights/${encodeURIComponent(id)}/restore`)),
    copy: changes('flights', (id: string, req: FlightCopyRequest = {}) =>
      request<Flight>('POST', `flights/${encodeURIComponent(id)}/copy`, req),
    ),
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
    renewLink: (id: string, key: string) =>
      request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/731/links/${encodeURIComponent(key)}/renew`),
    revokeLink: (id: string, key: string) =>
      request<FormsState>(
        'POST',
        `flights/${encodeURIComponent(id)}/forms/731/links/${encodeURIComponent(key)}/revoke`,
      ),
    send731: (id: string) => request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/731/send`),
    /** E-mails that passenger the form and a new signing link. */
    email731: (id: string, key: string) =>
      request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/731/email/${encodeURIComponent(key)}`),
    sendGenDec: (id: string) => request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/gendec/send`),
    /** The flight's override of who sends the GenDec: true = a handler, false = the PIC, null = automatic (AIP + NOTAMs). */
    setGenDecHandled: (id: string, handled: boolean | null) =>
      request<FormsState>('POST', `flights/${encodeURIComponent(id)}/forms/gendec/handled`, { handled }),
  },
  /** The W&B and performance sheets e-mailed to the aircraft's operator (src/shared/declarations.ts). */
  declarations: {
    get: (id: string) => request<DeclarationsState>('GET', `flights/${encodeURIComponent(id)}/declarations`),
    send: (id: string, content: WbPerfContent, resend: boolean) =>
      request<DeclarationsState>('POST', `flights/${encodeURIComponent(id)}/declarations/send`, { content, resend }),
  },
  /** Admins only (403 for everyone else). */
  admin: {
    pilots: () => request<AdminPilot[]>('GET', 'admin/pilots'),
    mail: (f: { pilot?: string; kind?: string } = {}) =>
      request<AdminMail[]>(
        'GET',
        `admin/mail?${new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => !!e[1]))}`,
      ),
    errors: (status: 'open' | 'resolved' | 'all' = 'open') =>
      request<AppErrorGroup[]>('GET', `admin/errors?status=${status}`),
    error: (fingerprint: string) => request<AppErrorDetail>('GET', `admin/errors/${encodeURIComponent(fingerprint)}`),
    resolveError: (fingerprint: string) =>
      request<{ ok: true }>('POST', `admin/errors/${encodeURIComponent(fingerprint)}/resolve`),
  },
  /** The signing page (no sign-in). */
  sign: {
    view: (token: string) => request<SigningView>('GET', `sign/${encodeURIComponent(token)}`),
    sign: (token: string) => request<SigningView>('POST', `sign/${encodeURIComponent(token)}`),
  },
  /** Flight-plan filing through autorouter (api/_lib/routes/filing.ts). 503 = filing not enabled. */
  filing: {
    get: (id: string) => request<FilingState>('GET', `flights/${encodeURIComponent(id)}/filing`),
    file: (id: string, req: FileRequest) =>
      request<FilingState>('POST', `flights/${encodeURIComponent(id)}/filing`, req),
    delay: (id: string, eobt: number) =>
      request<FilingState>('POST', `flights/${encodeURIComponent(id)}/filing/delay`, { eobt }),
    cancel: (id: string, reason?: string) =>
      request<FilingState>('POST', `flights/${encodeURIComponent(id)}/filing/cancel`, { reason }),
    refresh: (id: string) => request<FilingState>('POST', `flights/${encodeURIComponent(id)}/filing/refresh`),
  },
  weather: {
    metar: (icaos: string[]) =>
      request<MetarTafResponse>('GET', `weather/metar?ids=${icaos.map(encodeURIComponent).join(',')}`),
  },
};
