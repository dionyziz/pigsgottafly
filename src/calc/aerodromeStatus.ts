// Effective aerodrome hours: the AIP (RefAerodrome.hours, AD 2.3 / AD 1.6.N.3) overlaid with the NOTAMs
// that change them. Shared by the editor (warnings, map, aerodrome details) and the API (whether a handler
// submits the General Declaration). Pure: no I/O; works with no NOTAMs at all.
//
// NOTAMs read (item A = the aerodrome; items B/C validity, D schedule, E text):
//   QFAAH (and QFACH with hours in E)      aerodrome hours of service are now … (replaces the AIP hours; the
//                                          HO hours of the Greek category A aerodromes come this way)
//   QFALC, QFALV, QFAAM                    aerodrome closed / closed to VFR / military only: closed while
//                                          item D's schedule applies (no item D: the whole validity)
//   QFALN                                  closed to night operations (closed HN)
//   QFALT, QFALX, QFAAP, QFAAR, QFALP …    limited / PPR: no change to the hours, listed with the reason
//   any FA/FH/XX NOTAM whose E mentions HANDLING: handling not available (closed) or its new hours
//   QSTAH/QSFAH (QSTCH, QSFCH with hours)  TWR / AFIS hours; QST/QSF AS, LC, AU: ATS not available
// A NOTAM whose schedule cannot be read exactly makes the status 'unknown' (citing the NOTAM) instead of a guess.
import type { Notam } from '../shared/briefing.js';
import type { HoursSpec, RefAdHours, RefAerodrome, RefSunTable } from '../shared/ref.js';
import {
  clockZ,
  fmtRules,
  hoursAt,
  intervals,
  normalizeAipText,
  parseSchedule,
  type HoursAt,
  type HoursStatus,
} from './adHours.js';

export type AdTarget = 'ad' | 'ats' | 'handling';

export interface AdNotamEffect {
  /** NOTAM id, e.g. 'A1234/26'. */
  key: string;
  icao: string;
  target: AdTarget;
  /** 'hours': new hours of service; 'closed': not available while `when` applies; 'limited': listed only. */
  effect: 'hours' | 'closed' | 'limited';
  from: number;
  to: number | null;
  /** When the closure applies within B–C (item D); null = all of it. */
  when: HoursSpec | null;
  /** 'hours': the new hours (from E, else D). */
  hours: HoursSpec | null;
  /** The NOTAM's schedule could not be read exactly: evaluated as unknown. */
  partial: boolean;
  /** One line, e.g. 'AD hours MON-FRI 0500-1700', 'AD closed', 'Handling not available'. */
  summary: string;
  /** Item E. */
  text: string;
}

const spec = (rules: ReturnType<typeof parseSchedule>, text: string): HoursSpec =>
  rules
    ? { rules, notes: [], partial: false, label: fmtRules(rules) }
    : { rules: [], notes: [text], partial: true, label: 'See NOTAM text' };

/** The schedule in an E text: after 'HOURS …:' / 'CHANGED TO' / 'AS FOLLOWS', else all of it. */
function scheduleInText(e: string): ReturnType<typeof parseSchedule> {
  const t = normalizeAipText(e).toUpperCase();
  const tries = [t];
  const colon = t.indexOf(':');
  if (colon > 0 && !/\d/.test(t.slice(0, colon))) tries.unshift(t.slice(colon + 1));
  const m = /(?:CHANGED TO|AS FOLLOWS|AS FLW|WILL BE|ARE|IS)\s*:?\s*(.*)$/.exec(t);
  if (m) tries.unshift(m[1]);
  const h = /\bHANDLING\b[^:]*?(?:AVBL|AVAILABLE|HOURS|HR|HRS)\s*:?\s*(.*)$/.exec(t);
  if (h) tries.unshift(h[1]);
  for (const x of tries) {
    const r = parseSchedule(x.replace(/\.$/, ''));
    if (r) return r;
  }
  return null;
}

