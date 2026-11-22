// Inviting pilots to the app by e-mail, with some of the aircraft the pilot may share (owner or
// editor), and the invitations still open (src/shared/sharing.ts, api/_lib/routes/invitations.ts).
import './share.css';

import { useEffect, useState } from 'react';

import { api } from '../../data/api';
import { useEntity } from '../../data/entities';
import { errorMessage } from '../../shared/format';
import type { PilotInvitation, ShareRole } from '../../shared/sharing';
import { Dialog, Loading } from '../../ui';
import { ROLE_LABEL } from './ShareDialog';

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const { data: hangar } = useEntity('aircraft');
  const shareable = (hangar ?? []).filter((a) => a.access.role !== 'view');
  const [invitations, setInvitations] = useState<PilotInvitation[] | null>(null);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Map<string, ShareRole>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.invitations.list().then(
      (l) => {
        if (live) setInvitations(l);
      },
      (e) => {
        if (live) setError(errorMessage(e));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const pick = (id: string, role: ShareRole | null) =>
    setPicked((m) => {
      const n = new Map(m);
      if (role) n.set(id, role);
      else n.delete(id);
      return n;
    });

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) {
      setError('Enter an e-mail address.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api.invitations.create({
        email: addr,
        message: note.trim(),
        aircraft: [...picked].map(([aircraftId, role]) => ({ aircraftId, role })),
      });
      setInvitations(r.invitations);
      setDone(
        r.existing
          ? `${addr} already uses Pig’s Gotta Fly: shared ${r.shared.join(', ')} with them.`
          : `Invited ${addr}.`,
      );
      setEmail('');
      setNote('');
      setPicked(new Map());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (inv: PilotInvitation) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.invitations.cancel(inv.id);
      setInvitations((l) => (l ?? []).filter((x) => x.id !== inv.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Invite pilots"
      onClose={onClose}
      busy={busy}
      testId="invite-dialog"
      footer={
        <button type="button" className="primary" onClick={onClose} disabled={busy}>
          Done
        </button>
      }
    >
      <div className="stack share">
        <form className="stack invite-form" onSubmit={invite} noValidate>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="E-mail address"
            aria-label="E-mail address"
            autoComplete="off"
            spellCheck={false}
            data-autofocus
            data-testid="invite-email"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
            rows={2}
            maxLength={500}
            data-testid="invite-note"
          />
          {shareable.length > 0 && (
            <fieldset className="invite-aircraft" data-testid="invite-aircraft">
              <legend className="share-h">Share aircraft</legend>
              {shareable.map((a) => {
                const role = picked.get(a.id);
                return (
                  <div key={a.id} className="invite-ac" data-aircraft-id={a.id}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!role}
                        onChange={(e) => pick(a.id, e.target.checked ? 'view' : null)}
                      />{' '}
                      <span className="mono">{a.registration}</span>
                      {a.makeModel && <span className="muted"> {a.makeModel}</span>}
                    </label>
                    {role && (
                      <select
                        value={role}
                        onChange={(e) => pick(a.id, e.target.value as ShareRole)}
                        aria-label={`Role on ${a.registration}`}
                      >
                        <option value="view">Viewer</option>
                        <option value="edit">Editor</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}
          <div className="row">
            <button type="submit" className="primary" disabled={busy} data-testid="invite-send">
              Invite
            </button>
          </div>
        </form>
        {error && (
          <p className="form-error" role="alert" data-testid="invite-error">
            {error}
          </p>
        )}
        {done && (
          <p className="hint" role="status" data-testid="invite-done">
            {done}
          </p>
        )}
        {invitations === null ? (
          <Loading variant="sm" />
        ) : (
          invitations.length > 0 && (
            <div>
              <h3 className="share-h">Invited</h3>
              <ul className="share-people" data-testid="invitations">
                {invitations.map((inv) => (
                  <li key={inv.id} data-invitation-id={inv.id} data-email={inv.email}>
                    <span className="share-avatar" aria-hidden="true">
                      {inv.email.charAt(0).toUpperCase()}
                    </span>
                    <span className="share-who">
                      <b>{inv.email}</b>
                      {inv.aircraft.length > 0 && (
                        <span className="hint" data-testid="invitation-aircraft">
                          {inv.aircraft.map((a) => `${a.registration} (${ROLE_LABEL[a.role]})`).join(', ')}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="ghost sm"
                      disabled={busy}
                      onClick={() => void cancel(inv)}
                      data-testid="invitation-cancel"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
      </div>
    </Dialog>
  );
}
