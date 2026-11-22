// Parsing of clock times and dates typed by the pilot (src/ui/TimeField, src/ui/DateField). Pure.

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * A typed clock time → 'HH:MM'; '' for an empty field; null when it is not a time.
 * '9' → 09:00, '09' → 09:00, '930' → 09:30, '0930' → 09:30, '9:30', '09:30', '9.30', '9h30', '0930Z'.
 */
export function parseTime(s: string): string | null {
  const t = s.trim().replace(/z$/i, '').trim();
  if (!t) return '';
  let h: number, m: number;
  const sep = /^(\d{1,2})\s*[:.h]\s*(\d{2})?$/i.exec(t);
  if (sep) {
    h = +sep[1];
    m = sep[2] ? +sep[2] : 0;
  } else if (/^\d{1,4}$/.test(t)) {
    // 1–2 digits: the hour; 3: H MM; 4: HH MM
    h = t.length <= 2 ? +t : +t.slice(0, t.length - 2);
    m = t.length <= 2 ? 0 : +t.slice(-2);
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * A typed duration → minutes; null when it is not one. '1:30', '1.30', '1h30', '1h' → 90 / 60;
 * digits alone are minutes ('90'), except 3–4 digits read as H MM / HH MM ('130' → 1:30) the way
 * clock times are typed.
 */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase();
  const sep = /^(\d{1,2})\s*[:.h]\s*(\d{1,2})?\s*m?$/.exec(t);
  if (sep) {
    const m = sep[2] ? +sep[2] : 0;
    return m < 60 ? +sep[1] * 60 + m : null;
  }
  const d = /^(\d{1,4})\s*(m|min)?$/.exec(t);
  if (!d) return null;
  if (d[2] || d[1].length <= 2) return +d[1];
  const m = +d[1].slice(-2);
  return m < 60 ? +d[1].slice(0, -2) * 60 + m : null;
}

/** Minutes as a duration field writes them: 90 → '1:30'. */
export const fmtDurationField = (min: number): string =>
  `${Math.floor(Math.round(min) / 60)}:${pad2(Math.round(min) % 60)}`;

/** 'HH:MM' → minutes after midnight; NaN otherwise. */
export const clockMinutes = (hhmm: string): number => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? +m[1] * 60 + +m[2] : NaN;
};

/** The day's times every `step` minutes: '00:00', '00:15', … '23:45'. */
export function timeSlots(step = 15): string[] {
  const out: string[] = [];
  for (let m = 0; m < 1440; m += step) out.push(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`);
  return out;
}

/** Index of the slot nearest a clock time (ties go to the earlier slot); -1 for no time. */
export function nearestSlot(slots: string[], hhmm: string): number {
  const t = clockMinutes(hhmm);
  if (!Number.isFinite(t) || !slots.length) return -1;
  let best = 0;
  for (let i = 1; i < slots.length; i++)
    if (Math.abs(clockMinutes(slots[i]) - t) < Math.abs(clockMinutes(slots[best]) - t)) best = i;
  return best;
}

/** 'YYYY-MM-DD' of a real calendar date, else false. */
export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * A date as typed or pasted → 'YYYY-MM-DD' ('' when empty), or null when it is not a real date.
 * Accepts '2026-11-16', '20261116', '2026/11/16', '2026.11.16', '2026-1-5'.
 */
export function parseDate(s: string): string | null {
  const t = s.trim();
  if (!t) return '';
  const m = /^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/.exec(t) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const out = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isRealDate(out) ? out : null;
}

/**
 * The text of a date field after an insertion (typing or pasting at the end): the digits laid out as
 * YYYY-MM-DD, with the dash after the year and after the month put in as soon as they are complete.
 * '2026' → '2026-', '202611' → '2026-11-', '20261116' → '2026-11-16', '2026/11/16' → '2026-11-16';
 * a one-digit month closed by a separator is padded ('2026-1-' → '2026-01-').
 */
export function maskDate(s: string): string {
  const parts = s.trim().split(/[^\d]+/);
  let digits = s.replace(/\D/g, '');
  if (parts.length >= 3 && parts[0].length === 4 && parts[1].length === 1)
    digits = parts[0] + '0' + parts.slice(1).join('');
  const d = digits.slice(0, 8);
  let out = d.slice(0, 4);
  if (d.length >= 4) out += '-' + d.slice(4, 6);
  if (d.length >= 6) out += '-' + d.slice(6, 8);
  return out;
}

/** Why a typed date is not accepted (null when it is): not a date, or outside [min, max]. */
export function dateProblem(s: string, min?: string, max?: string): string | null {
  const v = parseDate(s);
  if (v === null) return 'Not a valid date';
  if (v && min && v < min) return `Earliest ${min}`;
  if (v && max && v > max) return `Latest ${max}`;
  return null;
}
