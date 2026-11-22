// Shared aircraft (Google Docs-like sharing). The pilot who created an aircraft owns it; they can
// share it, by e-mail, with other pilots who have an account, as a viewer or an editor.
//   owner  : everything, and the only one who can delete the aircraft
//   edit   : change the aircraft and its files, and manage the sharing (add, change, remove people)
//   view   : see the aircraft and use it on their own flights (navlog, W&B, performance, FPL)
// Anyone with access can remove their own access ("remove from my hangar").
import type {
  Aircraft,
  AircraftFile,
  EpochMs,
  Flight,
  FlightCrew,
  Id,
  Passenger,
  PersonDetails,
  Pilot,
} from './types.js';

export type ShareRole = 'view' | 'edit';
export type AircraftRole = 'owner' | ShareRole;

/** A person with access to an aircraft. */
export interface SharePerson {
  pilotId: Id;
  /** Full name from the profile, else the Google display name (may be empty). */
  name: string;
  email: string;
  role: AircraftRole;
}

/** How the session pilot holds an aircraft. */
export interface AircraftAccess {
  role: AircraftRole;
  /** The owner (the session pilot themselves when role is 'owner'). */
  owner: Omit<SharePerson, 'role'>;
}

/** GET /api/aircraft and /api/aircraft/:id return aircraft with the session pilot's access. */
/**
 * `photo`: the aircraft's photo (metadata; null without one). `placeholder`: the picture shown
 * without a photo (public/aircraft/placeholder-N.webp), chosen at random when the aircraft was created.
 */
export type HangarAircraft = Aircraft & {
  access: AircraftAccess;
  photo?: AircraftFile | null;
  placeholder?: number;
  /** The newest change in the aircraft's log (sharing aside); `updated` for an aircraft with no log yet. */
  updatedAt?: EpochMs;
  /** Who made it; null when the log is empty. */
  updatedBy?: AircraftEditor | null;
};

/** A pilot named in an aircraft's log. pilotId null: an account deleted since ("a former pilot"). */
export interface AircraftEditor {
  pilotId: Id | null;
  /** Full name, else the Google name, else the e-mail ('' for a deleted account). */
  name: string;
}

// The edit log of an aircraft (migration 056, api/_lib/aircraftLog.ts).
//   GET /api/aircraft/:id/log[?before=<entry id>&limit=<1–100, 50>] → AircraftLogPage, newest first;
//   anyone who can view the aircraft. Consecutive saves by one pilot within AIRCRAFT_LOG_COALESCE_MS
//   are one entry: each field from its first old value to its latest new one.
export const AIRCRAFT_LOG_COALESCE_MS = 10 * 60 * 1000;

export type AircraftLogKind =
  | 'create'
  | 'edit'
  | 'document-add'
  | 'document-remove'
  | 'document-rename'
  | 'photo-set'
  | 'photo-remove'
  | 'share-add'
  | 'share-role'
  | 'share-remove';

export type AircraftLogValue = string | number | boolean | null;

/**
 * One changed field: `path` as in the aircraft record ('fuel.usableL'). `from`/`to` when both are
 * short; `summary` (e.g. '3 stations changed') for lists and tables; neither for long text.
 */
export interface AircraftLogChange {
  path: string;
  from?: AircraftLogValue;
  to?: AircraftLogValue;
  summary?: string;
}

export interface AircraftLogEntry {
  id: number;
  /** The latest save in it. */
  at: EpochMs;
  kind: AircraftLogKind;
  by: AircraftEditor;
  /** 'edit', and 'document-rename' (path 'title'). */
  changes: AircraftLogChange[];
  /** document-*: the document's title. */
  file?: string;
  /** share-*: the person (name, else e-mail; '' for a deleted account), and their pilot id. */
  person?: string;
  personId?: Id | null;
  role?: ShareRole;
}

export interface AircraftLogPage {
  entries: AircraftLogEntry[];
  /** The `before` of the next page; null at the end. */
  next: number | null;
}

/**
 * GET /api/aircraft/:id/shares → AircraftSharing (anyone with access; the owner first, then by name).
 * POST /api/aircraft/:id/shares (ShareAddRequest) → 201 AircraftSharing: a share when an account uses
 *   that e-mail (case-insensitive), else an invitation to the app with this aircraft (PilotInvitation);
 *   400 for your own address or the owner's, 409 when they already have access or this aircraft is
 *   already in an invitation to them.
 * PUT /api/aircraft/:id/shares/:key (ShareUpdateRequest) → AircraftSharing.
 * DELETE /api/aircraft/:id/shares/:key → 204. `key` is the person's pilot id, or the invited address
 *   (that cancels this aircraft only: the invitation to the app stays). Editors and the owner can
 *   remove anyone but the owner; anyone can remove themselves. Viewers get 403 on every other change.
 */
export interface AircraftSharing {
  aircraftId: Id;
  registration: string;
  /** The session pilot's role. */
  role: AircraftRole;
  /** The session pilot may add, change and remove people (owner or editor). */
  canManage: boolean;
  /**
   * The owner first, then everyone the aircraft is shared with, then the pending invitations that
   * share it (pending: true, pilotId = the invited address, name empty).
   */
  people: (SharePerson & { added: EpochMs | null; pending?: boolean })[];
}
export interface ShareAddRequest {
  email: string;
  role: ShareRole;
}
export interface ShareUpdateRequest {
  role: ShareRole;
}

