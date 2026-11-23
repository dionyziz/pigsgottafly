// What the share and invite dialogs show and send, apart from React: the rows of "People with access",
// the invitation form's body and its messages. The iPhone app's core wraps these
// (src/native/core/share.ts), so its sheets show the same.
import {
  accessByEmail,
  type AircraftAccess,
  type AircraftRole,
  type FlightAccess,
  type InviteRequest,
  type InviteResponse,
  type ManifestContact,
  passengerShareSuggestions,
  type PilotInvitation,
  type SharePerson,
  type ShareRole,
} from '../../shared/sharing';

export const ROLE_LABEL = { owner: 'Owner', edit: 'Editor', view: 'Viewer' } as const;

export type ShareKind = 'aircraft' | 'operator' | 'flight';

export interface SharingState {
  role: AircraftRole;
  canManage: boolean;
  people: (SharePerson & { via?: string[]; direct?: boolean; pending?: boolean })[];
}

/** "Shared by Alice · Viewer" for a record the pilot does not own (null for their own), and its tooltip. */
export function sharedBy(
  access: Pick<AircraftAccess, 'role' | 'owner'> | undefined | null,
): { text: string; title: string } | null {
  if (!access || access.role === 'owner') return null;
  const by = access.owner.name || access.owner.email;
  return {
    text: `Shared by ${by} · ${ROLE_LABEL[access.role]}`,
    title: `Shared with you by ${by}${access.owner.email && access.owner.name ? ` (${access.owner.email})` : ''}`,
  };
}

/**
 * How a person's role shows: `owner` (fixed), `aircraft` (an operator's viewer through one of its
 * aircraft, changed by sharing that aircraft), `manage` (a role picker and Remove), `readOnly` (the
 * role, and "Remove my access" on the pilot's own row).
 */
export type ShareControl = 'owner' | 'aircraft' | 'manage' | 'readOnly';

export interface ShareRow {
  /** The person's pilot id, or the invited address (the key of PUT/DELETE …/shares/:key). */
  key: string;
  role: AircraftRole;
  name: string;
  /** The address under the name (empty when the name is the address). */
  email: string;
  initial: string;
  self: boolean;
  pending: boolean;
  /** "Invited · has access once they sign in with this address", or empty. */
  note: string;
  /** An operator's "Aircraft: SX-ASV, SX-ASG", or empty. */
  via: string;
  control: ShareControl;
  roleLabel: string;
  /** What removing this person is called ("Remove my access" on the pilot's own row). */
  removeLabel: string;
  /** Remove is offered: managing, or the pilot's own access. */
  canRemove: boolean;
}

export function shareRows(sharing: SharingState, myId: string, kind: ShareKind = 'aircraft'): ShareRow[] {
  return sharing.people.map((p) => {
    const self = p.pilotId === myId;
    const name = p.name || p.email;
    const control: ShareControl =
      p.role === 'owner' ? 'owner' : p.direct === false ? 'aircraft' : sharing.canManage ? 'manage' : 'readOnly';
    return {
      key: p.pilotId,
      role: p.role,
      name,
      email: p.name ? p.email : '',
      initial: (p.name || p.email || '?').trim().charAt(0).toUpperCase(),
      self,
      pending: !!p.pending,
      note: p.pending ? 'Invited · has access once they sign in with this address' : '',
      via: kind === 'operator' && p.via?.length ? `Aircraft: ${p.via.join(', ')}` : '',
      control,
      roleLabel: control === 'aircraft' ? 'Viewer (aircraft)' : ROLE_LABEL[p.role],
      removeLabel: self ? 'Remove my access' : `Remove ${name}`,
      canRemove: control === 'manage' || (control === 'readOnly' && self),
    };
  });
}

/** Both dialogs ask for an address before sending. */
export function emailError(email: string): string | null {
  return email.trim() ? null : 'Enter an e-mail address.';
}

/** The aircraft an invitation may share: those the pilot owns or edits. */
export function shareableAircraft<A extends { access: Pick<AircraftAccess, 'role'> }>(hangar: A[]): A[] {
  return hangar.filter((a) => a.access.role !== 'view');
}

export function inviteRequest(email: string, note: string, picked: [string, ShareRole][]): InviteRequest {
  return {
    email: email.trim(),
    message: note.trim(),
    aircraft: picked.map(([aircraftId, role]) => ({ aircraftId, role })),
  };
}

/** The line after inviting: an address with an account got the aircraft at once. */
export function inviteDone(email: string, r: Pick<InviteResponse, 'existing' | 'shared'>): string {
  const addr = email.trim();
  return r.existing
    ? `${addr} already uses Pig’s Gotta Fly: shared ${r.shared.join(', ')} with them.`
    : `Invited ${addr}.`;
}

/** An open invitation's aircraft: "SX-ASV (Viewer), SX-ASG (Editor)". */
export function invitationAircraft(inv: Pick<PilotInvitation, 'aircraft'>): string {
  return inv.aircraft.map((a) => `${a.registration} (${ROLE_LABEL[a.role]})`).join(', ');
}

/** "View only · shared by Alice" on a flight shared with the pilot (null on their own), and its tooltip. */
export function sharedFlightChip(
  access: Pick<FlightAccess, 'role' | 'owner'> | undefined | null,
): { text: string; title: string } | null {
  if (!access) return null;
  const by = access.owner.name || access.owner.email;
  return {
    text: access.role === 'view' ? `View only · shared by ${by}` : `Shared by ${by}`,
    title: `Shared with you by ${by}${access.owner.email && access.owner.name ? ` (${access.owner.email})` : ''}${access.role === 'view' ? ': you can view it, not change it' : ''}`,
  };
}

/** A flight's manifest passengers with an e-mail it is not shared with yet, offered as viewers to
 *  whoever manages its sharing. */
export function shareSuggestionsFor(
  sharing: Pick<SharingState, 'canManage' | 'people'>,
  contacts: ManifestContact[] | null | undefined,
): ManifestContact[] {
  return sharing.canManage && contacts ? passengerShareSuggestions(contacts, sharing.people) : [];
}

/**
 * After a passenger leaves the manifest: whether to offer to stop sharing the flight with them (the
 * flight is shared with their e-mail, the pilot manages the sharing, and it is not the owner or the
 * pilot), as `{ name, key }` (`name` the manifest's name, else theirs; `key` for DELETE …/shares/:key).
 */
export function unshareOffer(
  sharing: Pick<SharingState, 'canManage' | 'people'> | null,
  email: string,
  myId: string,
  manifestName: string,
): { name: string; key: string } | null {
  if (!email.trim() || !sharing) return null;
  const who = accessByEmail(sharing.people, email);
  if (!sharing.canManage || !who || who.role === 'owner' || who.pilotId === myId) return null;
  return { name: manifestName || who.name || who.email, key: who.pilotId };
}