const NOT_AVAILABLE =
  /\b(NOT AVBL|NOT AVAILABLE|UNAVBL|UNAVAILABLE|U\/S|SUSPENDED|NOT PROVIDED|WILL NOT BE PROVIDED|CLSD|CLOSED|NIL)\b/;

/** The NOTAMs that change an aerodrome's hours, ATS hours or handling (others are ignored). */
export function aerodromeNotamEffects(notams: readonly Notam[] | null | undefined): AdNotamEffect[] {
  const out: AdNotamEffect[] = [];
  for (const n of notams ?? []) {
    if (n.type === 'C' || !n.itemA.length) continue;
    const q = n.qcode.toUpperCase();
    const s23 = q.slice(1, 3),
      s45 = q.slice(3, 5);
    const e = normalizeAipText(n.text).toUpperCase();
    const when = () => (n.schedule ? spec(parseSchedule(n.schedule), n.schedule) : null);
    let x:
      | (Pick<AdNotamEffect, 'target' | 'effect' | 'summary'> & { hours?: HoursSpec | null; when?: HoursSpec | null })
      | null = null;
    if (/\bHANDLING\b/.test(e) && (s23[0] === 'F' || s23 === 'XX')) {
      if (NOT_AVAILABLE.test(e))
        x = { target: 'handling', effect: 'closed', summary: 'Handling not available', when: when() };
      else {
        const r = scheduleInText(e) ?? (n.schedule ? parseSchedule(n.schedule) : null);
        x = r
          ? { target: 'handling', effect: 'hours', summary: `Handling ${fmtRules(r)}`, hours: spec(r, '') }
          : { target: 'handling', effect: 'limited', summary: 'Handling changed' };
      }
    } else if (s23 === 'FA') {
      if (s45 === 'AH' || (s45 === 'CH' && /\b(HOURS|HR|HRS|OPR|SER)\b/.test(e))) {
        const r = scheduleInText(e) ?? (n.schedule ? parseSchedule(n.schedule) : null);
        x = {
          target: 'ad',
          effect: 'hours',
          summary: r ? `AD hours ${fmtRules(r)}` : 'AD hours changed',
          hours: spec(r, n.text),
        };
      } else if (s45 === 'LC' || s45 === 'LV' || s45 === 'AM') {
        x = {
          target: 'ad',
          effect: 'closed',
          summary: s45 === 'LC' ? 'AD closed' : s45 === 'LV' ? 'AD closed to VFR' : 'AD military operations only',
          when: when(),
        };
      } else if (s45 === 'LN') {
        x = {
          target: 'ad',
          effect: 'closed',
          summary: 'AD closed at night',
          when: n.schedule ? when() : { rules: [{ times: [{ t: 'HN' }] }], notes: [], partial: false, label: 'HN' },
        };
      } else if (['LT', 'LX', 'AP', 'AR', 'LP', 'LS', 'LR', 'LB'].includes(s45)) {
        x = {
          target: 'ad',
          effect: 'limited',
          summary: `AD ${n.condition ? n.condition.charAt(0).toLowerCase() + n.condition.slice(1) : 'limited'}`,
        };
      }
    } else if (s23 === 'ST' || s23 === 'SF') {
      const unit = s23 === 'ST' ? 'TWR' : 'AFIS';
      if (s45 === 'AH' || (s45 === 'CH' && /\b(HOURS|HR|HRS|OPR|SER)\b/.test(e))) {
        const r = scheduleInText(e) ?? (n.schedule ? parseSchedule(n.schedule) : null);
        x = {
          target: 'ats',
          effect: 'hours',
          summary: r ? `${unit} hours ${fmtRules(r)}` : `${unit} hours changed`,
          hours: spec(r, n.text),
        };
      } else if (['AS', 'LC', 'AU', 'AW'].includes(s45)) {
        x = { target: 'ats', effect: 'closed', summary: `${unit} not available`, when: when() };
      }
    }
    if (!x) continue;
    for (const icao of n.itemA) {
      const eff: AdNotamEffect = {
        key: n.key,
        icao,
        target: x.target,
        effect: x.effect,
        from: n.from,
        to: n.to,
        when: x.when ?? null,
        hours: x.hours ?? null,
        partial: false,
        summary: x.summary,
        text: n.text,
      };
      eff.partial = !!(eff.when?.partial || eff.hours?.partial);
      out.push(eff);
    }
  }
  return out;
}

