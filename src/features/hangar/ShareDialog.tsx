// Sharing like a Google Doc. An operator also lists the pilots who see it through one of its aircraft
// (changed by sharing that aircraft). A flight or an aircraft can also be shared with an address no
// account uses yet (an aircraft through an invitation to the app): it is listed as pending until
// someone signs in with it; removing a pending aircraft leaves the invitation to the app.
import './share.css';

import { useEffect, useState } from 'react';

import { useSession } from '../../app/session';
import { api } from '../../data/api';
import { errorMessage } from '../../shared/format';
import {
  type AircraftAccess,
  type ManifestContact,
  passengerShareSuggestions,
  type ShareRole,
} from '../../shared/sharing';
import { Chip, Dialog, Loading, RowRemove } from '../../ui';
import { emailError, sharedBy, shareRows, type SharingState } from './shareModel';

/** "Shared by Alice · Viewer" for an aircraft the pilot does not own; nothing for their own. */
export function SharedChip({ access }: { access: Pick<AircraftAccess, 'role' | 'owner'> | undefined }) {
  const chip = sharedBy(access);
  if (!chip) return null;
  return (
    <Chip className="share-chip" title={chip.title} testId="shared-chip">
      {chip.text}
    </Chip>
  );
}

const message = errorMessage;

const API = { aircraft: api.shares, operator: api.operatorShares, flight: api.flightShares } as const;

export function ShareDialog({
  kind = 'aircraft',
  id,
  name,
  onClose,
  onLeft,
  passengers,
}: {
  kind?: 'aircraft' | 'operator' | 'flight';
  id: string;
  name: string;
  onClose: () => void;
  /** A flight's manifest passengers with an e-mail: those without access are offered as viewers. */
  passengers?: ManifestContact[];
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
    const invalid = emailError(addr);
    if (invalid) {
      setError(invalid);
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
  const suggestions = sharing?.canManage && passengers ? passengerShareSuggestions(passengers, sharing.people) : [];
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
                placeholder="Add people by email"
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
          {suggestions.length > 0 && (
            <div>
              <h3 className="share-h">Passengers on this flight</h3>
              <ul className="share-people" data-testid="share-suggestions">
                {suggestions.map((p) => (
                  <li key={p.email} data-email={p.email}>
                    <span className="share-avatar" aria-hidden="true">
                      {p.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="share-who">
                      <b>{p.name}</b>
                      {p.name !== p.email && <span className="hint">{p.email}</span>}
                    </span>
                    <button
                      type="button"
                      className="sm share-role"
                      disabled={busy}
                      onClick={() => void run(() => shares.add(id, p.email, 'view'))}
                      aria-label={`Share with ${p.name} as viewer`}
                      data-testid="share-suggestion-add"
                    >
                      Share (view)
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="share-h">People with access</h3>
            <ul className="share-people" data-testid="share-people">
              {shareRows(sharing, pilot.id, kind).map((p) => (
                <li key={p.key} data-pilot-id={p.key} data-role={p.role} data-pending={p.pending || undefined}>
                  <span className="share-avatar" aria-hidden="true">
                    {p.initial}
                  </span>
                  <span className="share-who">
                    <b>
                      {p.name}
                      {p.self && <span className="muted"> (you)</span>}
                    </b>
                    {p.email && <span className="hint">{p.email}</span>}
                    {p.note && (
                      <span className="hint" data-testid="share-pending">
                        {p.note}
                      </span>
                    )}
                    {p.via && (
                      <span className="hint" data-testid="share-via">
                        {p.via}
                      </span>
                    )}
                  </span>
                  {p.control === 'owner' || p.control === 'aircraft' ? (
                    <span className="muted share-role">{p.roleLabel}</span>
                  ) : p.control === 'manage' ? (
                    <span className="row share-role">
                      <select
                        value={p.role}
                        disabled={busy}
                        aria-label={`Role of ${p.name}`}
                        onChange={(e) => void run(() => shares.setRole(id, p.key, e.target.value as ShareRole))}
                      >
                        <option value="view">Viewer</option>
                        <option value="edit">Editor</option>
                      </select>
                      <RowRemove disabled={busy} onClick={() => void remove(p.key)} label={p.removeLabel} />
                    </span>
                  ) : (
                    <span className="row share-role">
                      <span className="muted">{p.roleLabel}</span>
                      {p.canRemove && (
                        <button type="button" className="ghost sm" disabled={busy} onClick={() => void remove(p.key)}>
                          {p.removeLabel}
                        </button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}
