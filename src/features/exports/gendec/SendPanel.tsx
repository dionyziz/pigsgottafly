// General Declaration by e-mail (PLAN-v3 "Sending forms to HCAA by email"), screen only: when the
// departure or destination has no handler, "Send to HCAA" e-mails the GenDec PDF to
// gendec@hcaa.gov.gr (cc and reply-to the pilot), once per flight, with "Re-send" after changes.
// A per-aerodrome "handled" flag (the handler submits the GenDec; the pilot's profile setting
// handledAerodromes) hides the button for flights between handled aerodromes.
import { useState } from 'react';
import { api, ApiRequestError } from '../../../data/api';
import { useSession } from '../../../app/session';
import type { FormsState } from '../../../shared/forms';
import type { useFormsState } from '../form731/SignaturesPanel';

const pad2 = (n: number) => String(n).padStart(2, '0');
const dayHm = (ms: number) => { const d = new Date(ms); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const errText = (e: unknown) => (e instanceof ApiRequestError ? (e.offline ? 'Offline: try again when connected.' : e.message) : 'The request failed.');

export function GenDecSendPanel({ flightId, forms }: { flightId: string; forms: ReturnType<typeof useFormsState> }) {
  const { st, setSt, err, setErr, load } = forms;
  const { pilot, setPilot } = useSession();
  const [busy, setBusy] = useState('');
  if (!st) return <div className="pgf-panel no-print" data-testid="gendec-send">{err ? <span className="pgf-err">{err}</span> : <span className="muted">Loading…</span>}</div>;
  const g = st.gendec;
  const sub = g.submission;
  const handled = new Set(pilot.settings.handledAerodromes ?? []);
  const ends = [...new Set([g.content.departureIcao, g.content.arrivalIcao].filter((x): x is string => !!x))];
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
  const toggle = (icao: string, on: boolean) => run(`h-${icao}`, async () => {
    const next = new Set(handled);
    if (on) next.add(icao); else next.delete(icao);
    setPilot(await api.me.update({ settings: { handledAerodromes: [...next].sort() } }));
    load();
  });

  return (
    <div className="pgf-panel no-print" data-testid="gendec-send">
      <div className="pgf-panel-head">
        <h3>Send to HCAA</h3>
        <span className={`chip ${g.pilotSends ? (sub && !sub.changed ? 'ok' : 'warn') : 'ok'}`}>
          {!g.pilotSends ? 'Handled: the handler submits the General Declaration' : sub ? (sub.changed ? 'Changed since it was sent' : 'Sent') : 'Not sent'}
        </span>
        <span className="spacer" />
        {g.pilotSends && (
          <button className="primary" data-testid="gendec-send-button" disabled={!!busy || !st.emailEnabled || (!!sub && !sub.changed) || g.content.placeCount < 2}
            title={!st.emailEnabled ? st.emailReason ?? '' : undefined}
            onClick={() => run('send', () => api.forms.sendGenDec(flightId))}>
            {busy === 'send' ? 'Sending…' : sub ? 'Re-send to HCAA' : 'Send to HCAA'}
          </button>
        )}
      </div>
      {sub && <div className="pgf-note">Sent to {sub.to} on {dayHm(sub.sentAt)} (cc you; replies go to you).</div>}
      {g.pilotSends && !st.emailEnabled && <div className="pgf-note">{st.emailReason}</div>}
      {ends.length > 0 && (
        <div className="pgf-note">
          A handler submits the General Declaration at:{' '}
          {ends.map((icao) => (
            <label key={icao} style={{ marginRight: 12 }}>
              <input type="checkbox" checked={handled.has(icao)} disabled={!!busy} onChange={(e) => toggle(icao, e.target.checked)} data-testid={`gendec-handled-${icao}`} /> {icao}
            </label>
          ))}
        </div>
      )}
      {err && <div className="pgf-err" role="alert">{err}</div>}
    </div>
  );
}
