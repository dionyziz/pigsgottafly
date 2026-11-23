// Filing through the server's filing backends (api/_lib/filers/: autorouter, fax; PLAN-v3 "Filing the
// flight plan via autorouter" and "Flight plan addressing (Greek VFR)"). The panel says which service
// filed the plan and what it can tell: autorouter reports ATC's acknowledgement or rejection, a fax only
// its delivery. The AFTN addressees the server proposes from AIP Greece ENR 1.11
// (api/_lib/addressees.ts) are still shown when the server cannot file, for filing by other means.
// autorouter files with the pilot's own account: until it is linked, the panel offers to connect it
// (and comes back here).
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';

import { api, ApiRequestError, autorouterConnectUrl, peekGet } from '../../../data/api';
import { invalidate } from '../../../data/entities';
import type { Flight } from '../../../shared';
import type { FilerId, FilingState } from '../../../shared/briefing';
import { fmtDateTimeMs } from '../../../shared/format';
import { Chip, Loading, Panel } from '../../../ui';
import { ExportWarnings } from '../WarningList';
import {
  actionError,
  aftnAddress,
  DELAY_STEPS_MIN,
  delayCheck,
  delayStart,
  fileRequest,
  filingView,
  fromUtcInput,
  loadError,
  utcInput,
} from './filing';

export { filedVia } from './filing';

const dateTimeZ = (ms: number) => fmtDateTimeMs(ms);

export interface FilingPanelProps {
  flight: Flight;
  message: string;
  /** False while the message has ???? fields: filing is refused. */
  complete: boolean;
  onAddresses?: (addresses: string[]) => void;
  /** The panel's heading (default 'Filing'; the editor's section already says it). */
  title?: string;
}

