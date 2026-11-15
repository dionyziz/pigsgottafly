// Profile, below the form: "Your data" (GET /api/me/export, a JSON download: GDPR portability) and
// the danger zone (DELETE /api/me after typing the account's e-mail; "delete" in local mode).
// After deletion the browser's local copies (offline flights, layout preferences) are cleared too.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../app/session';
import { api } from '../../data/api';

export function AccountSection() {
  const { pilot } = useSession();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = pilot.email.trim() || 'delete';
  const matches = typed.trim().toLowerCase() === expected.toLowerCase();

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.me.remove(typed.trim());
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked storage */ }
      try { (window as any).google?.accounts?.id?.disableAutoSelect?.(); } catch { /* ignore */ }
      window.location.assign('/');
    } catch (e) {
      setError(String((e as Error).message || e));
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 760, marginTop: 'var(--s5)' }} data-testid="account-section">
      <section className="form-section">
        <header>
          <h2>Your data</h2>
          <p>A copy of everything your account holds: profile, passengers, aircraft (with the list of their files), flights, waypoints and sharing, as a JSON file. See the <Link to="/privacy">Privacy Policy</Link>.</p>
        </header>
        <div><a className="btn" href="/api/me/export" download data-testid="export-data">Download my data</a></div>
      </section>
      <section className="form-section" style={{ background: 'var(--danger-soft)', borderBottomLeftRadius: 'var(--r-lg)', borderBottomRightRadius: 'var(--r-lg)' }} data-testid="danger-zone">
        <header>
          <h2 style={{ color: 'var(--danger)' }}>Delete account</h2>
          <p style={{ color: 'var(--ink-2)' }}>
            Deletes your account and everything in it at once: profile, passengers, waypoints, all flights including the trash, the aircraft you
            own with their files (also for the pilots you shared them with), sharing, signing links and signatures. This cannot be undone.
          </p>
        </header>
        {!open ? (
          <div><button type="button" className="danger" onClick={() => setOpen(true)} data-testid="delete-account">Delete account…</button></div>
        ) : (
          <form className="stack" style={{ maxWidth: 420 }} onSubmit={(e) => { e.preventDefault(); if (matches && !busy) void remove(); }}>
            <label className="field">
              <span>Type <b style={{ color: 'var(--ink)' }}>{expected}</b> to confirm</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} data-testid="delete-confirm" aria-label="Confirmation" />
            </label>
            {error && <p className="form-error" role="alert" style={{ margin: 0 }}>{error}</p>}
            <div className="row">
              <button type="submit" className="primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={!matches || busy} data-testid="delete-account-confirm">
                {busy ? 'Deleting…' : 'Delete my account'}
              </button>
              <button type="button" className="ghost" onClick={() => { setOpen(false); setTyped(''); setError(null); }} disabled={busy}>Cancel</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
