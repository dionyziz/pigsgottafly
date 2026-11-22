// Shared aircraft (Google Docs-like sharing). The pilot who created an aircraft owns it; they can
// share it, by e-mail, with other pilots who have an account, as a viewer or an editor.
//   owner  : everything, and the only one who can delete the aircraft
//   edit   : change the aircraft and its files, and manage the sharing (add, change, remove people)
//   view   : see the aircraft and use it on their own flights (navlog, W&B, performance, FPL)
// Anyone with access can remove their own access ("remove from my hangar").
import type { Aircraft, AircraftFile, EpochMs, Flight, Id, PersonDetails, Pilot } from './types.js';

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
