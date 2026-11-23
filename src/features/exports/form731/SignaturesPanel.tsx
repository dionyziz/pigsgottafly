// Form 731 signatures and "Send to HCAA" (PLAN-v3 "Form 731: signatures and submission to HCAA"),
// screen only. The state (and the signatures shown on the sheet) come from GET /api/flights/:id/forms;
// what each person's line says and offers is ./signatures.ts (shared with the iPhone app).
import { useCallback, useState } from 'react';

import { FlowLink } from '../../../app/FlowLinks';
import { api, ApiRequestError } from '../../../data/api';
import { useAsync } from '../../../data/useAsync';
import { fmtLocalDayTime } from '../../../shared/format';
import type { FormsState } from '../../../shared/forms';
import { Chip, Loading, Panel } from '../../../ui';
import {
  addEmailPath,
  form731Actions,
  personActions,
  signatureStatus,
  signatureSummary,
  signingShare,
} from './signatures';

export { shownSignatures, signatureSummary } from './signatures';

const dayHm = (ms: number) => fmtLocalDayTime(ms);
const errText = (e: unknown) =>
  e instanceof ApiRequestError ? (e.offline ? 'Offline: try again when connected.' : e.message) : 'The request failed.';

export function useFormsState(flightId: string) {
  // kept for the session (coming back shows it at once); refetched when the page regains focus,
  // since signatures arrive while it is open, and when a passenger changes (an e-mail added)
  const q = useAsync(() => api.forms.get(flightId), [flightId], {
    cache: `forms:${flightId}`,
    refetchOnFocus: true,
    invalidatedBy: 'passengers',
  });
  const [actionErr, setErr] = useState<string | null>(null);
  const err = actionErr ?? (q.error && !q.data ? errText(q.error) : null);
  const { reload } = q;
  const load = useCallback(() => void reload(), [reload]);
  return { st: q.data ?? null, setSt: q.setData as (s: FormsState) => void, err, setErr, load };
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

  const share = async (name: string, token: string) => {
    const { url: u, text } = signingShare(st, name, token, window.location.origin);
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
  const act = form731Actions(st);
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
          {act.request.shown && (
            <button
              onClick={() => run('links', () => api.forms.requestLinks(flightId))}
              disabled={!!busy || !act.request.enabled}
              data-testid="f731-request"
            >
              {busy === 'links' ? 'Creating links…' : 'Request signatures'}
            </button>
          )}
          {act.emailAll.shown && (
            <button
              onClick={() => run('email-all', ...act.emailAll.keys.map(email))}
              disabled={!!busy || !act.emailAll.enabled}
              title={act.emailAll.hint ?? undefined}
              data-testid="f731-email-all"
            >
              {busy === 'email-all' ? 'E-mailing…' : 'E-mail all'}
            </button>
          )}
          <button
            className="primary"
            data-testid="f731-send"
            disabled={!!busy || !act.send.enabled}
            title={act.send.hint ?? undefined}
            onClick={() => run('send', () => api.forms.send731(flightId))}
          >
            {busy === 'send' ? 'Sending…' : act.send.label}
          </button>
        </>
      }
    >
      {act.sent && (
        <div className="pgf-note" data-testid="f731-sent">
          {act.sent}
        </div>
      )}
      {act.note != null && <div className="pgf-note">{act.note}</div>}
      {err && (
        <div className="form-error" role="alert">
          {err}
        </div>
      )}
      <ul className="pgf-people">
        {f.signatures.map((s) => {
          const token = links[s.key];
          const can = personActions(s, !!token);
          return (
            <li key={s.key} className="pgf-person" data-testid={`f731-person-${s.role}`}>
              <span className="pgf-person-name">{s.name || '(no name)'}</span>
              <span className={`pgf-person-status${s.signed ? '' : ' muted'}`}>
                {signatureStatus(s)}
                {s.emailedAt != null && <span data-testid="f731-emailed"> · e-mailed {dayHm(s.emailedAt)}</span>}
              </span>
              {can.renew && (
                <button
                  className="ghost"
                  disabled={!!busy}
                  onClick={() => run(`renew-${s.key}`, () => api.forms.renewLink(flightId, s.key))}
                >
                  New link
                </button>
              )}
              {can.revoke && (
                <button
                  className="ghost danger"
                  disabled={!!busy}
                  onClick={() => run(`revoke-${s.key}`, () => api.forms.revokeLink(flightId, s.key))}
                >
                  Revoke
                </button>
              )}
              {can.email && (
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
              {can.addEmail && (
                <FlowLink className="btn ghost" to={addEmailPath(s.key)} data-testid="f731-add-email">
                  Add e-mail
                </FlowLink>
              )}
              {token && (
                <span className="pgf-link">
                  <input
                    readOnly
                    value={signingShare(st, s.name, token, window.location.origin).url}
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