const active = (e: AdNotamEffect, ms: number) => e.from <= ms && (e.to === null || ms < e.to);

export interface AdStatusOptions {
  /** aerodromeNotamEffects() of the flight's NOTAMs ([] = none known). */
  effects?: readonly AdNotamEffect[];
  sunTables?: Record<string, RefSunTable>;
}

export interface AdStatusAt extends HoursAt {
  /** 'AIP LGAV AD 2.3' or 'NOTAM A1234/26'. */
  source: string;
  /** The NOTAM that decided, or null (AIP). */
  notam: string | null;
}

const LABEL: Record<AdTarget, string> = { ad: 'AD', ats: 'ATS', handling: 'Handling' };

function aipField(h: RefAdHours | undefined, target: AdTarget) {
  if (!h) return null;
  return target === 'ad'
    ? { f: h.ad, source: h.source }
    : target === 'ats'
      ? h.ats
        ? { f: h.ats, source: h.source }
        : null
      : { f: h.handling, source: h.handling.source };
}

/** The status of the aerodrome (or its ATS, or handling) at an instant: NOTAM closures, then NOTAM hours, then the AIP. */
export function aerodromeStatusAt(
  ad: RefAerodrome,
  target: AdTarget,
  ms: number,
  opts: AdStatusOptions = {},
): AdStatusAt {
  const effects = (opts.effects ?? []).filter((e) => e.icao === ad.icao && e.target === target && active(e, ms));
  const ctx = {
    lat: ad.lat,
    lon: ad.lon,
    sunTables: opts.sunTables,
    ad: target === 'ad' ? undefined : (t: number) => aerodromeStatusAt(ad, 'ad', t, opts),
  };
  for (const e of effects.filter((x) => x.effect === 'closed')) {
    if (!e.when) return { status: 'closed', why: e.summary, source: `NOTAM ${e.key}`, notam: e.key };
    if (e.when.partial)
      return {
        status: 'unknown',
        why: `${e.summary}: schedule not read (${e.when.notes[0] ?? ''})`,
        source: `NOTAM ${e.key}`,
        notam: e.key,
      };
    if (hoursAt(e.when, ms, ctx).status === 'open')
      return { status: 'closed', why: `${e.summary} (${e.when.label})`, source: `NOTAM ${e.key}`, notam: e.key };
  }
  const hours = effects.filter((x) => x.effect === 'hours').sort((a, b) => b.from - a.from)[0];
  if (hours?.hours) {
    if (hours.partial)
      return {
        status: 'unknown',
        why: `${LABEL[target]} hours in the NOTAM text`,
        source: `NOTAM ${hours.key}`,
        notam: hours.key,
      };
    const v = hoursAt(hours.hours, ms, ctx);
    return { ...v, source: `NOTAM ${hours.key}`, notam: hours.key };
  }
  const aip = aipField(ad.hours, target);
  if (!aip)
    return {
      status: 'unknown',
      why: ad.hours ? `no ${LABEL[target]} hours published` : 'no AIP hours',
      source: 'AIP',
      notam: null,
    };
  const v = hoursAt(aip.f.parsed, ms, ctx);
  return { ...v, source: `AIP ${aip.source}`, notam: null };
}

export interface AdStatus extends AdStatusAt {
  /** First instant of the reported status within the window, epoch ms. */
  at: number;
  /** NOTAMs that limit the aerodrome during the window without changing its hours (PPR, limited to …). */
  limits: { key: string; summary: string; text: string }[];
}

const RANK: Record<HoursStatus, number> = { open: 0, unknown: 1, closed: 2 };

/**
 * The status over a window [fromMs, toMs] (an instant when equal): closed if closed at any minute of it,
 * else unknown if unknown at any minute, else open. NaN times: unknown.
 */
