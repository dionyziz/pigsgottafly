// Filing through the server's filing backends (api/_lib/filers/: autorouter, fax; PLAN-v3 "Filing the
// flight plan via autorouter" and "Flight plan addressing (Greek VFR)"). The panel says which service
// filed the plan and what it can tell: autorouter reports ATC's acknowledgement or rejection, a fax only
// its delivery. The AFTN addressees the server proposes from AIP Greece ENR 1.11
// (api/_lib/addressees.ts) are still shown when the server cannot file, for filing by other means.
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';

import { api, ApiRequestError, peekGet } from '../../../data/api';
import { invalidate } from '../../../data/entities';
import type { Flight } from '../../../shared';
import {
  type FilerId,
  FILING_STATUS_LABEL,
  type FilingRecord,
  type FilingState,
  type FilingStatus,
} from '../../../shared/briefing';
import { fmtDateTimeMs } from '../../../shared/format';
import { Chip, Loading, Panel } from '../../../ui';
import { ExportWarnings } from '../WarningList';

const OPEN = new Set<FilingStatus>([
  'created',
  'filed',
  'manual_correction',
  'suspended',
  'departed',
  'terminated',
  'arriving',
  'sending',
  'delivered',
]);

/** '+302103532635' → '+30 210 3532635'. */
const showNumber = (n: string) => n.replace(/^\+30(\d{3})(\d+)$/, '+30 $1 $2');

/** Which service filed the plan, and what it reports. */
export function filedVia(f: FilingRecord): string {
  if (f.provider !== 'fax') return 'Filed via autorouter';
  const to = f.faxTo ? `${f.faxTo.unit} (${showNumber(f.faxTo.number)})` : 'the ATS office';
  const what =
    f.status === 'delivered'
      ? 'Delivered by fax to'
      : f.status === 'sending'
        ? 'Sending by fax to'
        : f.status === 'failed'
          ? 'Fax failed to'
          : 'Faxed to';
  return `${what} ${to}${f.capabilities.ackRej ? '' : ' — no acknowledgement'}`;
}

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
  const [busy, setBusy] = useState<'' | 'file' | 'cancel' | 'refresh'>('');
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  // the copies proposed (the operator's, the route's aerodromes'), all ticked; the pilot may untick any
  const [noCopy, setNoCopy] = useState<Set<string>>(new Set());
  // '' = the first available backend, then the next on a transient failure
  const [via, setVia] = useState<'' | FilerId>('');
  const copyTo = useMemo(() => (st?.copyTo ?? []).map((r) => r.email).filter((e) => !noCopy.has(e)), [st, noCopy]);

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
      // the flight's filing status shows elsewhere too (the editor's checklist and top bar, the lobby)
      invalidate('flights');
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
  const usable = (st?.filers ?? []).filter((f) => f.available);
  const chosen = usable.some((f) => f.id === via) ? via : '';
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

  return (
    <Panel
      title={title}
      className="fpl-panel fpl-filing"
      testId="fpl-filing"
      status={
        st && (
          <Chip
            tone={
              filing
                ? filing.status === 'rejected' || filing.status === 'failed'
                  ? 'danger'
                  : open
                    ? 'ok'
                    : undefined
                : undefined
            }
            testId="fpl-filing-status"
          >
            {filing ? FILING_STATUS_LABEL[filing.status] : 'Not filed'}
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
            onClick={() =>
              run('file', () =>
                api.filing.file(flight.id, { fpl: message, addresses, copyTo, ...(chosen ? { via: chosen } : {}) }),
              )
            }
          >
            {busy === 'file' ? 'Filing…' : filing && !open ? 'File again' : 'File'}
          </button>
          {open && filing.capabilities.cancel && (
            <button
              data-testid="fpl-cancel"
              className="danger"
              disabled={!enabled || !!busy}
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
            disabled={!enabled || !filing?.providerId || !filing.capabilities.status || !!busy}
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
      {usable.length > 1 && !open && (
        <label className="fpl-filing-via" data-testid="fpl-filing-via-choice">
          Send via{' '}
          <select value={chosen} onChange={(e) => setVia(e.target.value as '' | FilerId)}>
            <option value="">{usable.map((f) => f.label).join(', then ')}</option>
            {usable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} only
              </option>
            ))}
          </select>
        </label>
      )}
      {usable.length === 1 && !filing && (
        <div className="muted fpl-filing-via" data-testid="fpl-filing-via-choice">
          Files via {usable[0].label}
          {usable[0].capabilities.ackRej ? '' : ' — no acknowledgement'}
        </div>
      )}
      {filing && (
        <div className="fpl-filing-record">
          <span data-testid="fpl-filing-via">{filedVia(filing)}</span>
          {filing.filed != null && <span>Filed {dateTimeZ(filing.filed)}</span>}
          {filing.polled != null && <span className="muted">checked {dateTimeZ(filing.polled)}</span>}
          {filing.message && <span>{filing.message}</span>}
        </div>
      )}

      {st && st.copyTo.length > 0 && (
        <fieldset className="fpl-copies" data-testid="fpl-copy-to">
          <legend className="fpl-filing-sub">Copy by e-mail</legend>
          {st.copyTo.map((r) => (
            <label key={r.email} className="fpl-copy">
              <input
                type="checkbox"
                checked={!noCopy.has(r.email)}
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
            placeholder="e.g., LGMGZTZX"
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
                {dateTimeZ(l.at)} · {l.action}
                {l.via ? ` (${l.via})` : ''} · {l.ok ? 'ok' : 'refused'}: {l.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
