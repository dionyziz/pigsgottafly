// The W&B and performance sheets e-mailed to the aircraft's operator before a flight, when the
// operator requires them (Operator.requiresWbPerf; src/shared/operators.ts).
//
// The sheets are computed in the browser (weather from Open-Meteo / METAR, the W&B and performance
// models of src/features/exports/wb and /performance). WbPerfContent is the sheets as drawn: every
// text as printed, plus the envelope chart and runway diagram geometry. The export page draws its
// sheets from it (src/features/exports/wb/WbExport.tsx, performance/PerformanceExport.tsx) and sends
// that same content; the server prints it with the same sheets, in headless Chromium
// (api/_lib/sheetPdf.ts, the page src/pdf/), to the PDF it e-mails to the operator, the pilot in cc
// (its own PDF writer, api/_lib/declarationPdf.ts, when that fails). The operator gets what the
// pilot saw.
//
//   GET  /api/flights/:id/declarations        → DeclarationsState
//   POST /api/flights/:id/declarations/send   { content: WbPerfContent, resend?: true } → DeclarationsState
//     409 when the operator does not ask for them, has no e-mail, or this version was already sent
//     (unless resend); 503 when e-mail is not configured.
//
// "Changed since sent": the server keeps the SHA-256 of wbPerfText(content) sent; the client hashes
// what it shows now the same way (both normalize with wbPerfContentOf first).

export type Verdict = 'pass' | 'fail' | 'incomplete';

/** Loading table rows: the sheet's lines (empty mass, unusable fuel, fuel, stations, totals, fuel
 *  used), each seat station followed by the people in it ('person'). */
export type WbRowKind = 'empty' | 'unusable' | 'fuel' | 'station' | 'person' | 'total' | 'burn';
export interface WbPerfRow {
  kind: WbRowKind;
  /** The sheet line's key ('' for a person). */
  key: string;
  label: string;
  note: string;
  mass: string;
  arm: string;
  moment: string;
  over: boolean;
  /** A person whose weight is missing (mass 'weight?'). */
  need: boolean;
}
export interface WbPerfCheck {
  phase: 'takeoff' | 'landing' | 'stop';
  label: string;
  ok: boolean;
  /** '1040.2 kg · CG 1.010 m · 1050.40 kg·m' */
  text: string;
  /** Normal (and Utility): inside or outside. */
  categories: { label: string; ok: boolean }[];
}
/** 'takeoff', 'landing', 'zerofuel', or 'stop0', 'stop1'… (intermediate full stops, in flight order). */
export type WbChartKey = 'takeoff' | 'landing' | 'zerofuel' | `stop${number}`;
export interface WbPerfChart {
  /** Moment (kg·m) vs mass (kg) outlines. */
  envelopes: {
    category: 'normal' | 'utility';
    label: string;
    outline: [number, number][];
    cgOutline: [number, number][] | null;
  }[];
  /** In the sheet's drawing order: zero fuel, landing, the stops, take-off. */
  points: { key: WbChartKey; label: string; moment: number; mass: number; ok: boolean | null }[];
}
/** The runway/wind diagram: the runway pointing up, the wind from its bearing (degrees magnetic). */
export interface PerfDiagram {
  runway: string;
  reciprocal: string;
  runwayHdgMag: number;
  windFromMag: number | null;
  headwindKt: number;
  crosswindKt: number;
  crossFrom: 'L' | 'R' | '';
}
export interface PerfBlockContent {
  phase: 'takeoff' | 'landing';
  title: string;
  aerodrome: string;
  time: string;
  rows: { key: string; label: string; value: string; note: string; status: 'ok' | 'bad' | 'warn' | null }[];
  verdict: Verdict;
  verdictText: string;
  weather: string;
  metar: string;
  diagram: PerfDiagram | null;
}
export interface PerfPageContent {
  /** 'LGTT → LGSY'; '' for a flight without stops. */
  label: string;
  takeoff: PerfBlockContent;
  landing: PerfBlockContent;
  /** Stall IAS in kt (power off, wings level, MTOW). */
  stall: { vsKt: number | null; vsoKt: number | null };
  /** Where Vx, Vy and the glide speed come from ('' when not printed). */
  speedsSource: string;
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
    pages: PerfPageContent[];
    factors: { label: string; factor: string }[];
    slopeRule: string;
    crosswind: { takeoff: number | null; landing: number | null };
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
// it into a PDF e-mailed to the operator; the client hashes and shows the same normalized value).

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
/** A number, or null when it is not one. */
const NN = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? N(v) : null);
/** A key as the sheets use them (data attributes): letters, digits and _ . : - only. */
const K = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(v) ? v : '');
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
const outline = (v: unknown): [number, number][] => (Array.isArray(v) ? v.slice(0, 400).map(pair) : []);
const ROW_KINDS = ['empty', 'unusable', 'fuel', 'station', 'person', 'total', 'burn'] as const;

