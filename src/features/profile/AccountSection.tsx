// Profile, below the form: "Your data" (GET /api/me/export, a JSON download: GDPR portability) and
// the danger zone (DELETE /api/me after typing the account's e-mail; "delete" in local mode).
// After deletion the browser's local copies (offline flights, layout preferences) are cleared too.
import './profile.css';

import { useState } from 'react';

import { usePilot } from '../../app/session';
import { api } from '../../data/api';
import { errorMessage } from '../../shared/format';
import { CardSection, Field } from '../../ui';

export function AccountSection() {
  const pilot = usePilot();
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
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* blocked storage */
      }
      try {
        (window as any).google?.accounts?.id?.disableAutoSelect?.();
      } catch {
        /* ignore */
      }
      window.location.assign('/');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  const cancel = () => {
    setOpen(false);
    setTyped('');
    setError(null);
  };

  return (
    <div className="card account-card" data-testid="account-section">
      <CardSection id="your-data" title="Your data" plain intro="Everything your account holds, as a JSON file.">
        <div>
          <a className="btn" href="/api/me/export" download data-testid="export-data">
            Download my data
          </a>
        </div>
      </CardSection>
      <CardSection
        id="delete-account"
        title="Delete account"
        plain
        className="danger-zone"
        testId="danger-zone"
        intro="Deletes your account and everything in it, including the aircraft you own (also for the pilots you shared them with). This cannot be undone."
      >
        {!open ? (
          <div>
            <button type="button" className="ghost danger" onClick={() => setOpen(true)} data-testid="delete-account">
              Delete account…
            </button>
          </div>
        ) : (
          <form
            className="stack delete-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (matches && !busy) void remove();
            }}
            noValidate
          >
            <Field
              label={
                <>
                  Type <b>{expected}</b> to confirm
                </>
              }
              error={error}
            >
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                data-testid="delete-confirm"
                aria-label="Confirmation"
              />
            </Field>
            <div className="row">
              <button
                type="submit"
                className="primary danger-fill"
                disabled={!matches || busy}
                data-testid="delete-account-confirm"
              >
                {busy ? 'Deleting…' : 'Delete my account'}
              </button>
              <button type="button" className="ghost" onClick={cancel} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </CardSection>
    </div>
  );
}
