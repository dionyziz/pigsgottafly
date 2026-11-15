// Share an aircraft, like sharing a Google Doc: add pilots by the e-mail of their Pig's Gotta Fly
// account as viewer or editor, change their role or remove them. The owner is listed first and
// cannot be changed. Viewers see who has access but cannot change it. Also: the "Shared by" chip
// of shared aircraft in the hangar list and on the aircraft page.
import { useEffect, useState } from 'react';
import { useSession } from '../../app/session';
import { api, ApiRequestError } from '../../data/api';
import type { AircraftAccess, AircraftSharing, ShareRole } from '../../shared/sharing';
import { Dialog } from '../lobby/ui';
import './share.css';

export const ROLE_LABEL = { owner: 'Owner', edit: 'Editor', view: 'Viewer' } as const;

/** "Shared by Alice · Viewer" for an aircraft the pilot does not own; nothing for their own. */
export function SharedChip({ access }: { access: AircraftAccess | undefined }) {
  if (!access || access.role === 'owner') return null;
  const by = access.owner.name || access.owner.email;
  return (
    <span className="chip share-chip" title={`Shared with you by ${by}${access.owner.email && access.owner.name ? ` (${access.owner.email})` : ''}`} data-testid="shared-chip">
      Shared by {by} · {ROLE_LABEL[access.role]}
    </span>
  );
}

const message = (e: unknown) => (e instanceof ApiRequestError && e.status === 0 ? 'You are offline.' : String((e as Error)?.message || e));

export function ShareDialog({ aircraftId, registration, onClose, onLeft }: {
  aircraftId: string;
  registration: string;
  onClose: () => void;
  /** The pilot removed their own access (the aircraft left their hangar). */
  onLeft?: () => void;
}) {
  const { pilot } = useSession();
  const [sharing, setSharing] = useState<AircraftSharing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ShareRole>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.shares.get(aircraftId).then((s) => { if (live) setSharing(s); }, (e) => { if (live) setLoadError(message(e)); });
    return () => { live = false; };
  }, [aircraftId]);

  const run = async (fn: () => Promise<AircraftSharing | null>) => {
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
    if (!addr) { setError('Enter the e-mail address of their Pig’s Gotta Fly account.'); return; }
    if (await run(() => api.shares.add(aircraftId, addr, role))) setEmail('');
  };

  const remove = async (pilotId: string) => {
    const self = pilotId === pilot.id;
    const ok = await run(async () => {
      await api.shares.remove(aircraftId, pilotId);
      return self ? null : api.shares.get(aircraftId);
    });
    if (ok && self) onLeft?.();
  };

  const canManage = !!sharing?.canManage;
  return (
    <Dialog title={`Share ${registration}`} onClose={onClose} busy={busy} testId="share-dialog" footer={
      <button type="button" className="primary" onClick={onClose} disabled={busy}>Done</button>
    }>
      {loadError ? <p className="form-error" role="alert">{loadError}</p> : !sharing ? <p className="muted">Loading…</p> : (
        <div className="stack share">
          {canManage ? (
            <form className="share-add" onSubmit={add} noValidate>
              <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder="Add people by e-mail"
                aria-label="E-mail address" autoComplete="off" spellCheck={false} data-autofocus data-testid="share-email" />
              <select value={role} onChange={(e) => setRole(e.target.value as ShareRole)} aria-label="Role" data-testid="share-role">
                <option value="view">Viewer</option>
                <option value="edit">Editor</option>
              </select>
              <button type="submit" className="primary" disabled={busy} data-testid="share-add">Share</button>
            </form>
          ) : (
            <p className="hint" style={{ margin: 0 }}>You can view this aircraft and fly it on your flights. The owner or an editor can change who has access.</p>
          )}
          {error && <p className="form-error" role="alert" data-testid="share-error">{error}</p>}
          <div>
            <h3 className="share-h">People with access</h3>
            <ul className="share-people" data-testid="share-people">
              {sharing.people.map((p) => {
                const self = p.pilotId === pilot.id;
                return (
                  <li key={p.pilotId} data-pilot-id={p.pilotId} data-role={p.role}>
                    <span className="share-avatar" aria-hidden="true">{(p.name || p.email || '?').trim().charAt(0).toUpperCase()}</span>
                    <span className="share-who">
                      <b>{p.name || p.email}{self && <span className="muted"> (you)</span>}</b>
                      {p.name && <span className="hint">{p.email}</span>}
                    </span>
                    {p.role === 'owner' ? (
                      <span className="muted share-role">Owner</span>
                    ) : canManage ? (
                      <span className="row share-role">
                        <select value={p.role} disabled={busy} aria-label={`Role of ${p.name || p.email}`}
                          onChange={(e) => void run(() => api.shares.setRole(aircraftId, p.pilotId, e.target.value as ShareRole))}>
                          <option value="view">Viewer</option>
                          <option value="edit">Editor</option>
                        </select>
                        <button type="button" className="icon sm danger" disabled={busy} onClick={() => void remove(p.pilotId)}
                          aria-label={self ? 'Remove my access' : `Remove ${p.name || p.email}`} title={self ? 'Remove my access' : 'Remove'}>✕</button>
                      </span>
                    ) : (
                      <span className="row share-role">
                        <span className="muted">{ROLE_LABEL[p.role]}</span>
                        {self && <button type="button" className="ghost sm" disabled={busy} onClick={() => void remove(p.pilotId)}>Remove my access</button>}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Viewers can see the aircraft and use it on their own flights. Editors can also change it and share it. Only the owner can delete it.
          </p>
        </div>
      )}
    </Dialog>
  );
}
