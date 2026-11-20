// Filing the flight plan through autorouter (PLAN-v3 "Filing the flight plan via autorouter" and
// "Flight plan addressing (Greek VFR)"), on the flight plan export, screen only:
//   - the AFTN addressees the server proposes from AIP Greece ENR 1.11 (api/_lib/addressees.ts),
//     each with why it is there, for review: untick to leave one out, add one by hand;
//   - File / Delay / Cancel / Refresh status, with the plan's status and this flight's filing log;
//   - when the server cannot file, why not (the buttons stay disabled; the addressees are still
//     shown, for filing by other means).
// The reviewed addressees also fill the ADDRESSEE(S) box of the printed form (onAddresses).
import { Fragment, useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';

import { api, ApiRequestError, peekGet } from '../../../data/api';
import type { Flight } from '../../../shared';
import type { FilingState, FilingStatus } from '../../../shared/briefing';
import { fmtClockMs, fmtDateTimeMs } from '../../../shared/format';
import { Chip, Loading, Panel, TimeField } from '../../../ui';
import { ExportWarnings } from '../WarningList';

const STATUS_LABEL: Record<FilingStatus, string> = {
  'not-filed': 'Not filed',
  created: 'Created',
  filed: 'Filed',
  manual_correction: 'Queued for manual correction',
  suspended: 'Suspended',
  departed: 'Departed',
  terminated: 'Terminated',
  arriving: 'Arriving',
  arrived: 'Arrived',
  closed: 'Closed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
  unknown: 'Unknown',
};
const OPEN = new Set<FilingStatus>([
  'created',
  'filed',
  'manual_correction',
  'suspended',
  'departed',
  'terminated',
  'arriving',
]);

const clockZ = (ms: number) => fmtClockMs(ms, { z: true });
const dateTimeZ = (ms: number) => fmtDateTimeMs(ms);

export interface FilingPanelProps {
  flight: Flight;
  /** The FPL message as built on the page. */
  message: string;
  /** False while the message has ???? fields: filing is refused. */
  complete: boolean;
  /** The reviewed addressees, for the printed form. */
  onAddresses?: (addresses: string[]) => void;
}

export function FilingPanel({ flight, message, complete, onAddresses }: FilingPanelProps) {
  // the last state this session shows at once (filing.get updates it)
  const [st, setSt] = useState<FilingState | null>(() => peekGet<FilingState>(`flights/${flight.id}/filing`) ?? null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'file' | 'delay' | 'cancel' | 'refresh'>('');
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [delayTo, setDelayTo] = useState(flight.blockOff || '');

  const load = useCallback(() => {
    setLoadErr(null);
    api.filing
      .get(flight.id)
      .then(setSt, (e: unknown) =>
        setLoadErr(
          e instanceof ApiRequestError && e.offline
            ? 'Offline: addressees and filing status are not available.'
            : 'Could not load the filing state.',
        ),
      );
  }, [flight.id]);
  // The proposed addressees depend on the saved route and altitudes.
  const routeKey = JSON.stringify([
    flight.route.map((p) => [p.lat, p.lon]),
    flight.legOverrides,
    flight.options.alternates,
    flight.options.aerodromeRequests ?? [],
  ]);
  useEffect(load, [load, routeKey]);

  const addresses = useMemo(() => {
    const prop = (st?.addressees ?? []).map((a) => a.address).filter((a) => !excluded.has(a));
    return [...new Set([...prop, ...extra])];
  }, [st, excluded, extra]);
  const addrKey = addresses.join(' ');
  const reportAddresses = useEffectEvent(() => onAddresses?.(addresses));
  useEffect(() => reportAddresses(), [addrKey]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<FilingState>) => {
    setBusy(kind);
    setActionErr(null);
    try {
      setSt(await fn());
    } catch (e) {
      setActionErr(
        e instanceof ApiRequestError ? (e.offline ? 'Offline: nothing was sent.' : e.message) : 'The request failed.',
      );
      if (e instanceof ApiRequestError && e.status === 503) load();
    } finally {
      setBusy('');
    }
  };

  const filing = st?.filing ?? null;
  const open = !!filing?.providerId && OPEN.has(filing.status);
  const enabled = !!st?.enabled;
  const addTyped = () => {
    const a = typed.trim().toUpperCase();
    if (!/^[A-Z]{8}$/.test(a)) return;
    setExtra((x) => (x.includes(a) ? x : [...x, a]));
    setExcluded((s) => {
      const n = new Set(s);
      n.delete(a);
      return n;
    });
    setTyped('');
  };
  const delayMs = (() => {
    const m = /^(\d{2}):(\d{2})$/.exec(delayTo);
    const day = Date.parse(`${flight.date}T00:00:00Z`);
    return m && isFinite(day) ? day + (+m[1] * 60 + +m[2]) * 60000 : NaN;
  })();

  return (
    <Panel
      title="Filing"
      className="fpl-panel fpl-filing"
      testId="fpl-filing"
      status={
        st && (
          <Chip
            tone={filing ? (filing.status === 'rejected' ? 'danger' : open ? 'ok' : undefined) : undefined}
            testId="fpl-filing-status"
          >
            {filing ? STATUS_LABEL[filing.status] : 'Not filed'}
          </Chip>
        )
      }
      actions={
        <>
          <button
            className="primary"
            data-testid="fpl-file"
            disabled={!enabled || !complete || open || !!busy || !addresses.length}
            title={!complete ? 'The message has missing fields' : undefined}
            onClick={() => run('file', () => api.filing.file(flight.id, { fpl: message, addresses }))}
          >
            {busy === 'file' ? 'Filing…' : filing && !open ? 'File again' : 'File'}
          </button>
          <label className="fpl-filing-delay">
            <TimeField value={delayTo} onChange={setDelayTo} ariaLabel="New EOBT (UTC)" testId="fpl-delay-to" />
            <button
              data-testid="fpl-delay"
              disabled={!enabled || !open || !!busy || !isFinite(delayMs)}
              onClick={() => run('delay', () => api.filing.delay(flight.id, delayMs))}
            >
              {busy === 'delay' ? 'Delaying…' : 'Delay'}
            </button>
          </label>
          <button
            data-testid="fpl-cancel"
            className="danger"
            disabled={!enabled || !open || !!busy}
            onClick={() => {
              if (window.confirm('Cancel the filed flight plan?'))
                void run('cancel', () => api.filing.cancel(flight.id));
            }}
          >
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
          </button>
          <button
            className="ghost"
            data-testid="fpl-refresh"
            disabled={!enabled || !filing?.providerId || !!busy}
            onClick={() => run('refresh', () => api.filing.refresh(flight.id))}
          >
            {busy === 'refresh' ? 'Checking…' : 'Refresh status'}
          </button>
        </>
      }
    >
      <ExportWarnings warnings={loadErr ? [loadErr] : []} classify={false} />
      {st && !enabled && (
        <ExportWarnings
          warnings={[st.reason ?? 'Filing is not enabled yet.']}
          classify={false}
          testId="fpl-filing-disabled"
        />
      )}
      {actionErr && (
        <div className="form-error" role="alert">
          {actionErr}
        </div>
      )}
      {filing && (
        <div className="fpl-filing-record">
          {filing.filed != null && <span>Filed {dateTimeZ(filing.filed)}</span>}
          {filing.eobt != null && <span>EOBT {clockZ(filing.eobt)}</span>}
          {filing.polled != null && <span className="muted">checked {dateTimeZ(filing.polled)}</span>}
          {filing.message && <span>{filing.message}</span>}
        </div>
      )}

      {st && st.copyTo.length > 0 && (
        <div className="fpl-filing-record" data-testid="fpl-copy-to">
          <span>
            Copy by e-mail to{' '}
            {st.copyTo.map((r, i) => (
              <Fragment key={r.email}>
                {i > 0 && ', '}
                {r.email} <span className="muted">({r.for})</span>
              </Fragment>
            ))}
          </span>
        </div>
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
          {(st?.addressees ?? []).map((a) => (
            <li key={a.address}>
              <label>
                <input
                  type="checkbox"
                  checked={!excluded.has(a.address)}
                  onChange={(e) =>
                    setExcluded((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.delete(a.address);
                      else n.add(a.address);
                      return n;
                    })
                  }
                />
                <code>{a.address}</code> <span className="muted">{a.reasons.join(' · ')}</span>
              </label>
            </li>
          ))}
          {extra
            .filter((a) => !(st?.addressees ?? []).some((p) => p.address === a))
            .map((a) => (
              <li key={a}>
                <label>
                  <input type="checkbox" checked onChange={() => setExtra((x) => x.filter((y) => y !== a))} />{' '}
                  <code>{a}</code> <span className="muted">added by hand</span>
                </label>
              </li>
            ))}
        </ul>
        <div className="fpl-addr-add">
          <input
            type="text"
            value={typed}
            maxLength={8}
            placeholder="e.g. LGMGZTZX"
            aria-label="Add an AFTN address"
            onChange={(e) => setTyped(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTyped();
            }}
          />
          <button className="ghost" onClick={addTyped} disabled={!/^[A-Z]{8}$/.test(typed.trim())}>
            Add
          </button>
        </div>
      </div>

      {st && st.log.length > 0 && (
        <details className="fpl-filing-log">
          <summary>Filing log ({st.log.length})</summary>
          <ul>
            {st.log.map((l) => (
              <li key={l.id} className={l.ok ? '' : 'fpl-log-bad'}>
                {dateTimeZ(l.at)} · {l.action} · {l.ok ? 'ok' : 'refused'}: {l.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
