// Aerodrome operational hours (AIP AD 2.3 / AD 1.6.N.3) and service schedules (handling, ATS, NOTAM
// item D / E): the parser that turns the printed text into an HoursSpec, and its evaluation at an
// instant. Pure: no I/O.
//
// The parser is strict: whatever it cannot represent exactly makes the spec `partial`, which is then
// shown as the AIP text and evaluated as 'unknown' rather than guessed. tests/unit/calc/adHours.test.ts
// runs it over every aerodrome's real text.
//
// Abbreviations (AIP GEN 2.2): H24 continuous day and night service; HJ sunrise to sunset; HN sunset to
// sunrise; HO service available to meet operational requirements (for the Greek category A aerodromes
// the HO hours are promulgated by NOTAM twice a year, AD 1.1.1.4.2.2); HX no specific working hours; HS
// service available during the hours of scheduled operations; O/R on request; PN/PNR prior notice.
// A service (handling, customs, ATS) marked HO is available while the aerodrome is open ('AD').
import type {
  HoursClock,
  HoursRule,
  HoursSeason,
  HoursSpec,
  HoursTime,
  RefAdHours,
  RefSunTable,
} from '../shared/ref.js';
import { sunriseUtcMinutes } from './nav.js';
import { isoDay } from '../shared/date.js';
import { sunsetMinutes } from './sun.js';

// ---------------------------------------------------------------- text normalisation

const GREEK: Record<string, string> = {
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
};

