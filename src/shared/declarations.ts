// The W&B and performance sheets e-mailed to the aircraft's operator before a flight, when the
// operator requires them (Operator.requiresWbPerf; src/shared/operators.ts).
//
// The sheets are computed in the browser (weather from Open-Meteo / METAR, the W&B and performance
// models of src/features/exports/wb and /performance), so the client sends what it shows, as
// WbPerfContent (text as printed, plus the chart geometry), and the server renders it to PDF with
// its own PDF writer (api/_lib/declarationPdf.ts: no headless browser, nothing to install on
// Vercel) and e-mails it to the operator, the pilot in cc.
//
//   GET  /api/flights/:id/declarations        → DeclarationsState
//   POST /api/flights/:id/declarations/send   { content: WbPerfContent, resend?: true } → DeclarationsState
//     409 when the operator does not ask for them, has no e-mail, or this version was already sent
//     (unless resend); 503 when e-mail is not configured.
//
// "Changed since sent": the server keeps the SHA-256 of wbPerfText(content) sent; the client hashes
// what it shows now the same way (both normalize with wbPerfContentOf first).

export type Verdict = 'pass' | 'fail' | 'incomplete';

export interface WbPerfRow {
  kind: 'line' | 'person' | 'total' | 'burn';
  label: string;
  note: string;
  mass: string;
  arm: string;
  moment: string;
  over: boolean;
}
export interface WbPerfCheck {
  label: string;
  ok: boolean;
  /** '1040.2 kg · CG 1.010 m · 1050.40 kg·m' */
  text: string;
  /** 'Normal: within · Utility: OUTSIDE' */
  categories: string;
}
export interface WbPerfChart {
  /** Moment (kg·m) vs mass (kg) outlines. */
  envelopes: { label: string; outline: [number, number][]; cgOutline: [number, number][] | null }[];
  points: { label: string; moment: number; mass: number; ok: boolean | null }[];
}
export interface PerfBlockContent {
  title: string;
  aerodrome: string;
  time: string;
  rows: { label: string; value: string; note: string; status: 'ok' | 'bad' | 'warn' | null }[];
  verdict: Verdict;
  verdictText: string;
  weather: string;
  metar: string;
}
export interface WbPerfContent {
  registration: string;
  makeModel: string;
  operator: string;
  date: string;
  pilot: string;
  route: string;
  category: string;
  wb: {
    verdict: Verdict;
    verdictText: string;
    rows: WbPerfRow[];
    totals: WbPerfRow[];
    checks: WbPerfCheck[];
    chart: WbPerfChart;
    limits: string[];
    weighing: string;
    note: string;
  };
  perf: {
    verdict: Verdict;
    verdictText: string;
    pages: { label: string; takeoff: PerfBlockContent; landing: PerfBlockContent; speeds: string }[];
    factors: { label: string; factor: string }[];
    slopeRule: string;
    notes: string[];
  };
}

export interface DeclarationsState {
  /** The flight's aircraft's operator (null: no aircraft, or no operator assigned). */
  operator: { id: string; name: string; requiresWbPerf: boolean; declarationsEmail: string } | null;
  /** The last sending: `hash` of the content sent (compare with wbPerfHash of what is shown). */
  submission: { sentAt: number; to: string; hash: string; messageId: string } | null;
  emailEnabled: boolean;
  emailReason: string | null;
}

// ------------------------------------------------------------------------------------------------
// Normalization: rebuilt from the known fields only, strings and lists tightly bounded, and free text
// kept to the sheet's data: no control characters, no links, no e-mail addresses (the server renders
// it into a PDF e-mailed to the operator; the client hashes the same normalized value).

const LINK = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi;
const EMAIL = /\S+@\S+/g;
/** A domain name with an optional path: 'evil.example/login', 'bit.ly'. Letters-only last label. */
const DOMAIN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/gi;
/** Text as printed on the sheets: links and e-mail addresses removed, whitespace collapsed. */
export function sheetText(v: unknown, max: number): string {
  const t = typeof v === 'string' ? v : v == null ? '' : String(v);
  return (
    t
      .slice(0, max * 2)
      // eslint-disable-next-line no-control-regex -- control characters are what this strips
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(LINK, '')
      .replace(EMAIL, '')
      .replace(DOMAIN, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  );
}
const S = (v: unknown, max = 200): string => sheetText(v, max);
const B = (v: unknown): boolean => v === true;
const N = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : 0);
function L<T>(v: unknown, max: number, f: (x: Obj) => T): T[] {
  return Array.isArray(v) ? v.slice(0, max).map((x) => f(O(x))) : [];
}
const LS = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v)
    ? v
        .slice(0, max)
        .map((x) => S(x, len))
        .filter(Boolean)
    : [];
