// Sharing and inviting as the website's ShareDialog and InviteDialog show them [hangar/shareModel.ts].
import {
  emailError,
  invitationAircraft,
  inviteDone,
  inviteRequest,
  ROLE_LABEL,
  shareableAircraft,
  sharedBy,
  type ShareKind,
  shareRows,
  type SharingState,
} from '../../features/hangar/shareModel';
import type { AircraftAccess, InviteResponse, PilotInvitation, ShareRole } from '../../shared/sharing';
import { arg, type Json, plain } from './shared';

/**
 * The share sheet of an aircraft, operator or flight. `sharing` is GET …/:id/shares; `myId` the
 * session pilot's id; `email` and `role` the add form (then `error`, or `body` for POST …/shares).
 */
export function sharing(
  input: Json<{
    kind?: ShareKind;
    sharing: SharingState;
    myId: string;
    email?: string;
    role?: ShareRole;
  }>,
) {
  const i = arg(input);
  const email = String(i.email ?? '').trim();
  const error = emailError(email);
  return plain({
    canManage: !!i.sharing?.canManage,
    role: i.sharing?.role ?? null,
    rows: i.sharing ? shareRows(i.sharing, i.myId ?? '', i.kind ?? 'aircraft') : [],
    roles: (['view', 'edit'] as const).map((r) => ({ role: r, label: ROLE_LABEL[r] })),
    error,
    body: error ? null : { email, role: i.role ?? 'view' },
  });
}

/** "Shared by Alice · Viewer" for a record the pilot does not own: `{ chip: { text, title } | null }`. */
export function sharedChip(input: Json<{ access?: Pick<AircraftAccess, 'role' | 'owner'> | null }>) {
  return plain({ chip: sharedBy(arg(input).access) });
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
