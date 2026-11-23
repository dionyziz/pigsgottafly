// The core's share and invite sheets against the website's dialogs' model (hangar/shareModel.ts).
import { describe, expect, test } from 'vitest';

import {
  invitationAircraft,
  inviteDone,
  inviteRequest,
  sharedBy,
  shareRows,
  type SharingState,
} from '../../../src/features/hangar/shareModel';
import { invite, sharedChip, sharing } from '../../../src/native/core';
import type { PilotInvitation } from '../../../src/shared/sharing';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const STATE: SharingState = {
  role: 'edit',
  canManage: true,
  people: [
    { pilotId: 'owner', name: 'Olga Owner', email: 'olga@example.com', role: 'owner' },
    { pilotId: 'me', name: '', email: 'me@example.com', role: 'edit' },
    { pilotId: 'ann@example.com', name: '', email: 'ann@example.com', role: 'view', pending: true },
  ],
};

describe('sharing: the people with access', () => {
  test('the rows are the website’s', () => {
    const out = sharing({ sharing: STATE, myId: 'me', email: ' new@example.com ', role: 'edit' });
    expect(out.rows).toEqual(json(shareRows(STATE, 'me')));
    expect(out.rows.map((r) => [r.control, r.roleLabel, r.self, r.removeLabel])).toEqual([
      ['owner', 'Owner', false, 'Remove Olga Owner'],
      ['manage', 'Editor', true, 'Remove my access'],
      ['manage', 'Viewer', false, 'Remove ann@example.com'],
    ]);
    expect(out.rows[0].email).toBe('olga@example.com');
    expect(out.rows[2].note).toBe('Invited · has access once they sign in with this address');
    expect(out.body).toEqual({ email: 'new@example.com', role: 'edit' });
    expect(out.error).toBeNull();
    expect(out.roles).toEqual([
      { role: 'view', label: 'Viewer' },
      { role: 'edit', label: 'Editor' },
    ]);
  });

  test('a viewer sees the roles and may remove only their own access', () => {
    const viewer: SharingState = { ...STATE, role: 'view', canManage: false };
    const rows = sharing({ sharing: viewer, myId: 'me' }).rows;
    expect(rows.map((r) => [r.control, r.canRemove])).toEqual([
      ['owner', false],
      ['readOnly', true],
      ['readOnly', false],
    ]);
    expect(sharing({ sharing: viewer, myId: 'me', email: '  ' })).toMatchObject({
      error: 'Enter an e-mail address.',
      body: null,
    });
  });

  test('an operator’s viewers through its aircraft', () => {
    const op: SharingState = {
      ...STATE,
      people: [{ pilotId: 'x', name: 'Xen', email: 'x@example.com', role: 'view', direct: false, via: ['SX-ASV'] }],
    };
    const [row] = sharing({ kind: 'operator', sharing: op, myId: 'me' }).rows;
    expect(row).toMatchObject({ control: 'aircraft', roleLabel: 'Viewer (aircraft)', via: 'Aircraft: SX-ASV' });
  });

  test('the shared-by chip', () => {
    const access = { role: 'view' as const, owner: { pilotId: 'o', name: 'Olga', email: 'olga@example.com' } };
    expect(sharedChip({ access }).chip).toEqual(sharedBy(access));
    expect(sharedChip({ access }).chip?.text).toBe('Shared by Olga · Viewer');
    expect(sharedChip({ access: { ...access, role: 'owner' } }).chip).toBeNull();
  });
});

describe('invite: Invite pilots', () => {
  const owner = { pilotId: 'o', name: '', email: 'o@example.com' };
  const hangar = [
    { id: 'a1', registration: 'SX-ASV', makeModel: 'Reims/Cessna F172M', access: { role: 'owner' as const, owner } },
    { id: 'a2', registration: 'SX-VIW', makeModel: '', access: { role: 'view' as const, owner } },
  ];
  const inv: PilotInvitation = {
    id: 'i1',
    email: 'bob@example.com',
    message: '',
    created: 0,
    aircraft: [{ aircraftId: 'a1', registration: 'SX-ASV', role: 'edit' }],
  };

  test('the aircraft it may share, the open invitations, the body and the line after', () => {
    const picked: [string, 'view' | 'edit'][] = [['a1', 'edit']];
    const out = invite({ hangar, invitations: [inv], email: ' bob@example.com ', note: ' hi ', picked });
    expect(out.shareable.map((a) => a.id)).toEqual(['a1']);
    expect(out.invitations).toEqual([
      { id: 'i1', email: 'bob@example.com', initial: 'B', aircraft: invitationAircraft(inv) },
    ]);
    expect(out.invitations[0].aircraft).toBe('SX-ASV (Editor)');
    expect(out.body).toEqual(inviteRequest('bob@example.com', 'hi', picked));
    expect(out.done).toBeNull();
    const existing = invite({ email: 'bob@example.com', response: { existing: true, shared: ['SX-ASV'] } });
    expect(existing.done).toBe(inviteDone('bob@example.com', { existing: true, shared: ['SX-ASV'] }));
    expect(invite({ email: 'bob@example.com', response: { existing: false, shared: [] } }).done).toBe(
      'Invited bob@example.com.',
    );
    expect(invite({ email: '' })).toMatchObject({ error: 'Enter an e-mail address.', body: null });
  });
});
