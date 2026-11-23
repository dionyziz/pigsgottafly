// Sharing and inviting as the website's ShareDialog and InviteDialog show them [hangar/shareModel.ts].
import {
  emailError,
  invitationAircraft,
  inviteDone,
  inviteRequest,
  ROLE_LABEL,
  shareableAircraft,
  sharedBy,
  sharedFlightChip,
  type ShareKind,
  shareRows,
  shareSuggestionsFor,
  type SharingState,
  unshareOffer as unshareOfferOf,
} from '../../features/hangar/shareModel';
import type {
  AircraftAccess,
  FlightAccess,
  InviteResponse,
  ManifestContact,
  PilotInvitation,
  ShareRole,
} from '../../shared/sharing';
import { arg, type Json, plain } from './shared';

/**
 * The share sheet of an aircraft, operator or flight. `sharing` is GET …/:id/shares; `myId` the
 * session pilot's id; `email` and `role` the add form (then `error`, or `body` for POST …/shares);
 * `passengers` a flight's manifest contacts (PGF.shareSuggestions' `contacts`): `suggestions` are
 * those it is not shared with yet, offered as viewers.
 */
export function sharing(
  input: Json<{
    kind?: ShareKind;
    sharing: SharingState;
    myId: string;
    email?: string;
    role?: ShareRole;
    passengers?: ManifestContact[] | null;
  }>,
) {
  const i = arg(input);
  const email = String(i.email ?? '').trim();
  const error = emailError(email);
  return plain({
    canManage: !!i.sharing?.canManage,
    role: i.sharing?.role ?? null,
    rows: i.sharing ? shareRows(i.sharing, i.myId ?? '', i.kind ?? 'aircraft') : [],
    suggestions: i.sharing ? shareSuggestionsFor(i.sharing, i.passengers) : [],
    roles: (['view', 'edit'] as const).map((r) => ({ role: r, label: ROLE_LABEL[r] })),
    error,
    body: error ? null : { email, role: i.role ?? 'view' },
  });
}

/** "Shared by Alice · Viewer" for a record the pilot does not own, or a flight's "View only · shared
 *  by Alice" (`kind: 'flight'`): `{ chip: { text, title } | null }`. */
export function sharedChip(
  input: Json<{ kind?: ShareKind; access?: Pick<AircraftAccess | FlightAccess, 'role' | 'owner'> | null }>,
) {
  const i = arg(input);
  return plain({
    chip:
      i.kind === 'flight'
        ? sharedFlightChip(i.access as Pick<FlightAccess, 'role' | 'owner'> | null)
        : sharedBy(i.access as Pick<AircraftAccess, 'role' | 'owner'> | null),
  });
}

/**
 * After a passenger leaves a flight's manifest [editor/panels/ManifestSection.tsx]: `sharing` is GET
 * /flights/:id/shares (null when it could not be read), `email` the passenger record's, `name` the
 * manifest's. `offer` is `{ name, key }` to ask "Also stop sharing the flight with …?", or null.
 */
export function unshareOffer(
  input: Json<{ sharing: SharingState | null; email?: string; myId: string; name?: string }>,
) {
  const i = arg(input);
  const offer = unshareOfferOf(i.sharing ?? null, i.email ?? '', i.myId ?? '', i.name ?? '');
  return plain({
    offer,
    title: offer ? `Also stop sharing the flight with ${offer.name}?` : null,
    confirm: 'Stop sharing',
    cancel: 'Keep sharing',
  });
}

/**
 * Invite pilots. `hangar` is GET /api/aircraft, `invitations` GET /api/invitations; `email`, `note`
 * and `picked` ([aircraftId, role] pairs) the form (then `error`, or `body` for POST /api/invitations);
 * `response` its answer, for the `done` line.
 */
export function invite(
  input: Json<{
    hangar?: { id: string; registration: string; makeModel?: string; access: Pick<AircraftAccess, 'role'> }[];
    invitations?: PilotInvitation[];
    email?: string;
    note?: string;
    picked?: [string, ShareRole][];
    response?: Pick<InviteResponse, 'existing' | 'shared'> | null;
  }>,
) {
  const i = arg(input);
  const email = String(i.email ?? '');
  const error = emailError(email);
  return plain({
    shareable: shareableAircraft(i.hangar ?? []).map((a) => ({
      id: a.id,
      registration: a.registration,
      makeModel: a.makeModel ?? '',
    })),
    invitations: (i.invitations ?? []).map((inv) => ({
      id: inv.id,
      email: inv.email,
      initial: inv.email.charAt(0).toUpperCase(),
      aircraft: invitationAircraft(inv),
    })),
    error,
    body: error ? null : inviteRequest(email, i.note ?? '', i.picked ?? []),
    done: i.response ? inviteDone(email, i.response) : null,
  });
}