/** Greek capitals that look like Latin ones (the AIP prints 'Η24', 'ΗΧ', 'ΜΕΤ') → Latin; dashes → '-'; spaces collapsed. */
export function normalizeAipText(s: string): string {
  return s
    .replace(/[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]/g, (c) => GREEK[c])
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- dates, seasons, holidays

const DAY_MS = 86400e3;
const pad2 = (n: number) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' of an instant (UTC). */
export { isoDay } from '../shared/date.js';

/** Last Sunday of a month (0-based month), as a UTC day number (ms at 00:00). */
function lastSunday(year: number, month: number): number {
  const last = Date.UTC(year, month + 1, 0);
  return last - new Date(last).getUTCDay() * DAY_MS;
}

/** EU summer time (last Sunday of March 01:00 UTC → last Sunday of October 01:00 UTC): the AIP's "summer period". */
export function isSummerTime(ms: number): boolean {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSunday(y, 2) + 3600e3 && ms < lastSunday(y, 9) + 3600e3;
}

/** Orthodox Easter Sunday of a year (Meeus' Julian algorithm + 13 days, valid 1900–2099), UTC ms. */
export function orthodoxEaster(year: number): number {
  const a = year % 4,
    b = year % 7,
    c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31); // 3 = March, 4 = April (Julian)
  const day = ((d + e + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day) + 13 * DAY_MS;
}

const holidayCache = new Map<number, Set<string>>();
/** Greek public holidays of a year ('YYYY-MM-DD'): the fixed ones and those that move with Orthodox Easter. */
export function greekHolidays(year: number): Set<string> {
  let s = holidayCache.get(year);
  if (s) return s;
  const e = orthodoxEaster(year);
  s = new Set([
    `${year}-01-01`,
    `${year}-01-06`,
    `${year}-03-25`,
    `${year}-05-01`,
    `${year}-08-15`,
    `${year}-10-28`,
    `${year}-12-25`,
    `${year}-12-26`,
    isoDay(e - 48 * DAY_MS), // Clean Monday
    isoDay(e - 2 * DAY_MS), // Good Friday
    isoDay(e), // Easter Sunday
    isoDay(e + DAY_MS), // Easter Monday
    isoDay(e + 50 * DAY_MS), // Whit Monday
  ]);
  holidayCache.set(year, s);
  return s;
}
export const isGreekHoliday = (day: string) => greekHolidays(+day.slice(0, 4)).has(day);

/** ISO weekday (1 = Monday … 7 = Sunday) of a 'YYYY-MM-DD'. */
export const isoWeekday = (day: string) => ((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;

function inSeason(season: HoursSeason | undefined, day: string, ms: number): boolean {
  if (!season) return true;
  if (season === 'summer') return isSummerTime(ms);
  if (season === 'winter') return !isSummerTime(ms);
  const md = day.slice(5);
  return season.from <= season.to ? md >= season.from && md <= season.to : md >= season.from || md <= season.to;
}

// ---------------------------------------------------------------- the schedule grammar

const DAYS: Record<string, number> = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 7,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
  TUES: 2,
  THUR: 4,
  THURS: 4,
};
const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Words that carry no schedule information in an hours text ('AD OPR HR:', 'UTC', 'HOURS OF SERVICE'). */
const FILLER = new Set([
  'UTC',
  'AD',
  'AERODROME',
  'AIRPORT',
  'OPR',
  'OPS',
  'OPERATIONAL',
  'OPERATING',
  'OPERATION',
  'HR',
  'HRS',
  'HOURS',
  'HOUR',
  'OF',
  'SER',
  'SERVICE',
  'SERVICES',
  'ARE',
  'IS',
  'WILL',
  'BE',
  'AS',
  'FLW',
  'FLW:',
  'FOLLOWS',
  'THE',
  'ON',
  'AT',
  'FM',
  'FROM',
  'TIME',
  'TIMES',
  'PERIOD',
  'ONLY',
  'ALL',
  'YEAR',
  'AVBL',
  'AVAILABLE',
  'OPEN',
  'OPN',
  'NEW',
  'NOW',
  'DURING',
  'DAYS',
  'DAY',
  'BTN',
  'BETWEEN',
]);

type Tok =
  | { k: 'day'; v: number }
  | { k: 'daily' }
  | { k: 'hol' }
  | { k: 'weekend' }
  | { k: 'exc' }
  | { k: 'range' }
  | { k: 'and' }
  | { k: 'sep' }
  | { k: 'colon' }
  | { k: 'time'; v: HoursTime }
  | { k: 'alt'; v: HoursTime }
  | { k: 'season'; v: HoursSeason }
  | { k: 'shift'; v: number }
  | { k: 'word'; v: string };

const CLOCK = String.raw`(?:(\d{4})|(SR|SS)(?:\s*([+-])\s*(\d+)\s*(MIN|HR|H)?)?)`;
const WINDOW_RE = new RegExp(String.raw`^${CLOCK}\s*-\s*${CLOCK}`);

function clockOf(
  hhmm: string | undefined,
  sun: string | undefined,
  sign: string | undefined,
  n: string | undefined,
  unit: string | undefined,
): HoursClock | null {
  if (hhmm) {
    const h = +hhmm.slice(0, 2),
      m = +hhmm.slice(2);
    if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
    return { utc: h * 60 + m };
  }
  if (sun)
    return {
      sun: sun as 'SR' | 'SS',
      offsetMin: n ? (sign === '-' ? -1 : 1) * +n * (unit === 'HR' || unit === 'H' ? 60 : 1) : 0,
    };
  return null;
}

/** Tokens of a schedule text; null = something unparseable (a word that is not filler). */
function tokenize(text: string): Tok[] | null {
  let s = normalizeAipText(text).toUpperCase();
  const out: Tok[] = [];
  // date-range seasons first ('01 MAY - 31 OCT', 'FROM APRIL TO OCTOBER', 'APR-OCT')
  while (s.length) {
    s = s.replace(/^\s+/, '');
    if (!s) break;
    let m: RegExpExecArray | null;
    if (
      (m = /^\(\s*(SUMMER|WINTER)(?: TIME| PERIOD)?\s*:?\s*([+-])\s*(\d)\s*(?:HR|HRS|H)\s*\)/.exec(s)) ||
      (m = /^(SUMMER|WINTER)(?: TIME| PERIOD)?\s*:?\s*([+-])\s*(\d)\s*(?:HR|HRS|H)\b/.exec(s))
    ) {
      out.push({ k: 'shift', v: (m[2] === '-' ? -1 : 1) * +m[3] * 60 * (m[1] === 'SUMMER' ? 1 : -1) });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^\(\s*(\d{4})\s*-\s*(\d{4})\s*\)/.exec(s))) {
      const a = clockOf(m[1], undefined, undefined, undefined, undefined),
        b = clockOf(m[2], undefined, undefined, undefined, undefined);
      if (!a || !b) return null;
      out.push({ k: 'alt', v: { t: 'window', from: a, to: b } });
      s = s.slice(m[0].length);
      continue;
    }
    if (
      (m = /^(\d{1,2}) ([A-Z]{3,9})\s*(?:-|TO|TILL|UNTIL)\s*(\d{1,2}) ([A-Z]{3,9})\b\s*:?/.exec(s)) &&
      MONTHS[m[2]] &&
      MONTHS[m[4]]
    ) {
      out.push({
        k: 'season',
        v: { from: `${pad2(MONTHS[m[2]])}-${pad2(+m[1])}`, to: `${pad2(MONTHS[m[4]])}-${pad2(+m[3])}` },
      });
      s = s.slice(m[0].length);
      continue;
    }
    if (
      (m = /^(?:FROM )?([A-Z]{3,9})\s*(?:-|TO|TILL|UNTIL)\s*([A-Z]{3,9})\b\s*:?/.exec(s)) &&
      MONTHS[m[1]] &&
      MONTHS[m[2]]
    ) {
      out.push({
        k: 'season',
        v: { from: `${pad2(MONTHS[m[1]])}-01`, to: `${pad2(MONTHS[m[2]])}-${MONTH_DAYS[MONTHS[m[2]] - 1]}` },
      });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(SUMMER|WINTER)(?: TIME| PERIOD| SEASON)?(?: ONLY)?\s*:?/.exec(s))) {
      out.push({ k: 'season', v: m[1] === 'SUMMER' ? 'summer' : 'winter' });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = WINDOW_RE.exec(s))) {
      const a = clockOf(m[1], m[2], m[3], m[4], m[5]),
        b = clockOf(m[6], m[7], m[8], m[9], m[10]);
      if (!a || !b) return null;
      out.push({ k: 'time', v: { t: 'window', from: a, to: b } });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(H24|HJ|HN|HX|HO|HS)\b/.exec(s))) {
      out.push({ k: 'time', v: { t: m[1] as 'H24' } });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(CLSD|CLOSED)\b/.exec(s))) {
      out.push({ k: 'time', v: { t: 'CLSD' } });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(O\/R|ON REQUEST)\b/.exec(s))) {
      out.push({ k: 'time', v: { t: 'OR' } });
      s = s.slice(m[0].length);
      continue;
    }
    if (
      (m =
        /^(ON AD (?:OPR|OPERATING|OPERATIONAL) (?:HR|HRS|HOURS)|WITHIN AD (?:HR|HRS|HOURS)|DURING AD (?:OPR|OPERATING|OPERATIONAL) (?:HR|HRS|HOURS))\b/.exec(
          s,
        ))
    ) {
      out.push({ k: 'time', v: { t: 'AD' } });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(DAILY|EVERY DAY|EVERYDAY)\b/.exec(s))) {
      out.push({ k: 'daily' });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(WEEKENDS?)\b/.exec(s))) {
      out.push({ k: 'weekend' });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(HOL|HOLIDAYS?|PUBLIC HOLIDAYS?|PUBLIC HOL)\b/.exec(s))) {
      out.push({ k: 'hol' });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(EXC|EXCEPT)\b/.exec(s))) {
      out.push({ k: 'exc' });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(AND|&|\+)/.exec(s))) {
      out.push({ k: 'and' });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^(-|TO\b|TILL\b|UNTIL\b)/.exec(s))) {
      out.push({ k: 'range' });
      s = s.slice(m[0].length);
      continue;
    }
    if ((m = /^[,;.]/.exec(s))) {
      out.push({ k: 'sep' });
      s = s.slice(1);
      continue;
    }
    if ((m = /^:/.exec(s))) {
      out.push({ k: 'colon' });
      s = s.slice(1);
      continue;
    }
    if ((m = /^([A-Z]+)/.exec(s))) {
      const w = m[1];
      if (DAYS[w]) out.push({ k: 'day', v: DAYS[w] });
      else if (!FILLER.has(w)) return null;
      s = s.slice(w.length);
      continue;
    }
    return null;
  }
  return out;
}

