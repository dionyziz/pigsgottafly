// Shared aircraft (Google Docs-like sharing). The pilot who created an aircraft owns it; they can
// share it, by e-mail, with other pilots who have an account, as a viewer or an editor.
//   owner  : everything, and the only one who can delete the aircraft
//   edit   : change the aircraft and its files, and manage the sharing (add, change, remove people)
//   view   : see the aircraft and use it on their own flights (navlog, W&B, performance, FPL)
// Anyone with access can remove their own access ("remove from my hangar").
import type { Aircraft, EpochMs, Id } from './types.js';

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
export type HangarAircraft = Aircraft & { access: AircraftAccess };

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