type Obj = Record<string, unknown>;
const O = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
/** v when it is one of the options, else the fallback. */
const oneOf = <T extends string, F>(v: unknown, options: readonly T[], fallback: F): T | F =>
  options.find((o) => o === v) ?? fallback;
const V = (v: unknown): Verdict => (v === 'pass' || v === 'fail' ? v : 'incomplete');
const pair = (p: unknown): [number, number] => (Array.isArray(p) ? [N(p[0]), N(p[1])] : [0, 0]);

function row(r: Obj): WbPerfRow {
  const kind = oneOf(r.kind, ['line', 'person', 'total', 'burn'] as const, 'line' as const);
  return {
    kind,
    label: S(r.label, 60),
    note: S(r.note, 120),
    mass: S(r.mass, 12),
    arm: S(r.arm, 12),
    moment: S(r.moment, 14),
    over: B(r.over),
  };
}
function block(b: Obj): PerfBlockContent {
  return {
    title: S(b.title, 60),
    aerodrome: S(b.aerodrome, 80),
    time: S(b.time, 40),
    rows: L(b.rows, 30, (r) => ({
      label: S(r.label, 60),
      value: S(r.value, 80),
      note: S(r.note, 120),
      status: oneOf(r.status, ['ok', 'bad', 'warn'] as const, null),
    })),
    verdict: V(b.verdict),
    verdictText: S(b.verdictText, 120),
    weather: S(b.weather, 200),
    metar: S(b.metar, 400),
  };
}

/** The content as the server takes it. Throws on something that is not an object. */
export function wbPerfContentOf(input: unknown): WbPerfContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('content must be an object');
  const c = input as Obj;
  const wb = O(c.wb);
  const chart = O(wb.chart);
  const perf = O(c.perf);
  return {
    registration: S(c.registration, 12),
    makeModel: S(c.makeModel, 60),
    operator: S(c.operator, 80),
    date: S(c.date, 20),
    pilot: S(c.pilot, 80),
    route: S(c.route, 200),
    category: S(c.category, 30),
    wb: {
      verdict: V(wb.verdict),
      verdictText: S(wb.verdictText, 120),
      rows: L(wb.rows, 40, row),
      totals: L(wb.totals, 12, row),
      checks: L(wb.checks, 12, (x) => ({
        label: S(x.label, 60),
        ok: B(x.ok),
        text: S(x.text, 120),
        categories: S(x.categories, 120),
      })),
      chart: {
        envelopes: L(chart.envelopes, 4, (e) => ({
          label: S(e.label, 40),
          outline: Array.isArray(e.outline) ? e.outline.slice(0, 400).map(pair) : [],
          cgOutline: Array.isArray(e.cgOutline) ? e.cgOutline.slice(0, 400).map(pair) : null,
        })),
        points: L(chart.points, 12, (p) => ({
          label: S(p.label, 30),
          moment: N(p.moment),
          mass: N(p.mass),
          ok: p.ok === true ? true : p.ok === false ? false : null,
        })),
      },
      limits: LS(wb.limits, 12, 160),
      weighing: S(wb.weighing, 160),
      note: S(wb.note, 200),
    },
    perf: {
      verdict: V(perf.verdict),
      verdictText: S(perf.verdictText, 120),
      pages: L(perf.pages, 6, (p) => ({
        label: S(p.label, 60),
        takeoff: block(O(p.takeoff)),
        landing: block(O(p.landing)),
        speeds: S(p.speeds, 200),
      })),
      factors: L(perf.factors, 12, (f) => ({ label: S(f.label, 60), factor: S(f.factor, 20) })),
      slopeRule: S(perf.slopeRule, 200),
      notes: LS(perf.notes, 10, 200),
    },
  };
}

/** The text a sent version is identified by (hashed with SHA-256, base64url). */
export const wbPerfText = (c: WbPerfContent): string => JSON.stringify(c);
