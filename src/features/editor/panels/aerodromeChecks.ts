// The route's aerodromes at their planned times against their hours (AIP AD 2.3 / AD 1.6 + the flight's
// NOTAMs, src/calc/aerodromeStatus.ts), and the editor warnings they give. Pure (no React): wired in
// calc.tsx, unit-tested in tests/unit/screens/aerodromeChecks.test.ts.
//   departure      block start … take-off (with a stop there: … the last take-off from there)
//   stop           landing there … take-off from there (an intermediate full stop)
//   touch-and-go   when the aircraft gets there
//   destination    landing … block stop (with a stop there: from the first landing there)
import { type AdNotamEffect, type AdStatus, aerodromeStatus, clockZ } from '../../../calc';
import { activeRequests, type FlightOptions, type RoutePoint } from '../../../shared';
import type { RefAerodrome, RefSunTable } from '../../../shared/ref';

export interface AdCheck {
  role: 'departure' | 'destination' | 'stop' | 'touch-and-go';
  pointIndex: number;
  aerodrome: RefAerodrome;
  /** Epoch ms; NaN when the block start time is not set. */
  fromMs: number;
  toMs: number;
  /** e.g. 'block start 08:00Z – take-off 08:10Z', 'touch-and-go 09:12Z'. */
  when: string;
  ad: AdStatus;
  ats: AdStatus | null;
  handling: AdStatus;
}

export const AD_ROLE: Record<AdCheck['role'], string> = {
  departure: 'Departure',
  destination: 'Destination',
  stop: 'Stop',
  'touch-and-go': 'Touch-and-go',
};

export interface AdChecksInput {
  route: RoutePoint[];
  options: Pick<FlightOptions, 'aerodromeRequests'>;
  departure: RefAerodrome | null;
  destination: RefAerodrome | null;
  aerodromeOf: (p: RoutePoint) => RefAerodrome | null;
  /** 00:00 UTC of the flight date, epoch ms. */
  dayMs: number;
  /** Navlog times, minutes after dayMs; undefined when the block start time is not set. */
  times?: { blockOffMin: number; takeoffMin: number; landingMin: number; blockOnMin: number };
  /** Navlog leg end times (minutes after dayMs), by leg. */
  legEndMin: number[];
  /** Full stops and touch-and-goes with their landing / take-off times (epoch ms), the route's ends included. */
  stops: { pointIndex: number; aerodrome: RefAerodrome | null; landingMs: number; takeoffMs: number }[];
  effects: readonly AdNotamEffect[];
  sunTables?: Record<string, RefSunTable>;
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

export function aerodromeChecks(i: AdChecksInput): AdCheck[] {
  const out: AdCheck[] = [];
  const opts = { effects: i.effects, sunTables: i.sunTables };
  const ms = (min: number | undefined) => (fin(i.dayMs) && i.times && fin(min) ? i.dayMs + min * 60000 : NaN);
  const z = (x: number) => (fin(x) ? `${clockZ(x)}Z` : '');
  const add = (
    role: AdCheck['role'],
    pointIndex: number,
    ad: RefAerodrome | null,
    fromMs: number,
    toMs: number,
    when: string,
  ) => {
    if (!ad) return;
    out.push({
      role,
      pointIndex,
      aerodrome: ad,
      fromMs,
      toMs,
      when,
      ad: aerodromeStatus(ad, 'ad', fromMs, toMs, opts),
      ats: ad.hours?.ats ? aerodromeStatus(ad, 'ats', fromMs, toMs, opts) : null,
      handling: aerodromeStatus(ad, 'handling', fromMs, toMs, opts),
    });
  };
  const r = i.route;
  if (!r.length) return out;
  const tng = new Set(
    activeRequests(r, i.options)
      .filter((x) => x.request.kind === 'touch-and-go')
      .map((x) => x.index),
  );
  // A touch-and-go then a full stop at one aerodrome: from the first landing to the last take-off there.
  const stopAt = new Map<number, AdChecksInput['stops'][number]>();
  for (const x of i.stops) {
    const prev = stopAt.get(x.pointIndex);
    stopAt.set(x.pointIndex, prev ? { ...prev, takeoffMs: x.takeoffMs } : x);
  }
  // A stop at the departure keeps the aircraft there until its last take-off.
  const bo = ms(i.times?.blockOffMin),
    to = stopAt.get(0)?.takeoffMs ?? ms(i.times?.takeoffMin);
  add('departure', 0, i.departure, bo, to, fin(bo) ? `block start ${z(bo)} – take-off ${z(to)}` : 'departure');
  for (let k = 1; k < r.length - 1; k++) {
    const st = stopAt.get(k);
    if (st) {
      add(
        'stop',
        k,
        st.aerodrome,
        st.landingMs,
        st.takeoffMs,
        fin(st.landingMs) ? `landing ${z(st.landingMs)} – take-off ${z(st.takeoffMs)}` : 'stop',
      );
      continue;
    }
    if (tng.has(k)) {
      const at = ms(i.legEndMin[k - 1]);
      add('touch-and-go', k, i.aerodromeOf(r[k]), at, at, fin(at) ? `touch-and-go ${z(at)}` : 'touch-and-go');
    }
  }
  if (r.length > 1) {
    // A stop at the destination: from the first landing there.
    const ldg = stopAt.get(r.length - 1)?.landingMs ?? ms(i.times?.landingMin),
      bon = ms(i.times?.blockOnMin);
    add(
      'destination',
      r.length - 1,
      i.destination,
      ldg,
      bon,
      fin(ldg) ? `landing ${z(ldg)} – block stop ${z(bon)}` : 'arrival',
    );
  }
  return out;
}

export interface AdWarning {
  level: 'danger' | 'warn' | 'info';
  text: string;
}

/** Editor warnings: closed (danger), NOTAM limits (warn), hours not known and ATS off (info). */
export function aerodromeWarnings(checks: AdCheck[]): AdWarning[] {
  const w: AdWarning[] = [];
  const timed = checks.filter((c) => fin(c.fromMs));
  for (const c of timed) {
    const name = `${AD_ROLE[c.role]} ${c.aerodrome.icao || c.aerodrome.name}`;
    if (c.ad.status === 'closed')
      w.push({
        level: 'danger',
        text: `${name} closed at ${clockZ(c.ad.at)}Z (${c.when}): ${c.ad.why} (${c.ad.source}).`,
      });
    for (const l of c.ad.limits) w.push({ level: 'warn', text: `${name}: NOTAM ${l.key}: ${l.summary}.` });
    // ATS NIL (uncontrolled aerodromes) is not news
    if (c.ad.status === 'open' && c.ats?.status === 'closed' && c.aerodrome.hours?.ats?.parsed.label !== 'NIL') {
      w.push({
        level: 'info',
        text: `${name}: ATS not in service at ${clockZ(c.ats.at)}Z: ${c.ats.why} (${c.ats.source}).`,
      });
    }
  }
  return w;
}
