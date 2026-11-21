// "Send to <operator>": when the flight's aircraft's operator asks for the W&B and performance
// sheets before each flight (src/shared/operators.ts), e-mails what this page shows, as PDF, to the
// operator's declarations address (the pilot in cc, replies to the pilot), like the GenDec's "Send to
// HCAA" (../gendec/SendPanel.tsx). "Changed since it was sent" compares the hash of what is shown
// now with the version sent; then "Re-send". Screen only. The operator's settings are refetched when
// an operator or aircraft changes (here or in another tab) and on focus.
import '../form731/forms.css';

import { useEffect, useState } from 'react';

import { FlowLink } from '../../../app/FlowLinks';
import { api, ApiRequestError } from '../../../data/api';
import { useAsync } from '../../../data/useAsync';
import { type WbPerfContent, wbPerfText } from '../../../shared';
import { fmtLocalDayTime } from '../../../shared/format';
import { Chip, Panel } from '../../../ui';
import { sha256Url } from './declaration';

const errText = (e: unknown) =>
  e instanceof ApiRequestError ? (e.offline ? 'Offline: try again when connected.' : e.message) : 'The request failed.';

/** The panel, or nothing when the operator does not ask for the sheets. `content`: null while the sheets are loading. */
export function OperatorSendPanel({ flightId, content }: { flightId: string; content: WbPerfContent | null }) {
  const q = useAsync(() => api.declarations.get(flightId), [flightId], {
    refetchOnFocus: true,
    invalidatedBy: ['operators', 'aircraft', 'flights'],
    cache: `declarations:${flightId}`,
  });
  const st = q.data;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  // the content is rebuilt on every render: hash it when its text changes
  const text = content ? wbPerfText(content) : null;
  useEffect(() => {
    let live = true;
    setHash(null);
    if (text)
      void sha256Url(text).then(
        (h) => {
          if (live) setHash(h);
        },
        () => {},
      );
    return () => {
      live = false;
    };
  }, [text]);

  const loadErr = q.error ? errText(q.error) : null;
  const op = st?.operator;
  if (!st || !op?.requiresWbPerf) {
    return loadErr ? (
      <Panel title="Send to the operator" testId="operator-send">
        <div className="form-error" role="alert">
          {loadErr}
        </div>
      </Panel>
    ) : null;
  }
  const sub = st.submission;
  const changed =
    !!sub && ((hash != null && hash !== sub.hash) || sub.to.toLowerCase() !== op.declarationsEmail.toLowerCase());
  const send = async () => {
    if (!content) return;
    setBusy(true);
    setErr(null);
    try {
      q.setData(await api.declarations.send(flightId, content, !!sub));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const status = !sub ? 'Not sent' : changed ? 'Changed since it was sent' : 'Sent';
  return (
    <Panel
      title={`Send to ${op.name}`}
      testId="operator-send"
      status={
        <Chip tone={sub && !changed ? 'ok' : 'warn'} testId="operator-send-status">
          {status}
        </Chip>
      }
      actions={
        <button
          className="primary"
          data-testid="operator-send-button"
          onClick={() => void send()}
          disabled={busy || !content || !st.emailEnabled || !op.declarationsEmail || (!!sub && !changed)}
          title={!st.emailEnabled ? (st.emailReason ?? '') : undefined}
        >
          {busy ? 'Sending…' : sub ? 'Re-send' : `Send to ${op.name}`}
        </button>
      }
    >
      <div className="pgf-note">
        W&amp;B and performance sheets to{' '}
        {op.declarationsEmail || (
          <FlowLink to={`/operators/${op.id}?focus=declarationsEmail`}>set the address</FlowLink>
        )}
      </div>
      {sub && (
        <div className="pgf-note" data-testid="operator-send-sent">
          Sent to {sub.to} on {fmtLocalDayTime(sub.sentAt)}
        </div>
      )}
      {!st.emailEnabled && <div className="pgf-note">{st.emailReason}</div>}
      {err && (
        <div className="form-error" role="alert">
          {err}
        </div>
      )}
    </Panel>
  );
}
