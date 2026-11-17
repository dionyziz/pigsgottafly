// Calendar dates: 'YYYY-MM-DD' strings and epoch ms. Pure and Node-safe (used by the client, src/calc
// and api/_lib). Local time is Greek time everywhere (LOCAL_TZ), whatever zone the device is in.
// Unit-tested in tests/unit/shared/format.test.ts.

/** The one local time zone of the app: lobby dates, "today", local clock times. */
export const LOCAL_TZ = 'Europe/Athens';

const DAY_MS = 86400000;

/** 'YYYY-MM-DD' → epoch ms of 00:00 UTC that day; null if not a real calendar date. */
export function parseIsoDate(d: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const back = new Date(t);
  return back.getUTCDate() === +m[3] && back.getUTCMonth() === +m[2] - 1 ? t : null;
}

/** A real calendar date written 'YYYY-MM-DD' ('2026-02-30' is not). */
export const isIsoDate = (d: string | null | undefined): d is string => parseIsoDate(d) !== null;

/** Epoch ms → its UTC day, 'YYYY-MM-DD'. */
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Today's UTC day, 'YYYY-MM-DD'. */
export const todayUtc = (now: number | Date = Date.now()): string => isoDay(+now);

const dayFmt = new Map<string, Intl.DateTimeFormat>();
function zoneParts(ms: number, timeZone: string): Record<string, string> {
  let f = dayFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    dayFmt.set(timeZone, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Today's date in Greece (or `timeZone`), 'YYYY-MM-DD'. */
export function localToday(now: number | Date = Date.now(), timeZone = LOCAL_TZ): string {
  const p = zoneParts(+now, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local (Greek) date and clock of an instant: { day: 'YYYY-MM-DD', clock: 'HH:MM' }; null if invalid. */
export function localDayTime(ms: number, timeZone = LOCAL_TZ): { day: string; clock: string } | null {
  if (!Number.isFinite(ms)) return null;
  const p = zoneParts(ms, timeZone);
  return { day: `${p.year}-${p.month}-${p.day}`, clock: `${p.hour}:${p.minute}` };
}

/** 'YYYY-MM-DD' as written ('' for anything that is not a real date). */
export function fmtDate(d: string | null | undefined): string {
  return isIsoDate(d) ? d : '';
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'); null if either is invalid. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseIsoDate(from),
    b = parseIsoDate(to);
  return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

/** 'YYYY-MM-DD' plus n days. '' if the date is invalid. */
export function addDays(d: string, n: number): string {
  const t = parseIsoDate(d);
  return t === null ? '' : isoDay(t + n * DAY_MS);
}

/** 'today', 'tomorrow', 'in 5 days', 'yesterday', '3 days ago', or '' beyond two weeks. */
export function relativeDay(d: string, today: string): string {
  const n = daysBetween(today, d);
  if (n === null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 1 && n <= 14) return `in ${n} days`;
  if (n < -1 && n >= -14) return `${-n} days ago`;
  return '';
}

/** Age in whole years on `on` for a date of birth; null if either is unknown. */
export function ageOn(dob: string | null | undefined, on: string): number | null {
  const b = parseIsoDate(dob),
    d = parseIsoDate(on);
  if (b === null || d === null) return null;
  const B = new Date(b),
    D = new Date(d);
  let age = D.getUTCFullYear() - B.getUTCFullYear();
  if (D.getUTCMonth() < B.getUTCMonth() || (D.getUTCMonth() === B.getUTCMonth() && D.getUTCDate() < B.getUTCDate()))
    age--;
  return age;
}

/**
 * Local (Greek) clock time of a UTC 'HH:MM' on a date: utcToLocal('2026-07-01', '09:30') → '12:30'.
 * '' when either is missing.
 */
export function utcToLocal(date: string, hhmm: string, timeZone = LOCAL_TZ): string {
  const d = parseIsoDate(date);
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (d === null || !m) return '';
  return localDayTime(d + (+m[1] * 60 + +m[2]) * 60000, timeZone)!.clock;
}

/** Offset of local time at an instant, e.g. 'UTC+2', 'UTC+3' ('LT' if unknown). */
export function localOffsetLabel(ms: number, timeZone = LOCAL_TZ): string {
  if (!Number.isFinite(ms)) return 'LT';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(
      new Date(ms),
    );
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return tz.replace('GMT', 'UTC') || 'LT';
  } catch {
    return 'LT';
  }
}
