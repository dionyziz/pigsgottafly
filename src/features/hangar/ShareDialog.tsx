// Share an aircraft, an operator or a flight, like sharing a Google Doc: add pilots by the e-mail of
// their Pig's Gotta Fly account as viewer or editor, change their role or remove them. The owner is
// listed first and cannot be changed. Viewers see who has access but cannot change it. An operator
// also lists the pilots who see it through one of its aircraft (changed by sharing that aircraft). A
// flight can also be shared with an address no account uses yet: the invite is listed as pending
// until someone signs in with it. Also: the "Shared by" chip of shared aircraft and operators in the
// lists and on their pages.
import './share.css';

import { useEffect, useState } from 'react';

import { useSession } from '../../app/session';
import { api } from '../../data/api';
import { errorMessage } from '../../shared/format';
import type { AircraftAccess, AircraftRole, SharePerson, ShareRole } from '../../shared/sharing';
import { Chip, Dialog, Loading, RowRemove } from '../../ui';

export const ROLE_LABEL = { owner: 'Owner', edit: 'Editor', view: 'Viewer' } as const;

/** "Shared by Alice · Viewer" for an aircraft the pilot does not own; nothing for their own. */
export function SharedChip({ access }: { access: Pick<AircraftAccess, 'role' | 'owner'> | undefined }) {
  if (!access || access.role === 'owner') return null;
  const by = access.owner.name || access.owner.email;
  return (
    <Chip
      className="share-chip"
      title={`Shared with you by ${by}${access.owner.email && access.owner.name ? ` (${access.owner.email})` : ''}`}
      testId="shared-chip"
    >
      Shared by {by} · {ROLE_LABEL[access.role]}
    </Chip>
  );
}

const message = errorMessage;

/** What both kinds of sharing state have in common (AircraftSharing, OperatorSharing). */
interface SharingState {
  role: AircraftRole;
  canManage: boolean;
  people: (SharePerson & { via?: string[]; direct?: boolean; pending?: boolean })[];
}

const API = { aircraft: api.shares, operator: api.operatorShares, flight: api.flightShares } as const;

export function ShareDialog({
  kind = 'aircraft',
  id,
  name,
  onClose,
  onLeft,
}: {
  kind?: 'aircraft' | 'operator' | 'flight';
  id: string;
  /** Registration, operator name or flight title, for the title. */
  name: string;
  onClose: () => void;
  /** The pilot removed their own access (the aircraft left their hangar, the flight their list). */
  onLeft?: () => void;
}) {
  const { pilot } = useSession();
  const shares = API[kind];
  const [sharing, setSharing] = useState<SharingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ShareRole>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    shares.get(id).then(
      (s) => {
        if (live) setSharing(s);
      },
      (e) => {
        if (live) setLoadError(message(e));
      },
    );
    return () => {
      live = false;
    };
  }, [shares, id]);

  const run = async (fn: () => Promise<SharingState | null>) => {
    setBusy(true);
    setError(null);
    try {
      const s = await fn();
      if (s) setSharing(s);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) {
      setError('Enter an e-mail address.');
      return;
    }
    if (await run(() => shares.add(id, addr, role))) setEmail('');
  };

  const remove = async (pilotId: string) => {
    const self = pilotId === pilot.id;
    const ok = await run(async () => {
      await shares.remove(id, pilotId);
      return self ? null : shares.get(id);
    });
    if (ok && self) onLeft?.();
  };

  const canManage = !!sharing?.canManage;
  return (
    <Dialog
      title={`Share ${name}`}
      onClose={onClose}
      busy={busy}
      testId="share-dialog"
      footer={
        <button type="button" className="primary" onClick={onClose} disabled={busy}>
          Done
        </button>
      }
    >
      {loadError ? (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      ) : !sharing ? (
        <Loading variant="sm" />
      ) : (
        <div className="stack share">
          {canManage ? (
            <form className="share-add" onSubmit={add} noValidate>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                placeholder={kind === 'flight' ? 'Add people by e-mail (any address)' : 'Add people by e-mail'}
                aria-label="E-mail address"
                autoComplete="off"
                spellCheck={false}
                data-autofocus
                data-testid="share-email"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ShareRole)}
                aria-label="Role"
                data-testid="share-role"
              >
                <option value="view">Viewer</option>
                <option value="edit">Editor</option>
              </select>
              <button type="submit" className="primary" disabled={busy} data-testid="share-add">
                Share
              </button>
            </form>
          ) : null}
          {error && (
            <p className="form-error" role="alert" data-testid="share-error">
              {error}
            </p>
          )}
          <div>
            <h3 className="share-h">People with access</h3>
            <ul className="share-people" data-testid="share-people">
              {sharing.people.map((p) => {
                const self = p.pilotId === pilot.id;
                const via = p.via?.length ? `through ${p.via.join(', ')}` : '';
                return (
                  <li
                    key={p.pilotId}
                    data-pilot-id={p.pilotId}
                    data-role={p.role}
                    data-pending={p.pending || undefined}
                  >
                    <span className="share-avatar" aria-hidden="true">
                      {(p.name || p.email || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="share-who">
                      <b>
                        {p.name || p.email}
                        {self && <span className="muted"> (you)</span>}
                      </b>
                      {p.name && <span className="hint">{p.email}</span>}
                      {p.pending && (
                        <span className="hint" data-testid="share-pending">
                          Invited · has access once they sign in with this address
                        </span>
                      )}
                      {kind === 'operator' && via && (
                        <span className="hint" data-testid="share-via">
                          Aircraft: {p.via!.join(', ')}
                        </span>
                      )}
                    </span>
                    {p.role === 'owner' ? (
                      <span className="muted share-role">Owner</span>
                    ) : p.direct === false ? (
                      <span className="muted share-role">Viewer (aircraft)</span>
                    ) : canManage ? (
                      <span className="row share-role">
                        <select
                          value={p.role}
                          disabled={busy}
                          aria-label={`Role of ${p.name || p.email}`}
                          onChange={(e) => void run(() => shares.setRole(id, p.pilotId, e.target.value as ShareRole))}
                        >
                          <option value="view">Viewer</option>
                          <option value="edit">Editor</option>
                        </select>
                        <RowRemove
                          disabled={busy}
                          onClick={() => void remove(p.pilotId)}
                          label={self ? 'Remove my access' : `Remove ${p.name || p.email}`}
                        />
                      </span>
                    ) : (
                      <span className="row share-role">
                        <span className="muted">{ROLE_LABEL[p.role]}</span>
                        {self && (
                          <button
                            type="button"
                            className="ghost sm"
                            disabled={busy}
                            onClick={() => void remove(p.pilotId)}
                          >
                            Remove my access
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}
