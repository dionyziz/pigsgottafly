// General Declaration by e-mail (PLAN-v3 "Sending forms to HCAA by email"), screen only: when the
// departure or destination has no handler, "Send to HCAA" e-mails the GenDec PDF to
// gendec@hcaa.gov.gr (cc and reply-to the pilot), once per flight, with "Re-send" after changes.
// Whether an end is handled comes from the AIP (handling hours, AD 2.3 item 9 / AD 1.6) and the
// flight's NOTAMs at the flight's time there (the server decides: src/calc/aerodromeStatus.ts
// genDecHandling); the reason is shown per end. A per-flight checkbox overrides the decision.
// What the panel says and offers is ./send.ts (shared with the iPhone app).
import { useState } from 'react';

import { AipRefText } from '../../../app/AipLink';
import { api, ApiRequestError } from '../../../data/api';
import type { FormsState } from '../../../shared/forms';
import { Chip, Loading, Panel } from '../../../ui';
import type { useFormsState } from '../form731/SignaturesPanel';
import { genDecHandledOverride, genDecSendState } from './send';

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
  const v = genDecSendState(st);
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
  const setHandled = (on: boolean) =>
    run('handled', () => api.forms.setGenDecHandled(flightId, genDecHandledOverride(st.gendec.handling, on)));

  return (
    <Panel
      title="Send to HCAA"
      testId="gendec-send"
      status={
        <Chip tone={v.tone} testId="gendec-status">
          {v.status}
        </Chip>
      }
      actions={
        v.send && (
          <button
            className="primary"
            data-testid="gendec-send-button"
            disabled={!!busy || !v.send.enabled}
            title={v.send.hint ?? undefined}
            onClick={() => run('send', () => api.forms.sendGenDec(flightId))}
          >
            {busy === 'send' ? 'Sending…' : v.send.label}
          </button>
        )
      }
    >
      {v.sent && <div className="pgf-note">{v.sent}</div>}
      {v.note != null && <div className="pgf-note">{v.note}</div>}
      {v.ends.length > 0 && (
        <ul className="pgf-note pgf-handling" data-testid="gendec-handling">
          {v.ends.map((e) => (
            <li
              key={e.role}
              data-testid={`gendec-handling-${e.role}`}
              className={e.handled ? undefined : 'is-unhandled'}
            >
              {e.label} <AipRefText text={e.reason} />
            </li>
          ))}
        </ul>
      )}
      <div className="pgf-note pgf-handled">
        <label>
          <input
            type="checkbox"
            checked={v.handled}
            disabled={!!busy}
            onChange={(e) => setHandled(e.target.checked)}
            data-testid="gendec-handled"
          />{' '}
          Submitted by a handler
        </label>
        {v.automatic && (
          <>
            <Chip sm testId="gendec-override">
              {v.automatic}
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
