// What the Filing panel shows and allows (FilingPanel.tsx), apart from React: the app's Flight plan
// screen builds the same view through the core (PGF.filingView), so what may be filed, delayed or
// cancelled, and how each state reads, cannot differ between the two.
import {
  type FileRequest,
  type FilerId,
  FILING_EOBT_AHEAD_MS,
  FILING_EOBT_PAST_MS,
  FILING_STATUS_LABEL,
  type FilingRecord,
  type FilingState,
  type FilingStatus,
} from '../../../shared/briefing';
import { cnlMessage, dlaMessage } from '../../../shared/icaoMessages';
import { parseFplMessage } from './parseFpl';

/** A plan in these states is with ATC (or on its way): it may be delayed or cancelled, not filed again. */
export const OPEN_FILING = new Set<FilingStatus>([
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

/** An AFTN address as typed (8 letters), upper case; null when it is not one. */
export function aftnAddress(typed: string): string | null {
  const a = typed.trim().toUpperCase();
  return /^[A-Z]{8}$/.test(a) ? a : null;
}

/** What the pilot changed in the panel: addressees unticked or added, copies unticked, the backend. */
export interface FilingChoices {
  excluded?: string[];
  extra?: string[];
  noCopy?: string[];
  /** '' = the first available backend, then the next on a transient failure. */
  via?: '' | FilerId;
}

export type FilingTone = 'ok' | 'danger' | null;

export function filingView(st: FilingState | null, choices: FilingChoices = {}, complete = true, busy = false) {
  const excluded = new Set(choices.excluded ?? []);
  const noCopy = new Set(choices.noCopy ?? []);
  const extra = choices.extra ?? [];
  const filing = st?.filing ?? null;
  const open = !!filing?.providerId && OPEN_FILING.has(filing.status);
  const enabled = !!st?.enabled;
  const usable = (st?.filers ?? []).filter((f) => f.available);
  const chosen: '' | FilerId = usable.some((f) => f.id === choices.via) ? (choices.via as FilerId) : '';
  // not for a pilot the flight is only shared with: the owner files it
  const connect =
    (st?.filers ?? []).find((f) => f.id === 'autorouter' && f.connect && (enabled || st?.reason === f.reason))
      ?.connect ?? null;
  const connectOnly = !!connect && !usable.length && !open;
  const proposed = (st?.addressees ?? []).map((a) => a.address);
  const addresses = [...new Set([...proposed.filter((a) => !excluded.has(a)), ...extra])];
  const copyTo = (st?.copyTo ?? []).map((r) => r.email).filter((e) => !noCopy.has(e));
  const tone: FilingTone = filing
    ? filing.status === 'rejected' || filing.status === 'failed'
      ? 'danger'
      : open
        ? 'ok'
        : null
    : null;
  const caps = filing?.capabilities;
  return {
    filing,
    open,
    enabled,
    status: { label: filing ? FILING_STATUS_LABEL[filing.status] : 'Not filed', tone },
    /** Why nothing can be filed here (shown instead of the actions' effect). */
    disabledReason: st && !enabled && !connectOnly ? (st.reason ?? 'Filing is not enabled yet.') : null,
    connect,
    connectOnly,
    connectLabel: connect
      ? `${connect === 'reconnect' ? 'Reconnect autorouter' : 'Connect autorouter'}${connectOnly ? ' to file' : ''}`
      : null,
    /** The backends to choose from: '' tries them in order. */
    viaChoice:
      usable.length > 1 && !open
        ? [
            { id: '' as const, label: usable.map((f) => f.label).join(', then ') },
            ...usable.map((f) => ({ id: f.id, label: `${f.label} only` })),
          ]
        : null,
    viaLine:
      usable.length === 1 && !filing
        ? `Files via ${usable[0].label}${usable[0].capabilities.ackRej ? '' : ' — no acknowledgement'}`
        : null,
    chosen,
    /** Who a new plan goes to: the backend (or the ones tried in turn). */
    sendsVia: (chosen ? usable.filter((f) => f.id === chosen) : usable).map((f) => f.label).join(', then '),
    record: filing
      ? { via: filedVia(filing), filed: filing.filed, polled: filing.polled, message: filing.message }
      : null,
    addressees: [
      ...(st?.addressees ?? []).map((a) => ({
        address: a.address,
        reasons: a.reasons.join(' · '),
        on: !excluded.has(a.address),
        byHand: false,
      })),
      ...extra
        .filter((a) => !proposed.includes(a))
        .map((a) => ({ address: a, reasons: 'added by hand', on: true, byHand: true })),
    ],
    addresses,
    copies: (st?.copyTo ?? []).map((r) => ({ email: r.email, for: r.for, on: !noCopy.has(r.email) })),
    copyTo,
    file: {
      shown: !connectOnly,
      label: filing && !open ? 'File again' : 'File',
      enabled: enabled && complete && !open && !busy && addresses.length > 0,
      hint: !complete ? 'The message has missing fields' : !addresses.length ? 'No AFTN addressee' : null,
    },
    cancel: { shown: open && !!caps?.cancel, enabled: enabled && !busy },
    delay: { shown: open && !!caps?.delay, enabled: enabled && !busy },
    refresh: { enabled: enabled && !!filing?.providerId && !!caps?.status && !busy },
    /** A fax on its way: its delivery is worth asking again until it settles. */
    sending: filing?.status === 'sending',
    log: (st?.log ?? []).map((l) => ({
      ...l,
      line: `${l.action}${l.via ? ` (${l.via})` : ''} · ${l.ok ? 'ok' : 'refused'}: ${l.message}`,
    })),
  };
}

export type FilingView = ReturnType<typeof filingView>;

/** The body of POST /flights/:id/filing for what the panel shows. */
export const fileRequest = (v: FilingView, message: string): FileRequest => ({
  fpl: message,
  addresses: v.addresses,
  copyTo: v.copyTo,
  ...(v.chosen ? { via: v.chosen } : {}),
});

/** The plan's head as the confirmation reads it: '(FPL-SXASV-VG …-LGTT0745 …-LGSK0030 …DOF/261128 …)'. */
export function fplHead(message: string) {
  const f = parseFplMessage(message);
  return {
    ident: f.item7,
    adep: f.item13.adep,
    eobt: f.item13.eobt,
    ades: f.item16.ades,
    dof: /\bDOF\/(\d{6})\b/.exec(f.item18)?.[1] ?? '',
    route: f.item15.route,
  };
}

/**
 * A delay to `eobt`: why it cannot be sent (the server's limits: from 30 minutes ago to 5 days
 * ahead), and the DLA a fax carries (the ICAO message the server builds; autorouter sends its own).
 */
export function delayCheck(filing: FilingRecord | null, eobt: number, now: number) {
  const problem = !filing?.providerId
    ? 'No open filed plan to delay.'
    : !Number.isFinite(eobt) || eobt < now - FILING_EOBT_PAST_MS || eobt > now + FILING_EOBT_AHEAD_MS
      ? 'The new EOBT must be between now and 5 days ahead.'
      : filing.eobt === eobt
        ? 'That is the EOBT already filed.'
        : null;
  const fax = filing?.provider === 'fax' && !!filing.fpl;
  return {
    problem,
    message: fax && Number.isFinite(eobt) ? dlaMessage(filing.fpl, eobt) : null,
    /** Who sends it: the fax (the DLA follows), else the service that filed the plan. */
    via: fax
      ? 'Faxed to the office the plan went to:'
      : `Through ${filing?.providerLabel ?? 'autorouter'}, which delays the plan with ATC.`,
  };
}

/** The delay buttons: minutes added to the new EOBT. */
export const DELAY_STEPS_MIN = [15, 30, 60];

/**
 * Where a delay starts: the filed EOBT, or now once that is past (the pilot adds the delay to it),
 * to the minute.
 */
export const delayStart = (filing: FilingRecord | null, now: number): number =>
  Math.floor(Math.max(filing?.eobt ?? now, now) / 60e3) * 60e3;

/** A time as a datetime-local input shows it, in UTC: 'YYYY-MM-DDTHH:MM'. */
export const utcInput = (ms: number): string => new Date(ms).toISOString().slice(0, 16);
/** A datetime-local input's value read as UTC (NaN when incomplete). */
export const fromUtcInput = (s: string): number =>
  /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s) ? Date.parse(`${s}:00Z`) : NaN;

/** The CNL a faxed plan's cancellation carries (autorouter sends its own). */
export const cancelMessage = (filing: FilingRecord | null): string | null =>
  filing?.provider === 'fax' && filing.fpl ? cnlMessage(filing.fpl, filing.eobt) : null;

/** How a refused action reads (the panel's error line). */
export const actionError = (e: { offline?: boolean; message?: string | null } | null): string =>
  e?.offline ? 'Offline: nothing was sent.' : e?.message ? e.message : 'The request failed.';

/** How a failed load of the filing state reads. */
export const loadError = (offline: boolean): string =>
  offline ? 'Offline: addressees and filing status are not available.' : 'Could not load the filing state.';