const range = (a: number, b: number) => {
  const out: number[] = [];
  for (let d = a; ; d = (d % 7) + 1) {
    out.push(d);
    if (d === b || out.length > 7) break;
  }
  return out;
};

/**
 * A schedule ('MON-FRI 0500-1700, SAT SUN 0600-1400', 'DAILY SR-1200', 'SUMMER: H24', 'MON-SAT 1000-1700',
 * '0600-2200 (0500-2100)', 'MON-FRI 0600-1400 (SUMMER PERIOD -1 HR)', 'SAT-SUN-HOL') → rules, or null when
 * the text is not entirely a schedule.
 */
export function parseSchedule(text: string): HoursRule[] | null {
  const toks = tokenize(text);
  if (!toks || !toks.length) return null;
  const rules: HoursRule[] = [];
  let season: HoursSeason | undefined;
  const st = {
    days: null as number[] | null,
    hol: false,
    exceptHol: false,
    pendingRange: false,
    lastDay: null as number | null,
  };
  let cur: HoursRule | null = null; // the rule times are being added to
  let shift: number | null = null;
  const flushDays = () => {
    st.days = null;
    st.hol = false;
    st.exceptHol = false;
    st.lastDay = null;
    st.pendingRange = false;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    switch (t.k) {
      case 'season':
        season = t.v;
        cur = null;
        flushDays();
        break;
      case 'daily':
        if (cur) {
          cur = null;
          flushDays();
        }
        st.days = [1, 2, 3, 4, 5, 6, 7];
        break;
      case 'weekend':
        if (cur) {
          cur = null;
          flushDays();
        }
        st.days = [...(st.days ?? []), 6, 7];
        break;
      case 'hol':
        if (cur) {
          cur = null;
          flushDays();
        }
        if (toks[i - 1]?.k === 'exc') st.exceptHol = true;
        else st.hol = true;
        break;
      case 'exc':
        if (toks[i + 1]?.k !== 'hol') return null;
        break;
      case 'day': {
        if (cur) {
          cur = null;
          flushDays();
        }
        if (st.pendingRange && st.lastDay !== null) {
          st.days = [...(st.days ?? []).filter((d) => d !== st.lastDay), ...range(st.lastDay, t.v)];
          st.pendingRange = false;
        } else st.days = [...(st.days ?? []), t.v];
        st.lastDay = t.v;
        break;
      }
      case 'range':
        // a dash between days is a range; between a day group and 'HOL' ('SAT-SUN-HOL') it is a list
        if (st.lastDay !== null && toks[i + 1]?.k === 'day') st.pendingRange = true;
        else if (toks[i + 1]?.k !== 'hol') return null;
        break;
      case 'and':
      case 'colon':
        break;
      case 'sep':
        // ',' between days lists them; after times it ends the group
        if (cur) {
          cur = null;
          flushDays();
        }
        break;
      case 'shift':
        shift = t.v;
        break;
      case 'time': {
        if (!cur) {
          cur = { times: [] };
          if (season) cur.season = season;
          if (st.days) cur.days = [...new Set(st.days as number[])].sort((a, b) => a - b);
          if (st.hol) cur.holidays = true;
          if (st.exceptHol) cur.exceptHolidays = true;
          rules.push(cur);
        }
        cur.times.push(t.v);
        break;
      }
      case 'alt': {
        // '0600-2200 (0500-2100)': the bracketed window is the summer one
        if (!cur || cur.season || cur.times.length !== 1 || cur.times[0].t !== 'window') return null;
        const summer: HoursRule = { ...cur, season: 'summer', times: [t.v] };
        cur.season = 'winter';
        rules.push(summer);
        break;
      }
      case 'word':
        return null;
    }
  }
  if (st.pendingRange) return null;
  // days with no times after them ('SAT-SUN-HOL'): the days are given, the hours are not (HX)
  if (!cur && (st.days || st.hol)) {
    const r: HoursRule = { times: [{ t: 'HX' }] };
    if (season) r.season = season;
    if (st.days) r.days = [...new Set(st.days as number[])].sort((a, b) => a - b);
    if (st.hol) r.holidays = true;
    rules.push(r);
  }
  if (!rules.length) return null;
  if (shift !== null) {
    // '(SUMMER PERIOD -1 HR)': the windows as printed are the winter ones; summer is shifted
    const out: HoursRule[] = [];
    for (const r of rules) {
      if (r.season) {
        out.push(r);
        continue;
      }
      const shifted = r.times.map((x) =>
        x.t === 'window' ? { ...x, from: shiftClock(x.from, shift!), to: shiftClock(x.to, shift!) } : x,
      );
      out.push({ ...r, season: 'summer', times: shifted }, { ...r, season: 'winter' });
    }
    return out;
  }
  return rules;
}

