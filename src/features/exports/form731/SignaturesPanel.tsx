// Form 731 signatures and "Send to HCAA" (PLAN-v3 "Form 731: signatures and submission to HCAA"),
// above the print sheet, screen only:
//   - the PIC is signed automatically; each passenger gets a /sign/<token> link ("Request
//     signatures"), sent with the phone's share sheet or copied; per person: link created, opened,
//     signed, with renew (a new link; the old one stops working) and revoke;
//   - "2 of 3 signed · Maria opened 10:42, not signed"; after a change to the form, who must sign again;
//   - "E-mail" sends a passenger (a saved one with an address) the form as PDF and a new signing link;
//     "E-mail all" does so for everyone who has not signed yet;
//   - when everyone has signed, "Send to HCAA" e-mails the signed PDF to 731@hcaa.gov.gr (cc and
//     reply-to the pilot); sent time, and "Re-send" after changes.
// The state (and the signatures shown on the sheet) come from GET /api/flights/:id/forms.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

import { api, ApiRequestError } from '../../../data/api';
import { fmtLocalClock, fmtLocalDayTime } from '../../../shared/format';
import type { FormsState } from '../../../shared/forms';
import { Chip, Loading, Panel } from '../../../ui';
import type { ShownSignature } from './Form731';

// times shown to the pilot are local (Greek) time
const hm = (ms: number) => fmtLocalClock(ms);
const dayHm = (ms: number) => fmtLocalDayTime(ms);
const firstName = (s: string) => s.trim().split(/\s+/)[0] || s;
const errText = (e: unknown) =>
  e instanceof ApiRequestError ? (e.offline ? 'Offline: try again when connected.' : e.message) : 'The request failed.';

export function useFormsState(flightId: string) {
  const [st, setSt] = useState<FormsState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    api.forms.get(flightId).then(
      (s) => {
        setSt(s);
        setErr(null);
      },
      (e) => setErr(errText(e)),
    );
  }, [flightId]);
  useEffect(load, [load]);
  // signatures arrive while the page is open: refresh when it regains focus
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      window.removeEventListener('focus', on);
    };
  }, [load]);
  return { st, setSt, err, setErr, load };
}

/** Current signatures by person key, for the sheet. */
export function shownSignatures(st: FormsState | null): Record<string, ShownSignature> {
  const out: Record<string, ShownSignature> = {};
  for (const s of st?.form731.signatures ?? [])
    if (s.signed && s.signedAt) out[s.key] = { name: s.name, signedAt: s.signedAt };
  return out;
}

/** "2 of 3 signed · Maria opened 10:42, not signed" */
export function signatureSummary(st: FormsState): string {
  const sigs = st.form731.signatures;
  const n = sigs.filter((s) => s.signed).length;
  const parts = [`${n} of ${sigs.length} signed`];
  for (const s of sigs) {
    if (s.signed) continue;
    const who = firstName(s.name || 'Passenger');
    if (s.needsResign) parts.push(`${who} must sign again`);
    else if (s.link?.lastOpened) parts.push(`${who} opened ${hm(s.link.lastOpened)}, not signed`);
    else if (s.link && !s.link.revoked) parts.push(`${who} has not opened the link`);
    else if (s.role === 'PAX') parts.push(`${who}: no link yet`);
  }
  return parts.join(' · ');
}

