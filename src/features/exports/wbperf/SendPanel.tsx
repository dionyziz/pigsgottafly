// Shown when the aircraft's operator asks for the W&B and performance sheets before each flight
// (src/shared/operators.ts). The operator's settings are refetched when an operator or aircraft changes
// (here or in another tab) and on focus. What the panel says and offers is ./send.ts (shared with the
// iPhone app).
import '../form731/forms.css';

import { useEffect, useState } from 'react';

import { FlowLink } from '../../../app/FlowLinks';
import { api, ApiRequestError } from '../../../data/api';
import { useAsync } from '../../../data/useAsync';
import { type WbPerfContent, wbPerfText } from '../../../shared';
import { Chip, Panel } from '../../../ui';
import { sha256Url } from './declaration';
import { operatorSendState } from './send';

const errText = (e: unknown) =>
  e instanceof ApiRequestError ? (e.offline ? 'Offline: try again when connected.' : e.message) : 'The request failed.';

/** `content`: null while the sheets are loading. */
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
  const v = operatorSendState(st ?? null, hash, !!content);
  if (!st || !v) {
    return loadErr ? (
      <Panel title="Send to the operator" testId="operator-send">
        <div className="form-error" role="alert">
          {loadErr}
        </div>
      </Panel>
    ) : null;
  }
  const send = async () => {
    if (!content) return;
    setBusy(true);
    setErr(null);
    try {
      q.setData(await api.declarations.send(flightId, content, v.send.resend));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title={v.title}
      testId="operator-send"
      status={
        <Chip tone={v.tone} testId="operator-send-status">
          {v.status}
        </Chip>
      }
      actions={
        <button
          className="primary"
          data-testid="operator-send-button"
          onClick={() => void send()}
          disabled={busy || !v.send.enabled}
          title={v.send.hint ?? undefined}
        >
          {busy ? 'Sending…' : v.send.label}
        </button>
      }
    >
      <div className="pgf-note">
        W&amp;B and performance sheets to {v.address ?? <FlowLink to={v.addressPath}>set the address</FlowLink>}
      </div>
      {v.sent && (
        <div className="pgf-note" data-testid="operator-send-sent">
          {v.sent}
        </div>
      )}
      {v.note != null && <div className="pgf-note">{v.note}</div>}
      {err && (
        <div className="form-error" role="alert">
          {err}
        </div>
      )}
    </Panel>
  );
}
