// Text fitting for the MD 4.2 sheet (port of v2 fitInputs / fitCheckpoints / fitTerminalText):
// every filled cell gets the largest font that fits its box (readable in flight), then cells of
// one column or region share one size. Sizes are set in sheet units (calc(n * var(--u))), so a
// fit computed on screen holds when printing.

/** The sheet is this many units wide. */
export const SHEET_UNITS = 1145;

const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
function textWidth(text: string, cs: CSSStyleDeclaration, px: number): number {
  if (!ctx) return 0;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${px}px ${cs.fontFamily}`;
  return ctx.measureText(text).width;
}
const setU = (el: HTMLElement, u: number) => { el.style.fontSize = `calc(${u.toFixed(2)} * var(--u))`; };
const unitsOf = (el: HTMLElement) => Number(/calc\(([\d.]+)/.exec(el.style.fontSize)?.[1] ?? NaN);

/** Single-line cell: font from `cap` units (or 82% of the cell height) down until the text fits. */
function fitLine(el: HTMLElement, uPx: number) {
  const text = el.textContent ?? '';
  el.style.fontSize = '';
  if (!text.trim()) return;
  const cap = Number(el.dataset.fit) || 21;
  const cs = getComputedStyle(el);
  const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
  let size = Math.min(cap, (el.clientHeight / uPx) * 0.82);
  while (size > 3.5 && textWidth(text, cs, size * uPx) > room * 0.98) size *= 0.94;
  setU(el, size);
}

/**
 * Checkpoint names: largest size that fits between the arrows, on one line or two (at a space),
 * vertically centred. `oneLine` / `twoLines` = the share of the box height one line / two lines
 * may take. Returns the px size.
 */
function fitCheckpoint(el: HTMLElement, uPx: number, maxPx = Infinity, oneLine = 0.46, twoLines = 0.6): number {
  const text = (el.textContent ?? '').trim();
  el.style.fontSize = '';
  el.style.paddingTop = '';
  if (!text) return Infinity;
  const cs = getComputedStyle(el);
  const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
  const h = el.clientHeight;
  const words = text.split(/\s+/);
  let best = { px: 3, lines: 1 };
  for (let px = Math.min(17 * uPx, h * oneLine, maxPx); px > 3; px *= 0.97) {
    if (textWidth(text, cs, px) <= w) { best = { px, lines: 1 }; break; }
    if (words.length > 1 && 2 * px * 1.08 <= h * twoLines) {
      const ok = words.slice(1).some((_, k) =>
        Math.max(textWidth(words.slice(0, k + 1).join(' '), cs, px), textWidth(words.slice(k + 1).join(' '), cs, px)) <= w);
      if (ok) { best = { px, lines: 2 }; break; }
    }
  }
  setU(el, best.px / uPx);
  el.style.paddingTop = `calc(${(Math.max(0, (h - best.lines * best.px * 1.08) / 2) / uPx).toFixed(2)} * var(--u))`;
  return best.px;
}

/**
 * A box whose content (first child) may wrap or hold several lines: the largest size, up to
 * `cap` units, at which the content fits the box both ways. Measured 6 % narrower than the box,
 * so text that fits on one line on screen does not wrap with the printer's font metrics.
 */
function fitBox(el: HTMLElement, uPx: number, cap: number) {
  const inner = el.firstElementChild as HTMLElement | null;
  el.style.fontSize = '';
  if (!inner || !(el.textContent ?? '').trim()) return;
  const cs = getComputedStyle(el);
  const w = (el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * 0.94;
  const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  inner.style.maxWidth = `${w}px`;
  const fits = (u: number) => { setU(el, u); return inner.scrollWidth <= w + 0.5 && inner.offsetHeight <= h + 0.5; };
  let lo = 3, hi = Math.min(cap, h / uPx);
  if (!fits(hi)) {
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    setU(el, lo);
  }
  inner.style.maxWidth = '';
}

/**
 * Cells of one group share one size: the smallest any of them needs, except outliers (a cell that
 * needs less than 3/4 of the group's median keeps its own size instead of shrinking the others).
 */
function shareSize(els: HTMLElement[], outliers = true) {
  const sized = els.filter((el) => Number.isFinite(unitsOf(el)));
  if (!sized.length) return;
  const us = sized.map(unitsOf).sort((a, b) => a - b);
  const median = us[Math.floor(us.length / 2)];
  const target = Math.min(...us.filter((u) => !outliers || u >= 0.75 * median));
  for (const el of sized) setU(el, Math.min(unitsOf(el), target));
}

const groupBy = (els: HTMLElement[], key: (el: HTMLElement) => string | undefined) => {
  const m = new Map<string, HTMLElement[]>();
  for (const el of els) { const k = key(el); if (k !== undefined) m.set(k, [...(m.get(k) ?? []), el]); }
  return [...m.values()];
};

/** Fits every sheet under `root`. */
export function fitSheets(root: HTMLElement | null) {
  if (!root) return;
  root.querySelectorAll<HTMLElement>('.md42').forEach((sheet) => {
    const uPx = sheet.offsetWidth / SHEET_UNITS;
    if (!(uPx > 0)) return;
    const lines = [...sheet.querySelectorAll<HTMLElement>('[data-fit]')];
    lines.forEach((el) => fitLine(el, uPx));
    // Leg table: one size per column (no outliers: figures of a column line up).
    for (const els of groupBy(lines, (el) => {
      const cell = el.closest<HTMLElement>('.tbl > div');
      return cell ? cell.style.gridColumnStart || cell.style.gridColumn.split('/')[0].trim() : undefined;
    })) shareSize(els, false);
    // Header block: one size for every value.
    for (const els of groupBy(lines, (el) => el.dataset.fitGroup)) shareSize(els);

    // Checkpoint names between the legs and the origin (same box: tip to tip) at one size; the
    // arrival box under its label at that size or smaller.
    const cps = [...sheet.querySelectorAll<HTMLElement>('.cpn:not(.cpn-end)')];
    const px = Math.min(...cps.map((el) => fitCheckpoint(el, uPx)));
    if (Number.isFinite(px)) cps.forEach((el) => fitCheckpoint(el, uPx, px));
    sheet.querySelectorAll<HTMLElement>('.cpn-end').forEach((el) => fitCheckpoint(el, uPx, Number.isFinite(px) ? px : Infinity, 0.8, 0.95));

    // Terminal information: one size for the one-line cells (field, elevation, runways, a single
    // radio unit), one per number of radio units for the others, never larger than the one-line size.
    const ti = [...sheet.querySelectorAll<HTMLElement>('[data-fit-ti]')];
    const tiLines = new Map<HTMLElement, number>();
    ti.forEach((el) => {
      const n = Math.max(1, el.querySelectorAll('.fq-u').length);
      tiLines.set(el, n);
      fitBox(el, uPx, n > 1 ? 16 : Math.min(16, (el.clientHeight / uPx) * 0.72));
    });
    for (const els of groupBy(ti, (el) => String(tiLines.get(el) ?? 1))) shareSize(els);
    const oneLine = Math.max(...ti.filter((el) => tiLines.get(el) === 1).map(unitsOf).filter(Number.isFinite));
    if (Number.isFinite(oneLine)) for (const el of ti) if ((tiLines.get(el) ?? 1) > 1 && unitsOf(el) > oneLine) setU(el, oneLine);
  });
}