export function aerodromeStatus(
  ad: RefAerodrome,
  target: AdTarget,
  fromMs: number,
  toMs: number,
  opts: AdStatusOptions = {},
): AdStatus {
  const limits = (opts.effects ?? [])
    .filter(
      (e) =>
        e.icao === ad.icao &&
        e.target === target &&
        e.effect === 'limited' &&
        e.from <= toMs &&
        (e.to === null || e.to > fromMs),
    )
    .map((e) => ({ key: e.key, summary: e.summary, text: e.text }));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs))
    return { status: 'unknown', why: 'time not known', source: 'AIP', notam: null, at: NaN, limits };
  let worst: AdStatus | null = null;
  const end = Math.max(fromMs, toMs);
  for (let t = fromMs; ; t = Math.min(end, t + 60e3)) {
    const v = aerodromeStatusAt(ad, target, t, opts);
    if (!worst || RANK[v.status] > RANK[worst.status]) worst = { ...v, at: t, limits };
    if (worst.status === 'closed' || t >= end) break;
  }
  return worst!;
}

export interface AdDay {
  day: string;
  /** Runs of equal status over the day (UTC). */
  runs: (HoursAt & { from: number; to: number; source: string; notam: string | null })[];
  /** e.g. 'H24', '04:52–15:01Z', 'HO: hours published by NOTAM', 'Closed (NOTAM A1234/26)'. */
  text: string;
  /** NOTAMs that changed it that day. */
  notams: string[];
}

/** The aerodrome's (ATS's, handling's) hours over one UTC day, for display. */
export function aerodromeDay(ad: RefAerodrome, target: AdTarget, day: string, opts: AdStatusOptions = {}): AdDay {
  const start = Date.parse(day + 'T00:00:00Z');
  if (!Number.isFinite(start)) return { day, runs: [], text: '', notams: [] };
  const by = (t: number) => aerodromeStatusAt(ad, target, t, opts);
  const raw = intervals(
    (t) => {
      const v = by(t);
      return { status: v.status, why: `${v.why}\u0000${v.source}\u0000${v.notam ?? ''}` };
    },
    start,
    start + 86400e3,
  );
  const runs = raw.map((r) => {
    const [why, source, notam] = r.why.split('\u0000');
    return { status: r.status, why, from: r.from, to: r.to, source, notam: notam || null };
  });
  const notams = [...new Set(runs.map((r) => r.notam).filter((x): x is string => !!x))];
  const span = (r: { from: number; to: number }) => `${clockZ(r.from, start)}–${clockZ(r.to, start)}Z`;
  let text: string;
  if (runs.length === 1) {
    const r = runs[0];
    text =
      r.status === 'open'
        ? /^H24/.test(r.why)
          ? 'H24'
          : 'Open all day'
        : r.status === 'closed'
          ? `Closed (${r.why})`
          : r.why;
  } else {
    const open = runs.filter((r) => r.status === 'open');
    const unk = runs.filter((r) => r.status === 'unknown');
    text = [
      open.length ? `Open ${open.map(span).join(', ')}` : 'Closed',
      ...unk.map((r) => `${span(r)}: ${r.why}`),
    ].join(' · ');
    const sun = runs.find((r) => /^HJ |^HN /.test(r.why));
    if (sun && open.length) text += ' (HJ)';
  }
  return { day, runs, text, notams };
}

// ---------------------------------------------------------------- General Declaration: handled ends

/** One end of the flight for the General Declaration: is there a handler there at the flight's time? */
export interface HandlingEnd {
  role: 'departure' | 'destination';
  /** ICAO, or the place name. */
  code: string;
  icao: string | null;
  handled: boolean;
  status: HoursStatus;
  /** e.g. 'LGAV: handling H24 (AIP AD 2.3)', 'LGTT: no handling (AIP AD 1.6.5.4)', 'LGAV: NOTAM A1234/26: handling not available'. */
  reason: string;
}

