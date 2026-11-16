// Top-right account menu: Profile, Hangar, Operators, Passengers, My waypoints, (admins: Admin), About,
// Terms, Privacy, Sign out, Sign out everywhere (confirmed).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from './session';
import { ConfirmDialog } from '../ui';

export function AccountMenu() {
  const { pilot, session, signOut, signOutEverywhere } = useSession();
  const [open, setOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const name = pilot.fullName || pilot.name || (session.mode === 'local' ? 'Local pilot' : pilot.email);
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="avatar" aria-label="Account" title={name} onClick={() => setOpen((o) => !o)} data-testid="account-button">
        {pilot.picture ? <img src={pilot.picture} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span>}
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          <div className="who"><b>{name}</b>{pilot.email && <span className="muted">{pilot.email}</span>}</div>
          <hr />
          <Link to="/profile" role="menuitem">Profile</Link>
          <Link to="/hangar" role="menuitem">Hangar</Link>
          <Link to="/operators" role="menuitem">Operators</Link>
          <Link to="/passengers" role="menuitem">Passengers</Link>
          <Link to="/waypoints" role="menuitem">My waypoints</Link>
          {session.admin && <><hr /><Link to="/admin" role="menuitem" data-testid="admin-link">Admin</Link></>}
          <hr />
          <Link to="/about" role="menuitem">About</Link>
          <Link to="/terms" role="menuitem" className="minor">Terms of Service</Link>
          <Link to="/privacy" role="menuitem" className="minor">Privacy Policy</Link>
          {session.mode === 'google' && (<>
            <hr />
            <button role="menuitem" onClick={() => void signOut()}>Sign out</button>
            <button role="menuitem" className="minor" data-testid="sign-out-everywhere" onClick={() => setConfirmAll(true)}>Sign out everywhere</button>
          </>)}
        </div>
      )}
      {confirmAll && (
        <ConfirmDialog title="Sign out everywhere?" confirmLabel="Sign out everywhere" testId="sign-out-everywhere-dialog"
          onConfirm={signOutEverywhere} onClose={() => setConfirmAll(false)}>
          Every device where you are signed in, this one included, will need to sign in again.
        </ConfirmDialog>
      )}
    </div>
  );
}