const shiftClock = (c: HoursClock, min: number): HoursClock =>
  'utc' in c ? { utc: (c.utc + min + 1440) % 1440 } : { ...c, offsetMin: c.offsetMin + min };

// ---------------------------------------------------------------- AIP items

export type HoursContext = 'ad' | 'ats' | 'handling' | 'customs';

const simple = (t: HoursTime['t']): HoursRule[] => [{ times: [{ t } as HoursTime] }];

interface Variant {
  line: string;
  core: string;
  notes: string[];
  /** HAF, HASP, Hellenic Army, … (from the brackets). */
  provider: string | null;
  civil: boolean;
  footnote: boolean;
}

function variantOf(line: string): Variant {
  let s = normalizeAipText(line);
  const notes: string[] = [];
  let provider: string | null = null;
  s = s.replace(/\(([^()]*)\)/g, (_, inner: string) => {
    const t = inner.trim();
    const p = /^(HAF|HASP|Hellenic Army|MET)\b/i.exec(t);
    if (p && !provider) provider = p[1];
    if (t) notes.push(t);
    return ' ';
  });
  let civil = false;
  s = s.replace(/\bfor civil aircraft\b/i, () => {
    civil = true;
    return ' ';
  });
  s = s.replace(/\ball year\b/i, ' ');
  let footnote = false;
  s = s.replace(/\*/g, () => {
    footnote = true;
    return ' ';
  });
  s = s
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { line: normalizeAipText(line), core: s, notes, provider, civil, footnote };
}