// Shared flights (migration 054). The pilot who created a flight owns it; they share it by e-mail,
// also with someone who has no account yet (an invite, claimed when they sign in with that address),
// as a viewer or an editor.
//   owner  : everything; the only one who trashes, restores or deletes it, files its flight plan and
//            sends its forms (Form 731, GenDec, signing links) and its W&B/performance declarations
//   edit   : change the flight and its manifest, and manage the sharing
//   view   : open it read-only (the editor, the briefing, the exports) and copy it to their own flights
// Anyone with access can remove their own access ("Leave").
export type FlightRole = AircraftRole;

/** How the session pilot holds a flight they do not own (Flight.access; absent on their own flights). */
export interface FlightAccess {
  role: ShareRole;
  owner: Omit<SharePerson, 'role'>;
  /**
   * The flight's aircraft as its owner sees it (null without one, or when the owner no longer has
   * it): the shared pilot computes the flight with it even when it is not in their own hangar.
   */
  aircraft: HangarAircraft | null;
  /**
   * The owner's details (the PIC's live record behind the manifest snapshot), licence and settings
   * (reserves, circuit, wind model): everyone computes the flight and its forms as its owner does.
   */
  pilot: PersonDetails & Pick<Pilot, 'licenceNo' | 'settings'>;
}

/** The aircraft list with a shared flight's aircraft added (when it is not in the list already). */
export function withFlightAircraft<T extends Aircraft>(
  list: T[],
  flight: Pick<Flight, 'access'>,
): (T | HangarAircraft)[] {
  const ac = flight.access?.aircraft;
  return ac && !list.some((a) => a.id === ac.id) ? [...list, ac] : list;
}

/** The pilot a flight is computed for: on a flight shared with the session pilot, its owner's details and settings. */
export function flightPilot(session: Pilot, flight: Pick<Flight, 'access'>): Pilot {
  return flight.access ? { ...session, ...flight.access.pilot } : session;
}

/**
 * GET /api/flights/:id/shares → FlightSharing (anyone with access; the owner first, then the people
 *   by name, then the pending invites).
 * POST /api/flights/:id/shares (ShareAddRequest) → 201 FlightSharing: a share when an account uses
 *   that e-mail (case-insensitive), else an invite to that address; either way the person is
 *   e-mailed. 400 for your own address or the owner's, 409 when they already have access or an invite.
 * PUT /api/flights/:id/shares/:key (ShareUpdateRequest) → FlightSharing; DELETE → 204. `key` is the
 *   person's pilot id, or the address of an invite. Editors and the owner change anyone but the owner;
 *   anyone can remove themselves. Viewers get 403 on every other change.
 */
export interface FlightSharing {
  flightId: Id;
  title: string;
  role: FlightRole;
  canManage: boolean;
  /**
   * The owner first, then everyone the flight is shared with, then the invites (pending: true,
   * pilotId = the invited address, name empty).
   */
  people: (SharePerson & { added: EpochMs | null; pending?: boolean })[];
}

/** A passenger on a flight's manifest who can be reached by e-mail. */
export interface ManifestContact {
  name: string;
  email: string;
}

/**
 * The manifest's passengers with an e-mail on their passenger record (the snapshot carries none),
 * in manifest order, each address once.
 */
export function manifestContacts(crew: FlightCrew[], passengers: Passenger[]): ManifestContact[] {
  const out: ManifestContact[] = [];
  const seen = new Set<string>();
  for (const c of crew) {
    if (c.role !== 'PAX' || !c.passengerId) continue;
    const p = passengers.find((x) => x.id === c.passengerId);
    const email = p?.email.trim() ?? '';
    if (!p || !email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push({ name: c.snapshot.fullName || p.fullName || email, email });
  }
  return out;
}

/** Whoever holds the flight through `email` (a share or a pending invite), compared case-insensitively. */
export function accessByEmail<P extends Pick<SharePerson, 'email'>>(people: P[], email: string): P | undefined {
  const addr = email.trim().toLowerCase();
  return addr ? people.find((p) => p.email.trim().toLowerCase() === addr) : undefined;
}

/** The manifest contacts the flight is not shared with yet, offered as viewers. */
export function passengerShareSuggestions(
  contacts: ManifestContact[],
  people: Pick<SharePerson, 'email'>[],
): ManifestContact[] {
  return contacts.filter((c) => !accessByEmail(people, c.email));
}

// Inviting pilots to the app (migration 055). A pilot invites an address no account uses yet and may
// share some of the aircraft they manage (owner or editor) with it; when someone signs in with that
// address the invitation is accepted and the aircraft are shared with them.
//   GET    /api/invitations                         → PilotInvitation[] (the pilot's open invitations, newest first)
//   POST   /api/invitations (InviteRequest)          → 201 InviteResponse. An address an account already
//          uses gets the aircraft shared at once (existing: true; 409 with no aircraft, or when it has
//          them all already); another invitation to the same address adds the aircraft to it (409 when
//          nothing is new). 400 for your own address, 403/404 for an aircraft you cannot share.
//   DELETE /api/invitations/:id                     → 204: the invitation and its aircraft
//   DELETE /api/invitations/:id/aircraft/:aircraftId → 204: that aircraft only; the invitation stays

export interface InvitationAircraft {
  aircraftId: Id;
  registration: string;
  role: ShareRole;
}
export interface PilotInvitation {
  id: Id;
  /** Lower-cased. */
  email: string;
  message: string;
  created: EpochMs;
  aircraft: InvitationAircraft[];
}
export interface InviteRequest {
  email: string;
  message?: string;
  aircraft: { aircraftId: Id; role: ShareRole }[];
}
export interface InviteResponse {
  /** The address already has an account: no invitation, the aircraft were shared with it. */
  existing: boolean;
  /** The registrations shared at once (existing accounts). */
  shared: string[];
  invitations: PilotInvitation[];
}
