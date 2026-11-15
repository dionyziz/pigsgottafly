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
// Normalization: rebuilt from the known fields only, strings and lists bounded (the server renders
// it; the client hashes the same normalized value).

const S = (v: unknown, max = 600): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const B = (v: unknown): boolean => v === true;
const N = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function L<T>(v: unknown, max: number, f: (x: any) => T): T[] {
  return Array.isArray(v) ? v.slice(0, max).map((x) => f(x && typeof x === 'object' ? x : {})) : [];
}
const LS = (v: unknown, max: number, len: number): string[] => (Array.isArray(v) ? v.slice(0, max).map((x) => S(x, len)) : []);
const O = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const V = (v: unknown): Verdict => (v === 'pass' || v === 'fail' ? v : 'incomplete');
const pair = (p: unknown): [number, number] => (Array.isArray(p) ? [N(p[0]), N(p[1])] : [0, 0]);

function row(r: Record<string, any>): WbPerfRow {
  const kind = ['line', 'person', 'total', 'burn'].includes(r.kind) ? r.kind : 'line';
  return { kind, label: S(r.label, 200), note: S(r.note, 300), mass: S(r.mass, 20), arm: S(r.arm, 20), moment: S(r.moment, 20), over: B(r.over) };
}
function block(b: Record<string, any>): PerfBlockContent {
  return {
    title: S(b.title, 100), aerodrome: S(b.aerodrome, 200), time: S(b.time, 60),
    rows: L(b.rows, 40, (r) => ({ label: S(r.label, 100), value: S(r.value, 200), note: S(r.note, 300), status: ['ok', 'bad', 'warn'].includes(r.status) ? r.status : null })),
    verdict: V(b.verdict), verdictText: S(b.verdictText, 200), weather: S(b.weather, 400), metar: S(b.metar, 600),
  };
}

/** The content as the server takes it. Throws on something that is not an object. */
export function wbPerfContentOf(input: unknown): WbPerfContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('content must be an object');
  const c = input as Record<string, any>;
  const wb = O(c.wb);
  const chart = O(wb.chart);
  const perf = O(c.perf);
  return {
    registration: S(c.registration, 20), makeModel: S(c.makeModel, 100), operator: S(c.operator, 200), date: S(c.date, 20),
    pilot: S(c.pilot, 200), route: S(c.route, 400), category: S(c.category, 40),
    wb: {
      verdict: V(wb.verdict), verdictText: S(wb.verdictText, 200),
      rows: L(wb.rows, 60, row), totals: L(wb.totals, 30, row),
      checks: L(wb.checks, 20, (x) => ({ label: S(x.label, 100), ok: B(x.ok), text: S(x.text, 200), categories: S(x.categories, 200) })),
      chart: {
        envelopes: L(chart.envelopes, 4, (e) => ({
          label: S(e.label, 100),
          outline: Array.isArray(e.outline) ? e.outline.slice(0, 400).map(pair) : [],
          cgOutline: Array.isArray(e.cgOutline) ? e.cgOutline.slice(0, 400).map(pair) : null,
        })),
        points: L(chart.points, 20, (p) => ({ label: S(p.label, 40), moment: N(p.moment), mass: N(p.mass), ok: p.ok === true ? true : p.ok === false ? false : null })),
      },
      limits: LS(wb.limits, 20, 400), weighing: S(wb.weighing, 400), note: S(wb.note, 600),
    },
    perf: {
      verdict: V(perf.verdict), verdictText: S(perf.verdictText, 200),
      pages: L(perf.pages, 10, (p) => ({ label: S(p.label, 100), takeoff: block(O(p.takeoff)), landing: block(O(p.landing)), speeds: S(p.speeds, 400) })),
      factors: L(perf.factors, 20, (f) => ({ label: S(f.label, 100), factor: S(f.factor, 40) })),
      slopeRule: S(perf.slopeRule, 300),
      notes: LS(perf.notes, 20, 600),
    },
  };
}

/** The text a sent version is identified by (hashed with SHA-256, base64url). */
export const wbPerfText = (c: WbPerfContent): string => JSON.stringify(c);