export function SignaturesPanel({ flightId, forms }: { flightId: string; forms: ReturnType<typeof useFormsState> }) {
  const { st, setSt, err, setErr } = forms;
  const [busy, setBusy] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState('');
  const run = async (what: string, ...fns: (() => Promise<FormsState>)[]) => {
    setBusy(what);
    setErr(null);
    try {
      for (const fn of fns) {
        const s = await fn();
        if (s.links) setLinks((l) => ({ ...l, ...s.links }));
        setSt(s);
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy('');
    }
  };
  if (!st) {
    return (
      <Panel title="Signatures" testId="f731-signatures">
        {err ? (
          <div className="form-error" role="alert">
            {err}
          </div>
        ) : (
          <Loading variant="sm" />
        )}
      </Panel>
    );
  }

  const url = (token: string) => `${window.location.origin}/sign/${token}`;
  const share = async (name: string, token: string) => {
    const u = url(token);
    const text = `Please sign Form 731 (persons boarding) for our flight${st.form731.content.date ? ` on ${st.form731.content.date}` : ''}, ${name}:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Form 731', text, url: u });
        return;
      } catch {
        /* cancelled: fall back to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(u);
      setCopied(token);
      window.setTimeout(() => setCopied(''), 2000);
    } catch {
      /* the link stays visible to copy by hand */
    }
  };
  const f = st.form731;
  const sub = f.submission;
  const pax = f.signatures.filter((s) => s.role === 'PAX');
  const needLinks = pax.some((s) => !s.signed && (!s.link || s.link.revoked || s.link.expires < Date.now()));
  const toEmail = pax.filter((s) => s.email && !s.signed);
  const email = (key: string) => () => api.forms.email731(flightId, key);

  return (
    <Panel
      title="Signatures"
      testId="f731-signatures"
      status={
        <Chip tone={f.allSigned ? 'ok' : 'warn'} testId="f731-summary">
          {signatureSummary(st)}
        </Chip>
      }
      actions={
        <>
          {pax.length > 0 && (
            <button
              onClick={() => run('links', () => api.forms.requestLinks(flightId))}
              disabled={!!busy || !needLinks}
              data-testid="f731-request"
            >
              {busy === 'links' ? 'Creating links…' : 'Request signatures'}
            </button>
          )}
          {pax.some((s) => s.email) && (
            <button
              onClick={() => run('email-all', ...toEmail.map((s) => email(s.key)))}
              disabled={!!busy || !toEmail.length || !st.emailEnabled}
              title={!st.emailEnabled ? (st.emailReason ?? '') : undefined}
              data-testid="f731-email-all"
            >
              {busy === 'email-all' ? 'E-mailing…' : 'E-mail all'}
            </button>
          )}
          <button
            className="primary"
            data-testid="f731-send"
            disabled={!!busy || !f.allSigned || !st.emailEnabled || (!!sub && !sub.changed)}
            title={!st.emailEnabled ? (st.emailReason ?? '') : !f.allSigned ? 'Everyone has to sign first' : undefined}
            onClick={() => run('send', () => api.forms.send731(flightId))}
          >
            {busy === 'send' ? 'Sending…' : sub ? 'Re-send to HCAA' : 'Send to HCAA'}
          </button>
        </>
      }
    >
      {sub && (
        <div className="pgf-note" data-testid="f731-sent">
          Sent to {sub.to} on {dayHm(sub.sentAt)}
          {sub.changed ? ' · changed since' : ''}
        </div>
      )}
      {!st.emailEnabled && <div className="pgf-note">{st.emailReason}</div>}
      {err && (
        <div className="form-error" role="alert">
          {err}
        </div>
      )}
      <ul className="pgf-people">
        {f.signatures.map((s) => {
          const token = links[s.key];
          const l = s.link;
          const status = s.signed
            ? `signed ${dayHm(s.signedAt!)}`
            : s.needsResign
              ? 'the form changed after signing: must sign again'
              : l && !l.revoked
                ? l.lastOpened
                  ? `link opened ${dayHm(l.lastOpened)}, not signed`
                  : `link created ${dayHm(l.created)}, not opened`
                : s.role === 'PAX'
                  ? 'no link'
                  : 'not signed (set your full name in the profile)';
          return (
            <li key={s.key} className="pgf-person" data-testid={`f731-person-${s.role}`}>
              <span className="pgf-person-name">{s.name || '(no name)'}</span>
              <span className={`pgf-person-status${s.signed ? '' : ' muted'}`}>
                {status}
                {s.emailedAt != null && <span data-testid="f731-emailed"> · e-mailed {dayHm(s.emailedAt)}</span>}
              </span>
              {s.role === 'PAX' && l && !l.revoked && (
                <>
                  <button
                    className="ghost"
                    disabled={!!busy}
                    onClick={() => run(`renew-${s.key}`, () => api.forms.renewLink(flightId, s.key))}
                  >
                    New link
                  </button>
                  <button
                    className="ghost danger"
                    disabled={!!busy}
                    onClick={() => run(`revoke-${s.key}`, () => api.forms.revokeLink(flightId, s.key))}
                  >
                    Revoke
                  </button>
                </>
              )}
              {s.role === 'PAX' && l?.revoked && !token && (
                <button
                  className="ghost"
                  disabled={!!busy}
                  onClick={() => run(`renew-${s.key}`, () => api.forms.renewLink(flightId, s.key))}
                >
                  New link
                </button>
              )}
              {s.role === 'PAX' && s.email && (
                <button
                  className="ghost"
                  disabled={!!busy || !st.emailEnabled}
                  title={s.email}
                  onClick={() => run(`email-${s.key}`, email(s.key))}
                  data-testid="f731-email"
                >
                  {busy === `email-${s.key}` ? 'E-mailing…' : 'E-mail'}
                </button>
              )}
              {s.role === 'PAX' && !s.email && !s.key.startsWith('seat:') && (
                <Link
                  className="btn ghost"
                  to={`/passengers?edit=${encodeURIComponent(s.key)}&fields=email`}
                  data-testid="f731-add-email"
                >
                  Add e-mail
                </Link>
              )}
              {token && (
                <span className="pgf-link">
                  <input
                    readOnly
                    value={url(token)}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={`Signing link for ${s.name}`}
                    data-testid="f731-link"
                  />
                  <button onClick={() => share(s.name, token)}>
                    {copied === token ? 'Copied' : typeof navigator.share === 'function' ? 'Share…' : 'Copy'}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {Object.keys(links).length > 0 && <div className="pgf-note">Links are shown once.</div>}
    </Panel>
  );
}
