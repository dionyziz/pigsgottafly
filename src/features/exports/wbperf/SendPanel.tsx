// "Send to <operator>": when the flight's aircraft's operator asks for the W&B and performance
// sheets before each flight (src/shared/operators.ts), e-mails what this page shows, as PDF, to the
// operator's declarations address (the pilot in cc, replies to the pilot), like the GenDec's "Send to
// HCAA" (../gendec/SendPanel.tsx). "Changed since it was sent" compares the hash of what is shown
// now with the version sent; then "Re-send". Screen only.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError } from '../../../data/api';
import { wbPerfText, type DeclarationsState, type WbPerfContent } from '../../../shared';
import { sha256Url } from './declaration';
import '../form731/forms.css';

const pad2 = (n: number) => String(n).padStart(2, '0');
const dayHm = (ms: number) => { const d = new Date(ms); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const errText = (e: unknown) => (e instanceof ApiRequestError ? (e.offline ? 'Offline: try again when connected.' : e.message) : 'The request failed.');

/** The panel, or nothing when the operator does not ask for the sheets. `content`: null while the sheets are loading. */
export function OperatorSendPanel({ flightId, content }: { flightId: string; content: WbPerfContent | null }) {
  const [st, setSt] = useState<DeclarationsState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const load = useCallback(() => { api.declarations.get(flightId).then((s) => { setSt(s); setErr(null); }, (e) => setErr(errText(e))); }, [flightId]);
  useEffect(load, [load]);
  // the operator's settings may change in another tab
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [load]);
  // the content is rebuilt on every render: hash it when its text changes
  const text = content ? wbPerfText(content) : null;
  useEffect(() => {
    let live = true;
    setHash(null);
    if (text) void sha256Url(text).then((h) => { if (live) setHash(h); }, () => {});
    return () => { live = false; };
  }, [text]);

  const op = st?.operator;
  if (!op?.requiresWbPerf) return err ? <div className="pgf-panel no-print"><span className="pgf-err">{err}</span></div> : null;
  const sub = st!.submission;
  const changed = !!sub && ((hash != null && hash !== sub.hash) || sub.to.toLowerCase() !== op.declarationsEmail.toLowerCase());
  const send = async () => {
    if (!content) return;
    setBusy(true);
    setErr(null);
    try { setSt(await api.declarations.send(flightId, content, !!sub)); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const status = !sub ? 'Not sent' : changed ? 'Changed since it was sent' : 'Sent';
  return (
    <div className="pgf-panel no-print" data-testid="operator-send">
      <div className="pgf-panel-head">
        <h3>Send to {op.name}</h3>
        <span className={`chip ${sub && !changed ? 'ok' : 'warn'}`} data-testid="operator-send-status">{status}</span>
        <span className="spacer" />
        <button className="primary" data-testid="operator-send-button" onClick={() => void send()}
          disabled={busy || !content || !st!.emailEnabled || !op.declarationsEmail || (!!sub && !changed)}
          title={!st!.emailEnabled ? st!.emailReason ?? '' : undefined}>
          {busy ? 'Sending…' : sub ? 'Re-send' : `Send to ${op.name}`}
        </button>
      </div>
      <div className="pgf-note">
        {op.name} asks for the weight &amp; balance and performance sheets before each flight: they go as PDF to {op.declarationsEmail || <Link to={`/operators/${op.id}?focus=declarationsEmail`}>an address not set yet</Link>}, with you in copy.
      </div>
      {sub && <div className="pgf-note" data-testid="operator-send-sent">Sent to {sub.to} on {dayHm(sub.sentAt)} (cc you; replies go to you).</div>}
      {!st!.emailEnabled && <div className="pgf-note">{st!.emailReason}</div>}
      {err && <div className="pgf-err" role="alert">{err}</div>}
    </div>
  );
}