/** Lines of an item, with lines inside an open bracket joined to the next. */
function statements(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    cur = cur ? (cur.endsWith('-') ? cur + l : `${cur} ${l}`) : l;
    const open = (cur.match(/\(/g) ?? []).length,
      close = (cur.match(/\)/g) ?? []).length;
    if (open <= close) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** One statement's schedule (without brackets) in a context: HO of a service = the aerodrome's hours. */
function coreRules(core: string, ctx: HoursContext): { rules: HoursRule[]; notes: string[] } | null {
  const c = normalizeAipText(core).toUpperCase();
  const ho: HoursTime['t'] = ctx === 'ad' ? 'HO' : 'AD';
  if (c === 'HO') return { rules: simple(ho), notes: [] };
  if (c === 'NIL') return { rules: simple('NIL'), notes: [] };
  let m: RegExpExecArray | null;
  if ((m = /^(\d+) ?H(?:R|RS)? (PNR?|PRIOR NOTICE)$/.exec(c)))
    return { rules: simple('OR'), notes: [`${m[1]} HR prior notice`] };
  // 'During summer only, on AD operating hours'
  if (
    (m =
      /^DURING (SUMMER|WINTER)(?: PERIOD| TIME)?(?: ONLY)?,? (?:ON|DURING|WITHIN) AD (?:OPR|OPERATING|OPERATIONAL) (?:HR|HRS|HOURS)$/.exec(
        c,
      ))
  ) {
    return { rules: [{ season: m[1] === 'SUMMER' ? 'summer' : 'winter', times: [{ t: 'AD' }] }], notes: [] };
  }
  // 'HO from April to October'
  if ((m = /^(H24|HJ|HO|HX) FROM ([A-Z]+) TO ([A-Z]+)$/.exec(c)) && MONTHS[m[2]] && MONTHS[m[3]]) {
    const t = (m[1] === 'HO' ? ho : m[1]) as HoursTime['t'];
    return {
      rules: [
        {
          season: { from: `${pad2(MONTHS[m[2]])}-01`, to: `${pad2(MONTHS[m[3]])}-${MONTH_DAYS[MONTHS[m[3]] - 1]}` },
          times: [{ t } as HoursTime],
        },
      ],
      notes: [],
    };
  }
  const rules = parseSchedule(c);
  if (!rules) return null;
  if (ctx !== 'ad') for (const r of rules) r.times = r.times.map((x) => (x.t === 'HO' ? { t: 'AD' } : x));
  return { rules, notes: [] };
}

/** The footnote definitions of the remarks: '* HR: …', 'HX: …', '*= …'. */
function footnote(remarks: string | null | undefined, key: 'HR' | 'HX' | '*'): string | null {
  if (!remarks) return null;
  const r = normalizeAipText(remarks);
  if (key === 'HR') {
    const m = /\*\s*HR\s*:\s*(.*)$/i.exec(r);
    return m ? m[1] : null;
  }
  if (key === 'HX') {
    const m = /\bHX\s*:\s*(.*)$/i.exec(r);
    return m ? m[1] : null;
  }
  const m = /\*\s*=\s*(.*)$/.exec(r);
  return m ? m[1] : null;
}

/** Sentences of a footnote, '- Winter Period: HJ. - Summer Period: HO. - Rest Hours 30 min prior notice.' → parts. */
function footnoteRules(def: string, ctx: HoursContext): { rules: HoursRule[]; notes: string[] } | null {
  const parts = def
    .split(/\.\s+|\.$/)
    .map((x) => x.trim().replace(/^-\s+/, ''))
    .filter(Boolean);
  const rules: HoursRule[] = [];
  const notes: string[] = [];
  for (const p of parts) {
    const u = p.toUpperCase();
    if (/PRIOR NOTICE|\bPNR?\b|\bPPR\b|REQUIRED|OTHER TIMES|REST HOURS|COORDINATION|NOTAM|O\/R/.test(u)) {
      notes.push(p);
      continue;
    }
    if (/^AVAILABLE WITHIN AD (HOURS|HR)$/.test(u)) {
      rules.push({ times: [{ t: 'AD' }] });
      continue;
    }
    const sub = coreRules(p, ctx);
    if (!sub) return null;
    rules.push(...sub.rules);
  }
  return rules.length ? { rules, notes } : null;
}

/** Closures in the remarks: 'On 31 DEC and on 01 JAN Dekelia AD shall serve only State ACFT'. */
function remarkClosures(remarks: string | null | undefined): { rules: HoursRule[]; notes: string[] } {
  if (!remarks) return { rules: [], notes: [] };
  const r = normalizeAipText(remarks).toUpperCase();
  const m = /\bON ((?:\d{1,2} [A-Z]{3})(?: AND ON \d{1,2} [A-Z]{3})*) [^.]*?(SHALL SERVE ONLY STATE|CLOSED|CLSD)/.exec(
    r,
  );
  if (!m) return { rules: [], notes: [] };
  const rules: HoursRule[] = [];
  for (const d of m[1].split(/ AND ON /)) {
    const [dd, mon] = d.split(' ');
    if (!MONTHS[mon]) continue;
    const md = `${pad2(MONTHS[mon])}-${pad2(+dd)}`;
    rules.push({ season: { from: md, to: md }, times: [{ t: 'CLSD' }] });
  }
  return {
    rules,
    notes: rules.length ? [m[2] === 'SHALL SERVE ONLY STATE' ? `${m[1]}: state aircraft only` : `${m[1]}: closed`] : [],
  };
}

/**
 * The hours of one AIP item (verbatim text; '\n' between the printed lines). Several lines with different
 * providers ('HJ (HAF)\nHO (HASP)', 'HJ (HAF)\nHO for civil aircraft.') are alternatives: the civil one is
 * used (marked 'for civil aircraft', else HASP), and the others are kept as notes. `remarks` (item 12)
 * resolves footnotes ('HR*', 'HX:', '*=').
 */
export function parseHours(text: string, ctx: HoursContext, remarks?: string | null): HoursSpec {
  const lines = statements(text);
  if (!lines.length) return finish({ rules: simple('NIL'), notes: [], partial: false });
  const vs = lines.map(variantOf);
  // a line without a schedule of its own ('Contact Pieria Aeroclub tel: …') is a note on the one before
  const parsedLines = vs.map((v) => ({ v, r: v.core ? coreRules(v.core, ctx) : null }));
  const scheduleLines = parsedLines.filter(
    (x, i) => i === 0 || x.r || /^(H24|HJ|HN|HO|HX|HS|HR|NIL)\b/i.test(x.v.core),
  );
  const noteLines = parsedLines.filter((x) => !scheduleLines.includes(x)).map((x) => x.v.line);
  const chosen =
    scheduleLines.find((x) => x.v.civil) ??
    scheduleLines.find((x) => x.v.provider?.toUpperCase() === 'HASP') ??
    scheduleLines[0];
  const notes = [...chosen.v.notes];
  for (const x of scheduleLines) if (x !== chosen) notes.push(`${x.v.provider ?? 'Also'}: ${x.v.core}`);
  notes.push(...noteLines);
  let r = chosen.r;
  const core = chosen.v.core.toUpperCase();
  // footnotes
  if (chosen.v.footnote && /^HR$/.test(core)) {
    const def = footnote(remarks, 'HR');
    r = def ? footnoteRules(def, ctx) : null;
  } else if (chosen.v.footnote) {
    const def = footnote(remarks, '*');
    const f = def ? footnoteRules(def, ctx) : null;
    if (f) {
      r = { rules: f.rules, notes: [] };
      notes.push(`*= ${def}`);
    }
  } else if (core === 'HX' && (ctx === 'ad' || ctx === 'ats')) {
    const def = footnote(remarks, 'HX');
    const f = def ? footnoteRules(def, ctx) : null;
    if (f && !f.rules.every((x) => x.times.every((t) => t.t === 'HX' || t.t === 'OR'))) r = f;
  }
  if (!r) return finish({ rules: [], notes, partial: true });
  notes.push(...r.notes);
  let rules = r.rules;
  if (ctx === 'ad') {
    const cl = remarkClosures(remarks);
    if (cl.rules.length) {
      rules = [...cl.rules, ...rules];
      notes.push(...cl.notes);
    }
  }
  // no published aerodrome hours: not 'closed', just unknown
  if (
    ctx === 'ad' &&
    rules.length === 1 &&
    rules[0].times.length === 1 &&
    rules[0].times[0].t === 'NIL' &&
    !rules[0].season &&
    !rules[0].days
  ) {
    return { ...finish({ rules: simple('HX'), notes, partial: false }), label: 'NIL (no published hours)' };
  }
  return finish({ rules, notes, partial: false });
}

/**
 * Handling of an AD 1.6 aerodrome whose hours table has no handling item: the AD 1.6.N.4 section lists the
 * facilities (cargo, fuel, repairs), not a handling service → NIL.
 */
export function parseHandlingSection(text: string): HoursSpec {
  const t = normalizeAipText(text);
  return finish({
    rules: simple('NIL'),
    notes:
      t.toUpperCase() === 'NIL' ? [] : ['No handling service listed (AD 1.6 handling section lists facilities only)'],
    partial: false,
  });
}

function finish(s: Omit<HoursSpec, 'label'>): HoursSpec {
  return { ...s, notes: [...new Set(s.notes)], label: s.partial ? 'See AIP text' : fmtRules(s.rules) };
}

// ---------------------------------------------------------------- labels

const DAY_NAMES = ['', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const hhmm = (m: number) => `${pad2(Math.floor(m / 60) % 24)}${pad2(m % 60)}`;
function fmtClock(c: HoursClock): string {
  if ('utc' in c) return hhmm(c.utc);
  if (!c.offsetMin) return c.sun;
  const a = Math.abs(c.offsetMin);
  return `${c.sun}${c.offsetMin < 0 ? '-' : '+'}${a % 60 ? `${a} MIN` : `${a / 60} HR`}`;
}
const TIME_LABEL: Record<string, string> = {
  H24: 'H24',
  HJ: 'HJ',
  HN: 'HN',
  HO: 'HO',
  HX: 'HX',
  HS: 'HS',
  OR: 'O/R',
  AD: 'AD hours',
  NIL: 'NIL',
  CLSD: 'CLSD',
};
export function fmtTime(t: HoursTime): string {
  return t.t === 'window' ? `${fmtClock(t.from)}-${fmtClock(t.to)}` : TIME_LABEL[t.t];
}
function fmtDays(days: number[]): string {
  if (days.length === 7) return 'DAILY';
  const s = [...days].sort((a, b) => a - b);
  const contiguous = s.every((d, i) => i === 0 || d === s[i - 1] + 1);
  if (contiguous && s.length > 2) return `${DAY_NAMES[s[0]]}-${DAY_NAMES[s[s.length - 1]]}`;
  return s.map((d) => DAY_NAMES[d]).join(' ');
}
function fmtSeason(s: HoursSeason): string {
  if (s === 'summer') return 'Summer';
  if (s === 'winter') return 'Winter';
  const f = (md: string) => {
    const [m, d] = md.split('-').map(Number);
    return `${d} ${Object.keys(MONTHS)[m - 1]}`;
  };
  return s.from === s.to ? f(s.from) : `${f(s.from)}–${f(s.to)}`;
}
export function fmtRule(r: HoursRule): string {
  const parts: string[] = [];
  const dayPart = [r.days ? fmtDays(r.days) : '', r.holidays ? 'HOL' : '', r.exceptHolidays ? 'EXC HOL' : '']
    .filter(Boolean)
    .join(' ');
  if (dayPart && dayPart !== 'DAILY') parts.push(dayPart);
  else if (dayPart === 'DAILY' && r.times.some((t) => t.t === 'window')) parts.push('DAILY');
  parts.push(r.times.map(fmtTime).join(' '));
  return (r.season ? `${fmtSeason(r.season)}: ` : '') + parts.join(' ');
}
export function fmtRules(rules: HoursRule[]): string {
  return rules.map(fmtRule).join(', ');
}

// ---------------------------------------------------------------- evaluation

export type HoursStatus = 'open' | 'closed' | 'unknown';
export interface HoursAt {
  status: HoursStatus;
  /** Why, e.g. 'HJ 0452-1501Z', 'HO: hours published by NOTAM', 'not a scheduled day'. */
  why: string;
}

export interface HoursEvalCtx {
  lat: number;
  lon: number;
  /** AIP GEN 2.7 sunset tables (sunset; sunrise is NOAA). */
  sunTables?: Record<string, RefSunTable>;
  /** The aerodrome's own status, for services available during its hours ('AD'). */
  ad?: (ms: number) => HoursAt;
}

const sunCache = new Map<string, { sr: number | null; ss: number | null }>();
/** Sunrise and sunset at a place on a day, minutes after 00:00 UTC. */
export function sunTimes(
  day: string,
  ctx: Pick<HoursEvalCtx, 'lat' | 'lon' | 'sunTables'>,
): { sr: number | null; ss: number | null } {
  const k = `${day}|${ctx.lat.toFixed(3)}|${ctx.lon.toFixed(3)}|${ctx.sunTables ? 1 : 0}`;
  let v = sunCache.get(k);
  if (!v) {
    const sr = sunriseUtcMinutes(day, ctx.lat, ctx.lon);
    const ss = sunsetMinutes(day, ctx, ctx.sunTables ?? {});
    v = { sr: sr === null ? null : Math.ceil(sr), ss };
    if (sunCache.size > 5000) sunCache.clear();
    sunCache.set(k, v);
  }
  return v;
}

function clockMin(c: HoursClock, day: string, ctx: HoursEvalCtx): number | null {
  if ('utc' in c) return c.utc;
  const s = sunTimes(day, ctx);
  const base = c.sun === 'SR' ? s.sr : s.ss;
  return base === null ? null : base + c.offsetMin;
}

function ruleMatchesDay(r: HoursRule, day: string, ms: number, holiday: boolean): boolean {
  if (!inSeason(r.season, day, ms)) return false;
  const wd = isoWeekday(day);
  if (r.exceptHolidays && holiday) return false;
  const dayOk = r.days ? r.days.includes(wd) : !r.holidays;
  return dayOk || (!!r.holidays && holiday);
}

/** The rule deciding a day: on a public holiday the holiday rules first, then the first matching rule. */
function ruleFor(rules: HoursRule[], day: string, ms: number): HoursRule | null {
  const holiday = isGreekHoliday(day);
  if (holiday) {
    const h = rules.find((r) => r.holidays && inSeason(r.season, day, ms));
    if (h) return h;
  }
  return rules.find((r) => ruleMatchesDay(r, day, ms, holiday)) ?? null;
}

const WHY: Record<string, string> = {
  HO: 'HO: hours published by NOTAM',
  HX: 'HX: no fixed hours (contact the aerodrome)',
  HS: 'HS: hours of scheduled operations',
  OR: 'on request',
};

/** The spec's status at an instant. */
export function hoursAt(spec: HoursSpec, ms: number, ctx: HoursEvalCtx): HoursAt {
  if (spec.partial) return { status: 'unknown', why: 'see the AIP text' };
  const day = isoDay(ms);
  const min = Math.floor((ms - Date.parse(day + 'T00:00:00Z')) / 60e3);
  const r = ruleFor(spec.rules, day, ms);
  // yesterday's windows that run past midnight
  const prevDay = isoDay(ms - DAY_MS);
  const prev = ruleFor(spec.rules, prevDay, ms - DAY_MS);
  if (prev) {
    for (const t of prev.times) {
      if (t.t !== 'window') continue;
      const a = clockMin(t.from, prevDay, ctx),
        b = clockMin(t.to, prevDay, ctx);
      if (a !== null && b !== null && b <= a && min < b)
        return { status: 'open', why: `${fmtRule(prev)} (${prevDay})` };
    }
  }
  if (!r) return { status: 'closed', why: spec.rules.length ? `outside ${fmtRules(spec.rules)}` : 'no hours' };
  let unknown: HoursAt | null = null;
  let closedWhy = `outside ${fmtRule(r)}`;
  for (const t of r.times) {
    switch (t.t) {
      case 'H24':
        return { status: 'open', why: fmtRule(r) };
      case 'NIL':
        return { status: 'closed', why: 'NIL' };
      case 'CLSD':
        return { status: 'closed', why: `closed ${fmtRule(r).replace(/:? ?CLSD$/, '')}`.trim() };
      case 'HO':
      case 'HX':
      case 'HS':
      case 'OR':
        unknown ??= { status: 'unknown', why: WHY[t.t] };
        break;
      case 'AD': {
        if (!ctx.ad) {
          unknown ??= { status: 'unknown', why: 'during the aerodrome hours' };
          break;
        }
        const a = ctx.ad(ms);
        if (a.status === 'closed') closedWhy = `aerodrome closed (${a.why})`;
        else
          return {
            status: 'open',
            why: a.status === 'open' ? `during the aerodrome hours (${a.why})` : 'during the aerodrome hours',
          };
        break;
      }
      case 'HJ':
      case 'HN': {
        const s = sunTimes(day, ctx);
        if (s.sr === null || s.ss === null) {
          unknown ??= { status: 'unknown', why: 'no sunrise/sunset' };
          break;
        }
        const inDay = min >= s.sr && min < s.ss;
        const span = `${hhmm(s.sr)}-${hhmm(s.ss)}Z`;
        if (t.t === 'HJ' && inDay) return { status: 'open', why: `HJ ${span}` };
        if (t.t === 'HN' && !inDay) return { status: 'open', why: `HN (day ${span})` };
        closedWhy = t.t === 'HJ' ? `HJ ${span}` : `HN (day ${span})`;
        break;
      }
      case 'window': {
        const a = clockMin(t.from, day, ctx),
          b = clockMin(t.to, day, ctx);
        if (a === null || b === null) {
          unknown ??= { status: 'unknown', why: 'no sunrise/sunset' };
          break;
        }
        const open = b > a ? min >= a && min < b : min >= a;
        // 'MON-FRI 0600-1400Z', 'Summer: 0500-2100Z', 'SR-1200 (0452-1200Z)'
        const qual = [
          r.season ? fmtRule({ ...r, times: [] }).split(':')[0] + ':' : '',
          r.days && r.days.length < 7 ? fmtRule({ ...r, season: undefined, times: [] }).trim() : '',
          !r.days && r.holidays ? 'HOL' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const sun = !('utc' in t.from) || !('utc' in t.to);
        const label = `${qual ? qual + ' ' : ''}${sun ? `${fmtTime(t)} (${hhmm(a)}-${hhmm(b)}Z)` : `${hhmm(a)}-${hhmm(b)}Z`}`;
        if (open) return { status: 'open', why: label };
        closedWhy = label;
        break;
      }
    }
  }
  return unknown ?? { status: 'closed', why: closedWhy };
}

export interface HoursInterval {
  /** Epoch ms, [from, to). */
  from: number;
  to: number;
  status: HoursStatus;
  why: string;
}

/** The statuses over [fromMs, toMs) in runs of equal status and reason, evaluated minute by minute. */
export function intervals(at: (ms: number) => HoursAt, fromMs: number, toMs: number, stepMin = 1): HoursInterval[] {
  const out: HoursInterval[] = [];
  const step = stepMin * 60e3;
  for (let t = fromMs; t < toMs; t += step) {
    const v = at(t);
    const last = out[out.length - 1];
    if (last && last.status === v.status && last.why === v.why) last.to = Math.min(toMs, t + step);
    else out.push({ from: t, to: Math.min(toMs, t + step), status: v.status, why: v.why });
  }
  return out;
}

/** 'HH:MM' UTC of an instant ('24:00' for the end of a day). */
export function clockZ(ms: number, dayStart?: number): string {
  if (dayStart !== undefined && ms - dayStart >= DAY_MS) return '24:00';
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

// ---------------------------------------------------------------- the reference record

/** The AIP texts of one aerodrome as extracted (tools/extract_ad_hours.ts → tools/ad_hours.json). */
export interface AipHoursText {
  source: string;
  ad: string | null;
  customs: string | null;
  ats: string | null;
  handling: string | null;
  handlingSource: string;
  /** `handling` is the AD 1.6.N.4 section, not an hours item. */
  handlingFromSection: boolean;
  remarks: string | null;
}

const isNil = (s: string | null) => !s || normalizeAipText(s).toUpperCase() === 'NIL';

/** RefAerodrome.hours from the extracted AIP texts (verbatim) and their parse. */
export function adHoursFromAip(x: AipHoursText): RefAdHours {
  const remarks = isNil(x.remarks) ? '' : x.remarks!;
  const field = (text: string | null, ctx: HoursContext) =>
    text === null ? null : { text, parsed: parseHours(text, ctx, remarks) };
  const handlingText = x.handling ?? 'NIL';
  return {
    source: x.source,
    ad: { text: x.ad ?? 'NIL', parsed: parseHours(x.ad ?? 'NIL', 'ad', remarks) },
    ats: field(x.ats, 'ats'),
    handling: {
      text: handlingText,
      parsed: x.handlingFromSection
        ? parseHandlingSection(handlingText)
        : parseHours(handlingText, 'handling', remarks),
      source: x.handlingSource,
    },
    customs: field(x.customs, 'customs'),
    remarks,
  };
}