export function FilingPanel({ flight, message, complete, onAddresses, title = 'Filing' }: FilingPanelProps) {
  // the last state this session shows at once (filing.get updates it)
  const [st, setSt] = useState<FilingState | null>(() => peekGet<FilingState>(`flights/${flight.id}/filing`) ?? null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'file' | 'delay' | 'cancel' | 'refresh'>('');
  // the new EOBT while the delay form is open (null: closed)
  const [delayAt, setDelayAt] = useState<number | null>(null);
  // the clock the delay is checked against, read whenever the pilot changes it
  const [delayNow, setDelayNow] = useState(0);
  const setDelay = (ms: number | null) => {
    setDelayAt(ms);
    setDelayNow(Date.now());
  };
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  // the copies proposed (the operator's, the route's aerodromes'), all ticked; the pilot may untick any
  const [noCopy, setNoCopy] = useState<Set<string>>(new Set());
  // '' = the first available backend, then the next on a transient failure
  const [via, setVia] = useState<'' | FilerId>('');
  const load = useCallback(() => {
    setLoadErr(null);
    api.filing
      .get(flight.id)
      .then(setSt, (e: unknown) => setLoadErr(loadError(e instanceof ApiRequestError && e.offline)));
  }, [flight.id]);
  // The proposed addressees depend on the saved route and altitudes.
  const routeKey = JSON.stringify([
    flight.route.map((p) => [p.lat, p.lon]),
    flight.legOverrides,
    flight.options.alternates,
    flight.options.aerodromeRequests ?? [],
  ]);
  useEffect(load, [load, routeKey]);

  const v = useMemo(
    () => filingView(st, { excluded: [...excluded], extra, noCopy: [...noCopy], via }, complete, !!busy),
    [st, excluded, extra, noCopy, via, complete, busy],
  );
  const { addresses, copyTo, connect, connectOnly } = v;
  // the delay form's check, as the server checks it (and the DLA a fax carries)
  const delay = delayAt != null && v.delay.shown ? delayCheck(v.filing, delayAt, delayNow) : null;
  const addrKey = addresses.join(' ');
  const reportAddresses = useEffectEvent(() => onAddresses?.(addresses));
  useEffect(() => reportAddresses(), [addrKey]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<FilingState>): Promise<boolean> => {
    setBusy(kind);
    setActionErr(null);
    try {
      setSt(await fn());
      // the flight's filing status shows elsewhere too (the editor's checklist and top bar, the lobby)
      invalidate('flights');
      return true;
    } catch (e) {
      setActionErr(actionError(e instanceof ApiRequestError ? e : null));
      if (e instanceof ApiRequestError && e.status === 503) load();
      return false;
    } finally {
      setBusy('');
    }
  };

  const connectHref = () =>
    autorouterConnectUrl(window.location.pathname + window.location.search + window.location.hash);
  const addTyped = () => {
    const a = aftnAddress(typed);
    if (!a) return;
    setExtra((x) => (x.includes(a) ? x : [...x, a]));
    setExcluded((s) => {
      const n = new Set(s);
      n.delete(a);
      return n;
    });
    setTyped('');
  };

  return (
    <Panel
      title={title}
      className="fpl-panel fpl-filing"
      testId="fpl-filing"
      status={
        st && (
          <Chip tone={v.status.tone ?? undefined} testId="fpl-filing-status">
            {v.status.label}
          </Chip>
        )
      }
      actions={
        <>
          {connect && (
            <a
              className={connectOnly ? 'btn primary' : 'btn ghost'}
              href={connectHref()}
              data-testid="fpl-autorouter-connect"
            >
              {v.connectLabel}
            </a>
          )}
          {!connectOnly && (
            <button
              className="primary"
              data-testid="fpl-file"
              disabled={!v.file.enabled}
              title={v.file.hint ?? undefined}
              onClick={() => run('file', () => api.filing.file(flight.id, fileRequest(v, message)))}
            >
              {busy === 'file' ? 'Filing…' : v.file.label}
            </button>
          )}
          {v.delay.shown && (
            <button
              data-testid="fpl-delay"
              disabled={!v.delay.enabled || delayAt != null}
              onClick={() => {
                setActionErr(null);
                setDelay(delayStart(v.filing, Date.now()));
              }}
            >
              {busy === 'delay' ? 'Delaying…' : 'Delay'}
            </button>
          )}
          {v.cancel.shown && (
            <button
              data-testid="fpl-cancel"
              className="danger"
              disabled={!v.cancel.enabled}
              onClick={() => {
                if (window.confirm('Cancel the filed flight plan?'))
                  void run('cancel', () => api.filing.cancel(flight.id, undefined, copyTo));
              }}
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
          <button
            className="ghost"
            data-testid="fpl-refresh"
            disabled={!v.refresh.enabled}
            onClick={() => run('refresh', () => api.filing.refresh(flight.id))}
          >
            {busy === 'refresh' ? 'Checking…' : 'Refresh status'}
          </button>
        </>
      }
    >
      <ExportWarnings warnings={loadErr ? [loadErr] : []} classify={false} />
      {v.disabledReason && (
        <ExportWarnings warnings={[v.disabledReason]} classify={false} testId="fpl-filing-disabled" />
      )}
      {actionErr && (
        <div className="form-error" role="alert">
          {actionErr}
        </div>
      )}
      {delay && delayAt != null && (
        <div className="fpl-delay-form" data-testid="fpl-delay-form">
          <div className="fpl-filing-sub">Delay</div>
          <div className="fpl-delay-row">
            <label className="fpl-filing-delay">
              New EOBT (UTC){' '}
              <input
                type="datetime-local"
                data-testid="fpl-delay-eobt"
                value={Number.isFinite(delayAt) ? utcInput(delayAt) : ''}
                onChange={(e) => setDelay(fromUtcInput(e.target.value))}
              />
            </label>
            {DELAY_STEPS_MIN.map((m) => (
              <button
                key={m}
                className="ghost"
                data-testid={`fpl-delay-plus-${m}`}
                disabled={!Number.isFinite(delayAt)}
                onClick={() => setDelay(delayAt + m * 60e3)}
              >
                +{m} min
              </button>
            ))}
          </div>
          <div className="muted" data-testid="fpl-delay-new">
            Filed EOBT {dateTimeZ(v.filing?.eobt ?? NaN) || '–'} → {dateTimeZ(delayAt) || '–'}
          </div>
          {delay.problem && (
            <div className="form-error" data-testid="fpl-delay-problem">
              {delay.problem}
            </div>
          )}
          <div className="muted">{delay.via}</div>
          {delay.message && (
            <pre className="fpl-delay-message" data-testid="fpl-delay-message">
              {delay.message}
            </pre>
          )}
          <div className="fpl-delay-row">
            <button
              className="primary"
              data-testid="fpl-delay-send"
              disabled={!!delay.problem || !!busy}
              onClick={async () => {
                if (await run('delay', () => api.filing.delay(flight.id, delayAt))) setDelayAt(null);
              }}
            >
              {busy === 'delay' ? 'Sending…' : 'Send delay'}
            </button>
            <button className="ghost" disabled={!!busy} onClick={() => setDelayAt(null)}>
              Not now
            </button>
          </div>
        </div>
      )}
      {v.viaChoice && (
        <label className="fpl-filing-via" data-testid="fpl-filing-via-choice">
          Send via{' '}
          <select value={v.chosen} onChange={(e) => setVia(e.target.value as '' | FilerId)}>
            {v.viaChoice.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {v.viaLine && (
        <div className="muted fpl-filing-via" data-testid="fpl-filing-via-choice">
          {v.viaLine}
        </div>
      )}
      {v.record && (
        <div className="fpl-filing-record">
          <span data-testid="fpl-filing-via">{v.record.via}</span>
          {v.record.filed != null && <span>Filed {dateTimeZ(v.record.filed)}</span>}
          {v.filing?.eobt != null && <span data-testid="fpl-filing-eobt">EOBT {dateTimeZ(v.filing.eobt)}</span>}
          {v.record.polled != null && <span className="muted">checked {dateTimeZ(v.record.polled)}</span>}
          {v.record.message && <span>{v.record.message}</span>}
        </div>
      )}

      {v.copies.length > 0 && (
        <fieldset className="fpl-copies" data-testid="fpl-copy-to">
          <legend className="fpl-filing-sub">Copy by e-mail</legend>
          {v.copies.map((r) => (
            <label key={r.email} className="fpl-copy">
              <input
                type="checkbox"
                checked={r.on}
                onChange={(e) =>
                  setNoCopy((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.delete(r.email);
                    else n.add(r.email);
                    return n;
                  })
                }
              />{' '}
              {r.email} <span className="muted">{r.for}</span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="fpl-addressees" data-testid="fpl-addressees">
        <div className="fpl-filing-sub">
          AFTN addressees{' '}
          <Chip count sm testId="fpl-addressee-count">
            {addresses.length}
          </Chip>
        </div>
        {!st && !loadErr && <Loading variant="sm" />}
        <ul>
          {v.addressees.map((a) => (
            <li key={a.address}>
              <label>
                <input
                  type="checkbox"
                  checked={a.on}
                  onChange={(e) =>
                    a.byHand
                      ? setExtra((x) => x.filter((y) => y !== a.address))
                      : setExcluded((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.delete(a.address);
                          else n.add(a.address);
                          return n;
                        })
                  }
                />
                {a.byHand ? ' ' : ''}
                <code>{a.address}</code> <span className="muted">{a.reasons}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="fpl-addr-add">
          <input
            type="text"
            value={typed}
            maxLength={8}
            placeholder="e.g., LGMGZTZX"
            aria-label="Add an AFTN address"
            onChange={(e) => setTyped(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTyped();
            }}
          />
          <button className="ghost" onClick={addTyped} disabled={!aftnAddress(typed)}>
            Add
          </button>
        </div>
      </div>

      {v.log.length > 0 && (
        <details className="fpl-filing-log">
          <summary>Filing log ({v.log.length})</summary>
          <ul>
            {v.log.map((l) => (
              <li key={l.id} className={l.ok ? '' : 'fpl-log-bad'}>
                {dateTimeZ(l.at)} · {l.line}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
