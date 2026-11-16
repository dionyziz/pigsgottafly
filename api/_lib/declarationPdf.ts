// The W&B and performance sheets as the PDF e-mailed to the aircraft's operator
// (src/shared/declarations.ts): page 1 the loading sheet (table, totals, checks, the CG moment
// envelope chart with the points), then one performance page per sector (take-off and landing
// blocks), each signed by the PIC like the print sheets (src/features/exports/wb/WbExport.tsx,
// performance/PerformanceExport.tsx). Drawn with the forms' PDF writer (pdf.ts), from the content
// the browser computed; A4 portrait, mm from the top-left.
import type { PerfBlockContent, Verdict, WbPerfContent, WbPerfRow } from '../../src/shared/declarations.js';
import handTtf from './fonts/homemadeApple.js';
import { type PdfSignature, signature } from './formPdf.js';
import { type FontName, PdfDoc, type PdfPage, winAnsi } from './pdf.js';

const L = 15,
  R = 195,
  W = R - L;
const VERDICT: Record<Verdict, string> = { pass: 'PASS', fail: 'FAIL', incomplete: 'INCOMPLETE' };

/** Splits text into lines of at most `w` mm. */
function wrap(doc: PdfDoc, s: string, w: number, font: FontName, size: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${word}` : word;
    if (line && doc.widthMm(winAnsi(t), font, size) > w) {
      out.push(line);
      line = word;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function header(p: PdfPage, title: string, c: WbPerfContent, verdict: Verdict, verdictText: string, sub = ''): number {
  p.text(L, 18, title, { font: 'bold', size: 15 });
  if (sub) p.text(L + 72, 18, sub, { size: 9, maxW: 50 });
  if (verdict === 'fail') p.color(0.75, 0.1, 0.1);
  else if (verdict === 'pass') p.color(0.05, 0.45, 0.2);
  p.text(R, 15.5, VERDICT[verdict], { font: 'bold', size: 12, align: 'right' });
  p.text(R, 19.8, verdictText, { size: 8, align: 'right', maxW: 70 });
  p.color(0, 0, 0);
  const fields: [string, string, number][] = [
    ['Date', c.date, 30],
    ['Registration', c.registration, 30],
    ['Aircraft', c.makeModel, 55],
    ['Pilot', c.pilot, 55],
  ];
  let x = L;
  for (const [k, v, w] of fields) {
    p.text(x, 27, k.toUpperCase(), { size: 6.5 });
    p.text(x, 31.5, v, { font: 'bold', size: 9.5, maxW: w - 3 });
    x += w;
  }
  p.text(L, 37.5, 'OPERATOR', { size: 6.5 });
  p.text(L, 42, c.operator, { font: 'bold', size: 9.5, maxW: 60 });
  p.text(L + 62, 37.5, 'ROUTE', { size: 6.5 });
  p.text(L + 62, 42, c.route, { font: 'bold', size: 9.5, maxW: 85 });
  p.text(L + 150, 37.5, 'CATEGORY', { size: 6.5 });
  p.text(L + 150, 42, c.category, { font: 'bold', size: 9.5, maxW: 30 });
  p.line(L, 45, R, 45, 0.3);
  return 51;
}

function footer(p: PdfPage, c: WbPerfContent, sig: PdfSignature | null) {
  const y = 282;
  p.line(L, y - 9, R, y - 9, 0.2);
  p.text(L, y, `DATE ${c.date}`, { size: 8.5 });
  p.text(L + 35, y, `REGISTRATION ${c.registration}`, { size: 8.5 });
  p.text(L + 82, y, `PILOT ${c.pilot}`, { size: 8.5, maxW: 50 });
  p.text(L + 135, y, 'SIGN', { size: 8.5 });
  p.line(L + 144, y + 0.8, R, y + 0.8, 0.15);
  if (sig) signature(p, L + 145, y - 1.2, R - L - 146, sig);
}

function wbRow(p: PdfPage, y: number, r: WbPerfRow, cols: number[]): number {
  const person = r.kind === 'person';
  const font: FontName = r.kind === 'total' ? 'bold' : 'regular';
  if (r.over) p.color(0.75, 0.1, 0.1);
  p.text(L + (person ? 4 : 1), y, r.label, {
    font,
    size: person ? 8 : 8.8,
    maxW: cols[0] - (person ? 50 : 4) - (r.note ? 0 : 0),
  });
  if (r.note) p.text(L + cols[0] - 2, y, r.note, { size: 6.5, align: 'right', maxW: 58 });
  let x = L + cols[0];
  for (const [i, v] of [r.mass, r.arm, r.moment].entries()) {
    x += cols[i + 1];
    p.text(x - 1.5, y, v, { font, size: 8.8, align: 'right' });
  }
  p.color(0, 0, 0);
  return y + (person ? 4.4 : 5.2);
}

function chart(p: PdfPage, c: WbPerfContent['wb']['chart'], x0: number, y0: number, w: number, h: number) {
  const xs: number[] = [],
    ys: number[] = [];
  for (const e of c.envelopes)
    for (const [m, kg] of [...e.outline, ...(e.cgOutline ?? [])]) {
      xs.push(m);
      ys.push(kg);
    }
  for (const q of c.points)
    if (q.mass > 0) {
      xs.push(q.moment);
      ys.push(q.mass);
    }
  if (!xs.length) return;
  const step = (span: number) => [10, 20, 25, 50, 100, 200, 250, 500].find((s) => span / s <= 10) ?? 1000;
  const sx = step(Math.max(...xs) - Math.min(...xs) + 40),
    sy = step(Math.max(...ys) - Math.min(...ys) + 40);
  const minX = Math.floor((Math.min(...xs) - 20) / sx) * sx,
    maxX = Math.ceil((Math.max(...xs) + 20) / sx) * sx;
  const minY = Math.floor((Math.min(...ys) - 10) / sy) * sy,
    maxY = Math.ceil((Math.max(...ys) + 20) / sy) * sy;
  const X = (m: number) => x0 + ((m - minX) / (maxX - minX || 1)) * w;
  const Y = (kg: number) => y0 + h - ((kg - minY) / (maxY - minY || 1)) * h;
  p.color(0.8, 0.8, 0.8);
  for (let m = minX; m <= maxX + 1e-9; m += sx) p.line(X(m), y0, X(m), y0 + h, 0.1);
  for (let kg = minY; kg <= maxY + 1e-9; kg += sy) p.line(x0, Y(kg), x0 + w, Y(kg), 0.1);
  p.color(0, 0, 0);
  p.rect(x0, y0, w, h, 0.25);
  for (let m = minX; m <= maxX + 1e-9; m += sx) p.text(X(m), y0 + h + 3.6, String(m), { size: 6, align: 'center' });
  for (let kg = minY; kg <= maxY + 1e-9; kg += sy) p.text(x0 - 1.2, Y(kg) + 1, String(kg), { size: 6, align: 'right' });
  p.text(x0 + w / 2, y0 + h + 7.5, 'Moment (kg·m)', { size: 6.5, align: 'center' });
  p.text(x0 - 9, y0 + h / 2, 'Mass (kg)', { size: 6.5, align: 'center', rotate: 90 });
  const poly = (pts: [number, number][], width: number, dashed = false) => {
    for (let i = 0; i < pts.length; i++) {
      if (dashed && i % 2) continue;
      const [a, b] = pts[i],
        [c2, d] = pts[(i + 1) % pts.length];
      p.line(X(a), Y(b), X(c2), Y(d), width);
    }
  };
  c.envelopes.forEach((e, i) => {
    if (i) p.color(0.2, 0.35, 0.7);
    poly(e.outline, 0.45);
    if (e.cgOutline) {
      p.color(0.5, 0.5, 0.5);
      poly(e.cgOutline, 0.2, true);
    }
    p.color(0, 0, 0);
    const top = e.outline.reduce((best, q) => (q[1] > best[1] ? q : best), e.outline[0] ?? [0, 0]);
    p.text(X(top[0]), Y(top[1]) - 1.5, e.label, { size: 6.5, align: 'center' });
  });
  // the points, joined in flight order (the fuel burn line)
  const pts = c.points.filter((q) => q.mass > 0);
  for (let i = 1; i < pts.length; i++)
    p.line(X(pts[i - 1].moment), Y(pts[i - 1].mass), X(pts[i].moment), Y(pts[i].mass), 0.2);
  for (const q of pts) {
    if (q.ok === false) p.color(0.75, 0.1, 0.1);
    else if (q.ok) p.color(0.05, 0.45, 0.2);
    const x = X(q.moment),
      y = Y(q.mass);
    p.line(x - 1.4, y, x + 1.4, y, 0.5);
    p.line(x, y - 1.4, x, y + 1.4, 0.5);
    p.text(x + 2, y - 1, q.label, { font: 'bold', size: 6.5 });
    p.color(0, 0, 0);
  }
}

function wbPage(doc: PdfDoc, c: WbPerfContent, sig: PdfSignature | null) {
  const p = doc.page();
  let y = header(p, 'LOADING SHEET', c, c.wb.verdict, c.wb.verdictText);
  const cols = [120, 20, 20, 20];
  p.text(L + 1, y, `Loading ${c.registration}`, { font: 'bold', size: 8 });
  ['Weight (kg)', 'Arm (m)', 'Moment (kg·m)'].forEach((t, i) =>
    p.text(L + cols[0] + cols.slice(1, i + 2).reduce((a, b) => a + b, 0) - 1.5, y, t, {
      font: 'bold',
      size: 7,
      align: 'right',
    }),
  );
  p.line(L, y + 1.6, R, y + 1.6, 0.25);
  y += 6;
  for (const r of c.wb.rows) y = wbRow(p, y, r, cols);
  p.line(L, y - 3.2, R, y - 3.2, 0.25);
  y += 1;
  for (const r of c.wb.totals) y = wbRow(p, y, r, cols);
  if (c.wb.note)
    for (const line of wrap(doc, c.wb.note, W, 'regular', 6.5)) {
      p.text(L, y, line, { size: 6.5 });
      y += 3;
    }
  y += 2;
  // checks, side by side
  const n = Math.max(1, c.wb.checks.length);
  const cw = Math.min(60, W / n);
  c.wb.checks.forEach((k, i) => {
    const x = L + i * cw;
    p.rect(x, y, cw - 2, 14, 0.2);
    p.text(x + 1.5, y + 4, k.label, { font: 'bold', size: 7.5, maxW: cw / 2 });
    if (!k.ok) p.color(0.75, 0.1, 0.1);
    else p.color(0.05, 0.45, 0.2);
    p.text(x + cw - 3.5, y + 4, k.ok ? 'WITHIN LIMITS' : 'OUTSIDE LIMITS', { font: 'bold', size: 6.5, align: 'right' });
    p.color(0, 0, 0);
    p.text(x + 1.5, y + 8.2, k.text, { size: 7, maxW: cw - 5 });
    p.text(x + 1.5, y + 11.8, k.categories, { size: 6.5, maxW: cw - 5 });
  });
  y += 18;
  const chartBottom = 232;
  if (c.wb.chart.envelopes.length && chartBottom - y > 50) {
    p.text(105, y + 2, 'CENTRE OF GRAVITY MOMENT ENVELOPE', { font: 'bold', size: 7.5, align: 'center' });
    chart(p, c.wb.chart, L + 16, y + 5, W - 22, chartBottom - y - 14);
    y = chartBottom + 3;
  }
  for (const t of [
    ...(c.wb.limits.length ? [`Limits: ${c.wb.limits.join(' · ')}`] : []),
    ...(c.wb.weighing ? [`Empty mass: ${c.wb.weighing}`] : []),
  ]) {
    for (const line of wrap(doc, t, W, 'regular', 7)) {
      if (y < 268) p.text(L, y, line, { size: 7 });
      y += 3.4;
    }
  }
  footer(p, c, sig);
}

function perfBlock(doc: PdfDoc, p: PdfPage, b: PerfBlockContent, x: number, y0: number, w: number): number {
  p.rect(x, y0, w, 8, 0.25);
  p.text(x + 2, y0 + 5.5, b.title, { font: 'bold', size: 9.5, maxW: w / 2 });
  p.text(x + w - 2, y0 + 5.5, b.time, { font: 'bold', size: 9, align: 'right' });
  let y = y0 + 13;
  for (const r of b.rows) {
    if (r.status === 'bad') p.color(0.75, 0.1, 0.1);
    else if (r.status === 'warn') p.color(0.65, 0.4, 0);
    p.text(x + 1, y, r.label, { size: 7.2, maxW: 30 });
    p.text(x + 32, y, r.value, { font: 'bold', size: 7.6, maxW: r.note ? 24 : w - 33 });
    if (r.note) p.text(x + 57, y, r.note, { size: 6.2, maxW: w - 58 });
    p.color(0, 0, 0);
    y += 4.4;
  }
  y += 2;
  if (b.verdict === 'fail') p.color(0.75, 0.1, 0.1);
  else if (b.verdict === 'pass') p.color(0.05, 0.45, 0.2);
  p.text(x + 1, y, `${VERDICT[b.verdict]} ${b.verdictText}`, { font: 'bold', size: 8, maxW: w - 2 });
  p.color(0, 0, 0);
  y += 4.5;
  for (const t of [b.weather ? `Weather: ${b.weather}` : '', b.metar].filter(Boolean)) {
    for (const line of wrap(doc, t, w - 2, 'regular', 6.5)) {
      p.text(x + 1, y, line, { size: 6.5 });
      y += 3;
    }
  }
  return y;
}

function perfPages(doc: PdfDoc, c: WbPerfContent, sig: PdfSignature | null) {
  const pages = c.perf.pages;
  pages.forEach((pg, i) => {
    const p = doc.page();
    const y0 = header(
      p,
      'PERFORMANCE LOG',
      c,
      c.perf.verdict,
      c.perf.verdictText,
      pages.length > 1 ? `Sector ${i + 1} of ${pages.length}: ${pg.label}` : '',
    );
    const half = (W - 4) / 2;
    const y1 = perfBlock(doc, p, pg.takeoff, L, y0, half);
    const y2 = perfBlock(doc, p, pg.landing, L + half + 4, y0, half);
    let y = Math.max(y1, y2) + 5;
    if (c.perf.factors.length) {
      p.text(L, y, 'Condition', { font: 'bold', size: 7.5 });
      p.text(L + 70, y, 'Factor for take-off or landing', { font: 'bold', size: 7.5 });
      y += 4;
      for (const f of c.perf.factors) {
        p.text(L, y, f.label, { size: 7.5, maxW: 68 });
        p.text(L + 70, y, f.factor, { size: 7.5 });
        y += 3.8;
      }
      if (c.perf.slopeRule) {
        p.text(L, y, c.perf.slopeRule, { size: 7, maxW: W });
        y += 4;
      }
      y += 2;
    }
    for (const t of [pg.speeds, ...c.perf.notes].filter(Boolean)) {
      for (const line of wrap(doc, t, W, 'regular', 7)) {
        if (y < 268) p.text(L, y, line, { size: 7 });
        y += 3.4;
      }
    }
    footer(p, c, sig);
  });
}

/** The PDF; `sig` is the PIC's e-signature (signed when sent). */
export function wbPerfPdf(c: WbPerfContent, sig: PdfSignature | null): Buffer {
  const doc = new PdfDoc(Buffer.from(handTtf, 'base64'));
  wbPage(doc, c, sig);
  perfPages(doc, c, sig);
  return doc.bytes({ title: `W&B and performance ${c.registration} ${c.date}` });
}