export interface GenDecHandling {
  ends: HandlingEnd[];
  /** From the AIP and NOTAMs: an end has no handler, so the PIC sends the declaration. */
  autoPilotSends: boolean;
  /** The flight's override (FlightOptions.genDecHandled): true = a handler submits it, false = the PIC does; null = automatic. */
  override: boolean | null;
  /** The decision: override, else automatic. */
  pilotSends: boolean;
}

export interface HandlingEndInput {
  role: 'departure' | 'destination';
  code: string;
  aerodrome: RefAerodrome | null | undefined;
  /** When the aircraft is there (block-off … take-off, landing … block-on), epoch ms; NaN = time not set. */
  fromMs: number;
  toMs: number;
  /** 00:00 UTC of the flight date (used when the time is not set: the whole day). */
  dayMs: number;
}

const aipRef = (source: string, icao: string | null) =>
  `AIP ${icao && source.startsWith(icao + ' ') ? source.slice(icao.length + 1) : source}`;

/** Handling at one end. */
export function handlingEnd(e: HandlingEndInput, opts: AdStatusOptions = {}): HandlingEnd {
  const ad = e.aerodrome;
  const base = { role: e.role, code: e.code, icao: ad?.icao ?? null };
  if (!ad) return { ...base, handled: false, status: 'closed', reason: `${e.code}: not an aerodrome (no handler)` };
  if (!ad.hours) return { ...base, handled: false, status: 'unknown', reason: `${e.code}: handling not published` };
  const timed = Number.isFinite(e.fromMs) && Number.isFinite(e.toMs);
  const from = timed ? e.fromMs : e.dayMs,
    to = timed ? e.toMs : e.dayMs + 86400e3 - 60e3;
  const v = aerodromeStatus(ad, 'handling', from, to, opts);
  const h = ad.hours.handling;
  // the AIP's own words ('H24', 'HO (by arrangement)', 'During summer only, on AD operating hours')
  const label = h.parsed.partial ? 'see AIP' : normalizeAipText(h.text).replace(/\.$/, '');
  const when = timed ? ` at ${clockZ(v.at)}Z` : ' all day (block-off time not set)';
  let reason: string;
  if (v.notam) {
    const eff = (opts.effects ?? []).find((x) => x.key === v.notam && x.icao === ad.icao);
    reason = `${e.code}: NOTAM ${v.notam}: ${eff?.summary.replace(/^Handling /, 'handling ') ?? v.why}${v.status === 'open' ? '' : v.status === 'closed' ? when : ''}`;
    if (v.status === 'open' && eff?.effect === 'hours')
      reason = `${e.code}: handling ${eff.hours?.label ?? ''} (NOTAM ${v.notam})`;
  } else if (v.status === 'open') {
    reason = `${e.code}: handling ${label} (${aipRef(v.source.replace(/^AIP /, ''), ad.icao)})`;
  } else if (v.status === 'closed') {
    const nil =
      h.parsed.rules.length === 1 && h.parsed.rules[0].times.every((t) => t.t === 'NIL') && !h.parsed.rules[0].season;
    reason = nil
      ? `${e.code}: no handling (${aipRef(h.source, ad.icao)})`
      : `${e.code}: no handling${when}: ${v.why} (handling ${label}, ${aipRef(h.source, ad.icao)})`;
  } else {
    reason = `${e.code}: handling unknown${timed ? when : ''} (${v.why}; ${aipRef(h.source, ad.icao)})`;
  }
  return { ...base, handled: v.status === 'open', status: v.status, reason };
}

/** Who sends the General Declaration: the PIC when either end has no handler at the flight's time there. */
export function genDecHandling(
  ends: HandlingEndInput[],
  override: boolean | null | undefined,
  opts: AdStatusOptions = {},
): GenDecHandling {
  const out = ends.map((e) => handlingEnd(e, opts));
  const autoPilotSends = !out.length || out.some((e) => !e.handled);
  const ov = typeof override === 'boolean' ? override : null;
  return { ends: out, autoPilotSends, override: ov, pilotSends: ov === null ? autoPilotSends : !ov };
}