function row(r: Obj): WbPerfRow {
  return {
    kind: oneOf(r.kind, ROW_KINDS, 'station' as const),
    key: K(r.key),
    label: S(r.label, 80),
    note: S(r.note, 160),
    mass: S(r.mass, 12),
    arm: S(r.arm, 12),
    moment: S(r.moment, 14),
    over: B(r.over),
    need: B(r.need),
  };
}
function chartKey(v: unknown): WbChartKey {
  if (v === 'takeoff' || v === 'landing' || v === 'zerofuel') return v;
  return typeof v === 'string' && /^stop\d{1,2}$/.test(v) ? (v as `stop${number}`) : 'stop0';
}
function diagram(v: unknown): PerfDiagram | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const d = v as Obj;
  return {
    runway: S(d.runway, 8),
    reciprocal: S(d.reciprocal, 8),
    runwayHdgMag: N(d.runwayHdgMag),
    windFromMag: NN(d.windFromMag),
    headwindKt: N(d.headwindKt),
    crosswindKt: N(d.crosswindKt),
    crossFrom: oneOf(d.crossFrom, ['L', 'R'] as const, '' as const),
  };
}
function block(b: Obj): PerfBlockContent {
  return {
    phase: b.phase === 'landing' ? 'landing' : 'takeoff',
    title: S(b.title, 60),
    aerodrome: S(b.aerodrome, 80),
    time: S(b.time, 40),
    rows: L(b.rows, 30, (r) => ({
      key: K(r.key),
      label: S(r.label, 60),
      value: S(r.value, 120),
      note: S(r.note, 160),
      status: oneOf(r.status, ['ok', 'bad', 'warn'] as const, null),
    })),
    verdict: V(b.verdict),
    verdictText: S(b.verdictText, 160),
    weather: S(b.weather, 240),
    metar: S(b.metar, 600),
    diagram: diagram(b.diagram),
  };
}

/** The content as the server takes it. Throws on something that is not an object. */
export function wbPerfContentOf(input: unknown): WbPerfContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('content must be an object');
  const c = input as Obj;
  const wb = O(c.wb);
  const chart = O(wb.chart);
  const perf = O(c.perf);
  const xw = O(perf.crosswind);
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
      verdictText: S(wb.verdictText, 160),
      rows: L(wb.rows, 40, row),
      totals: L(wb.totals, 16, row),
      checks: L(wb.checks, 12, (x) => ({
        phase: oneOf(x.phase, ['takeoff', 'landing', 'stop'] as const, 'stop' as const),
        label: S(x.label, 60),
        ok: B(x.ok),
        text: S(x.text, 120),
        categories: L(x.categories, 2, (k) => ({ label: S(k.label, 20), ok: B(k.ok) })),
      })),
      chart: {
        envelopes: L(chart.envelopes, 4, (e) => ({
          category: e.category === 'utility' ? ('utility' as const) : ('normal' as const),
          label: S(e.label, 40),
          outline: outline(e.outline),
          cgOutline: Array.isArray(e.cgOutline) ? outline(e.cgOutline) : null,
        })),
        points: L(chart.points, 12, (p) => ({
          key: chartKey(p.key),
          label: S(p.label, 30),
          moment: N(p.moment),
          mass: N(p.mass),
          ok: p.ok === true ? true : p.ok === false ? false : null,
        })),
      },
      limits: LS(wb.limits, 12, 200),
      weighing: S(wb.weighing, 200),
      note: S(wb.note, 400),
    },
    perf: {
      verdict: V(perf.verdict),
      verdictText: S(perf.verdictText, 160),
      pages: L(perf.pages, 10, (p) => {
        const st = O(p.stall);
        return {
          label: S(p.label, 60),
          takeoff: block(O(p.takeoff)),
          landing: block(O(p.landing)),
          stall: { vsKt: NN(st.vsKt), vsoKt: NN(st.vsoKt) },
          speedsSource: S(p.speedsSource, 120),
        };
      }),
      factors: L(perf.factors, 12, (f) => ({ label: S(f.label, 80), factor: S(f.factor, 20) })),
      slopeRule: S(perf.slopeRule, 240),
      crosswind: { takeoff: NN(xw.takeoff), landing: NN(xw.landing) },
      notes: LS(perf.notes, 10, 300),
    },
  };
}

/** The text a sent version is identified by (hashed with SHA-256, base64url). */
export const wbPerfText = (c: WbPerfContent): string => JSON.stringify(c);
