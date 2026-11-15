// The app's formatters: clock times, durations, altitudes, sizes, error text. Pure and Node-safe
// (used by the client, src/calc and api/_lib). Pilot conventions: durations '1h44', clock times
// 'HH:MM' UTC (with 'Z' where the reader needs it), dates 'YYYY-MM-DD', altitudes '3000' / 'FL065'.
// Unit-tested in tests/unit/shared/format.test.ts.
import { LOCAL_TZ, localDayTime } from './date.js';

/** Zero-padded integer: pad(7) → '07', pad(5, 3) → '005'. */
export const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export interface ClockOpts {
  /** Append 'Z'. */
  z?: boolean;
  /** Text for an unknown value (default ''). */
  fallback?: string;
}

/** Minutes after 00:00 UTC → 'HH:MM' (wraps past midnight): fmtClock(570) → '09:30', with z '09:30Z'. */
export function fmtClock(min: number | null | undefined, opts: ClockOpts = {}): string {
  if (!finite(min)) return opts.fallback ?? '';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}${opts.z ? 'Z' : ''}`;
}

/** Epoch ms → its UTC clock time, 'HH:MM' (or 'HH:MMZ'). */
export function fmtClockMs(ms: number | null | undefined, opts: ClockOpts = {}): string {
  if (!finite(ms)) return opts.fallback ?? '';
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${opts.z ? 'Z' : ''}`;
}

/** Epoch ms → 'YYYY-MM-DD HH:MMZ' (UTC). */
export function fmtDateTimeMs(ms: number | null | undefined, opts: { z?: boolean; fallback?: string } = {}): string {
  if (!finite(ms)) return opts.fallback ?? '';
  return `${new Date(ms).toISOString().slice(0, 10)} ${fmtClockMs(ms, { z: opts.z ?? true })}`;
}

/** A duration as pilots write it: minutes → '1h44', '0h10' (rounded to the minute). Fallback ('') for unknown or negative. */
export function fmtDuration(min: number | null | undefined, opts: { fallback?: string } = {}): string {
  if (!finite(min) || min < 0) return opts.fallback ?? '';
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h${pad(m % 60)}`;
}

/** Local (Greek) clock time of an instant, 'HH:MM'. */
export function fmtLocalClock(ms: number | null | undefined, opts: { fallback?: string; timeZone?: string } = {}): string {
  const t = finite(ms) ? localDayTime(ms, opts.timeZone ?? LOCAL_TZ) : null;
  return t ? t.clock : opts.fallback ?? '';
}

/** Local (Greek) date and time of an instant, 'YYYY-MM-DD HH:MM'. */
export function fmtLocalDayTime(ms: number | null | undefined, opts: { fallback?: string; timeZone?: string } = {}): string {
  const t = finite(ms) ? localDayTime(ms, opts.timeZone ?? LOCAL_TZ) : null;
  return t ? `${t.day} ${t.clock}` : opts.fallback ?? '';
}

/**
 * Altitudes above this are written as flight levels (the usual transition altitude in the
 * Athinai FIR; below it altitudes are in feet on QNH).
 */
export const TRANSITION_ALTITUDE_FT = 6000;

/**
 * An altitude as pilots write it: plain feet up to the transition altitude ('3000', or '3000 ft'
 * with `unit`), a flight level above it ('FL065'). '---' when unknown.
 * (The ICAO FPL item 15 keeps its own encoding: see exports/fpl.)
 */
export function fmtAltitude(ft: number | null | undefined, opts: { unit?: boolean } = {}): string {
  if (!finite(ft)) return '---';
  if (ft > TRANSITION_ALTITUDE_FT) return `FL${pad(Math.max(0, Math.round(ft / 100)), 3)}`;
  const v = String(Math.max(0, Math.round(ft)));
  return opts.unit ? `${v} ft` : v;
}

/** File size: '812 KB', '2.4 MB' (at least 1 KB). */
export function fmtSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * What went wrong, for a toast or an inline error: 'You are offline.' for a network failure
 * (ApiRequestError status 0), else the error's message.
 */
export function errorMessage(e: unknown): string {
  const x = e as { status?: unknown; offline?: unknown; message?: unknown } | null | undefined;
  if (x && typeof x === 'object' && (x.offline === true || (x.status === 0 && (x as Error).name === 'ApiRequestError'))) return 'You are offline.';
  if (x && typeof x === 'object' && typeof x.message === 'string' && x.message) return x.message;
  return String(e ?? 'Unknown error');
}
