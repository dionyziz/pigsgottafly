// General Declaration by e-mail (PLAN-v3 "Sending forms to HCAA by email"), screen only: when the
// departure or destination has no handler, "Send to HCAA" e-mails the GenDec PDF to
// gendec@hcaa.gov.gr (cc and reply-to the pilot), once per flight, with "Re-send" after changes.
// Whether an end is handled comes from the AIP (handling hours, AD 2.3 item 9 / AD 1.6) and the
// flight's NOTAMs at the flight's time there (the server decides: src/calc/aerodromeStatus.ts
// genDecHandling); the reason is shown per end. A per-flight checkbox overrides the decision.
import { useState } from 'react';
import { AipRefText } from '../../../app/AipLink';
import { api, ApiRequestError } from '../../../data/api';
import type { FormsState } from '../../../shared/forms';
import { fmtLocalDayTime } from '../../../shared/format';
import { Chip, Loading, Panel } from '../../../ui';
import type { useFormsState } from '../form731/SignaturesPanel';

const errText = (e: unknown) =>
  e instanceof ApiRequestError ? (e.offline ? 'Offline: try again when connected.' : e.message) : 'The request failed.';

export function GenDecSendPanel({ flightId, forms }: { flightId: string; forms: ReturnType<typeof useFormsState> }) {
  const { st, setSt, err, setErr } = forms;
  const [busy, setBusy] = useState('');
  if (!st) {
    return (
      <Panel title="Send to HCAA" testId="gendec-send">
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
  const g = st.gendec;
  const sub = g.submission;
  const h = g.handling;
  const run = async (what: string, fn: () => Promise<FormsState | void>) => {
    setBusy(what);
    setErr(null);
    try {
      const s = await fn();
      if (s) setSt(s);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy('');
    }
  };
  // The checkbox shows the decision in force; ticking it to the automatic value goes back to automatic.
  const handledNow = !g.pilotSends;
  const setHandled = (v: boolean) =>
    run('handled', () => api.forms.setGenDecHandled(flightId, v === !h.autoPilotSends ? null : v));

  return (
    <Panel
      title="Send to HCAA"
      testId="gendec-send"
      status={
        <Chip tone={g.pilotSends ? (sub && !sub.changed ? 'ok' : 'warn') : 'ok'} testId="gendec-status">
          {!g.pilotSends ? 'Handled' : sub ? (sub.changed ? 'Changed since it was sent' : 'Sent') : 'Not sent'}
        </Chip>
      }
      actions={
        g.pilotSends && (
          <button
            className="primary"
            data-testid="gendec-send-button"
            disabled={!!busy || !st.emailEnabled || (!!sub && !sub.changed) || g.content.placeCount < 2}
            title={!st.emailEnabled ? (st.emailReason ?? '') : undefined}
            onClick={() => run('send', () => api.forms.sendGenDec(flightId))}
          >
            {busy === 'send' ? 'Sending…' : sub ? 'Re-send to HCAA' : 'Send to HCAA'}
          </button>
        )
      }
    >
      {sub && (
        <div className="pgf-note">
          Sent to {sub.to} on {fmtLocalDayTime(sub.sentAt)}
        </div>
      )}
      {g.pilotSends && !st.emailEnabled && <div className="pgf-note">{st.emailReason}</div>}
      {h.ends.length > 0 && (
        <ul className="pgf-note pgf-handling" data-testid="gendec-handling">
          {h.ends.map((e) => (
            <li
              key={e.role}
              data-testid={`gendec-handling-${e.role}`}
              className={e.handled ? undefined : 'is-unhandled'}
            >
              {e.role === 'departure' ? 'Departure' : 'Destination'} <AipRefText text={e.reason} />
            </li>
          ))}
        </ul>
      )}
      <div className="pgf-note pgf-handled">
        <label>
          <input
            type="checkbox"
            checked={handledNow}
            disabled={!!busy}
            onChange={(e) => setHandled(e.target.checked)}
            data-testid="gendec-handled"
          />{' '}
          Submitted by a handler
        </label>
        {h.override !== null && (
          <>
            <Chip sm testId="gendec-override">
              Automatic: {h.autoPilotSends ? 'you send it' : 'handled'}
            </Chip>
            <button
              type="button"
              className="linkish"
              disabled={!!busy}
              onClick={() => run('handled', () => api.forms.setGenDecHandled(flightId, null))}
              data-testid="gendec-handled-auto"
            >
              Use automatic
            </button>
          </>
        )}
      </div>
      {err && (
        <div className="form-error" role="alert">
          {err}
        </div>
      )}
    </Panel>
  );
}
