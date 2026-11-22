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
export type HangarAircraft = Aircraft & { access: AircraftAccess; photo?: AircraftFile | null; placeholder?: number };

/**
 * GET /api/aircraft/:id/shares → AircraftSharing (anyone with access; the owner first, then by name).
 * POST /api/aircraft/:id/shares (ShareAddRequest) → 201 AircraftSharing. 404 when no pilot has that
 *   e-mail (case-insensitive), 400 for your own address or the owner's, 409 when they already have access.
 * PUT /api/aircraft/:id/shares/:pilotId (ShareUpdateRequest) → AircraftSharing.
 * DELETE /api/aircraft/:id/shares/:pilotId → 204. Editors and the owner can remove anyone but the
 *   owner; anyone can remove themselves. Viewers get 403 on every other change.
 */
export interface AircraftSharing {
  aircraftId: Id;
  registration: string;
  /** The session pilot's role. */
  role: AircraftRole;
  /** The session pilot may add, change and remove people (owner or editor). */
  canManage: boolean;
  /** The owner first, then everyone the aircraft is shared with. */
  people: (SharePerson & { added: EpochMs | null })[];
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
