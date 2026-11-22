// The MD 4.2 navigation log as printed: every cell of every sheet as text (built in the browser by
// src/features/exports/navlog/model.ts, drawn by NavlogSheet.tsx). The navlog export page can e-mail
// it to the signed-in pilot as the website's own print: it sends these sheets, the server prints them
// with the same sheet component in headless Chromium (api/_lib/sheetPdf.ts, the page src/pdf/) and
// mails the PDF to the pilot's own address only.
//
//   GET  /api/flights/:id/exports/navlog/email                     → NavlogMailState
//   POST /api/flights/:id/exports/navlog/email { content: NavlogContent } → NavlogMailState
//     the flight's owner or a pilot it is shared with; 403 without an e-mail address, 503 when e-mail
//     or printing is not available, 429 over the sending caps (api/_lib/sendCaps.ts), 502 when the
//     print or the mail fails.
import { sheetText } from './declarations.js';

/** Leg rows per sheet; longer routes continue on further sheets. */
export const LEGS_PER_SHEET = 9;

export interface SheetLeg {
  tc: string;
  alt: string;
  wd: string;
  ws: string;
  temp: string;
  tas: string;
  wca: string;
  th: string;
  var: string;
  mh: string;
  dev: string;
  ch: string;
  dist: string;
  rem: string;
  gs: string;
  ete: string;
  ate: string;
  fuel: string;
  /** Altitude unknown (shown highlighted on screen). */
  altMissing: boolean;
  /** No forecast and no typed wind: calm wind was used (wind cells highlighted on screen). */
  windMissing: boolean;
}

export interface SheetHeader {
  date: string;
  aircraft: string;
  blockStart: string;
  sky: string;
  temp: string;
  wind: string;
  qnh: string;
  runway: string;
  /** 'EST 30lt/h = 0.5lt/min' */
  est: string;
}

/** One radio unit of a terminal row: 'TWR' and its frequencies, primary first. */
export interface TerminalUnit {
  unit: string;
  freqs: string[];
}
export interface TerminalRow {
  field: string;
  elev: string;
  rwy: string;
  units: TerminalUnit[];
}

export interface NavlogSheet {
  /** 0-based. */
  index: number;
  count: number;
  header: SheetHeader;
  /** Top checkpoint box: 'DEPARTURE' on the first sheet, '' on continuation sheets. */
  topLabel: string;
  topName: string;
  /** LEGS_PER_SHEET rows; null = unused row. */
  legs: (SheetLeg | null)[];
  /** LEGS_PER_SHEET − 1 checkpoint names between the rows ('' = none). */
  checkpoints: string[];
  /** 'ARRIVAL' when the destination ends this sheet's last row. */
  bottomLabel: string;
  /** The checkpoint ending the sheet's last row ('' when that row is unused). */
  bottomName: string;
  terminal: TerminalRow[];
  totals: { dist: string; ete: string; fuel: string; sunset: string };
}

/** What the export page sends to be e-mailed: the sheets as drawn. */
export interface NavlogContent {
  sheets: NavlogSheet[];
}

export interface NavlogMailState {
  /** The signed-in pilot's address, where the navlog goes ('' when the account has none). */
  to: string;
  /** The last navlog of this flight e-mailed to this pilot. */
  sent: { sentAt: number; to: string } | null;
  emailEnabled: boolean;
  emailReason: string | null;
}

// ------------------------------------------------------------------------------------------------
// Normalization: rebuilt from the known fields only, every list and string bounded, the text kept to
// what a sheet prints (sheetText: no control characters, links or e-mail addresses).

/** A route of 2000 points fills 223 sheets; nobody flies that from one navlog. */
export const MAX_NAVLOG_SHEETS = 30;
type Obj = Record<string, unknown>;
const O = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const S = (v: unknown, max = 24): string => sheetText(v, max);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

const LEG_TEXT = [
  'tc',
  'alt',
  'wd',
  'ws',
  'temp',
  'tas',
  'wca',
  'th',
  'var',
  'mh',
  'dev',
  'ch',
  'dist',
  'rem',
  'gs',
  'ete',
  'ate',
  'fuel',
] as const;

function leg(v: unknown): SheetLeg | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const l = v as Obj;
  const out = { altMissing: l.altMissing === true, windMissing: l.windMissing === true } as SheetLeg;
  for (const k of LEG_TEXT) out[k] = S(l[k], 16);
  return out;
}

function terminalRow(v: unknown): TerminalRow {
  const t = O(v);
  return {
    field: S(t.field, 60),
    elev: S(t.elev, 16),
    rwy: S(t.rwy, 60),
    units: list(t.units, 8).map((u) => ({
      unit: S(O(u).unit, 40),
      freqs: list(O(u).freqs, 6).map((f) => S(f, 12)),
    })),
  };
}

function sheet(v: unknown, index: number, count: number): NavlogSheet {
  const s = O(v);
  const h = O(s.header);
  const legs = list(s.legs, LEGS_PER_SHEET).map(leg);
  const cps = list(s.checkpoints, LEGS_PER_SHEET - 1).map((c) => S(c, 60));
  const tot = O(s.totals);
  return {
    index,
    count,
    header: {
      date: S(h.date, 40),
      aircraft: S(h.aircraft, 40),
      blockStart: S(h.blockStart),
      sky: S(h.sky, 40),
      temp: S(h.temp),
      wind: S(h.wind),
      qnh: S(h.qnh),
      runway: S(h.runway),
      est: S(h.est, 60),
    },
    topLabel: S(s.topLabel),
    topName: S(s.topName, 60),
    legs: Array.from({ length: LEGS_PER_SHEET }, (_, i) => legs[i] ?? null),
    checkpoints: Array.from({ length: LEGS_PER_SHEET - 1 }, (_, i) => cps[i] ?? ''),
    bottomLabel: S(s.bottomLabel),
    bottomName: S(s.bottomName, 60),
    terminal: list(s.terminal, 24).map(terminalRow),
    totals: { dist: S(tot.dist), ete: S(tot.ete), fuel: S(tot.fuel), sunset: S(tot.sunset, 40) },
  };
}

/** The content as the server takes it (and the PDF page draws it). Throws on something that is not an object. */
export function navlogContentOf(input: unknown): NavlogContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('content must be an object');
  const sheets = list((input as Obj).sheets, MAX_NAVLOG_SHEETS);
  return { sheets: sheets.map((s, i) => sheet(s, i, sheets.length)) };
}
