// Text fitting for the MD 4.2 sheet (port of v2 fitInputs / fitCheckpoints / fitTerminalText):
// every filled cell gets the largest font that fits its box (readable in flight). Sizes are set in
// sheet units (calc(n * var(--u))), so a fit computed on screen holds when printing.

/** The sheet is this many units wide. */
export const SHEET_UNITS = 1145;

const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
function textWidth(text: string, cs: CSSStyleDeclaration, px: number): number {
  if (!ctx) return 0;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${px}px ${cs.fontFamily}`;
  return ctx.measureText(text).width;
}
const setU = (el: HTMLElement, u: number) => { el.style.fontSize = `calc(${u.toFixed(2)} * var(--u))`; };

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

/** Checkpoint names: largest size that fits between the arrows, on one line or two (at a space). Returns the px size. */
function fitCheckpoint(el: HTMLElement, uPx: number, maxPx = Infinity): number {
  const text = (el.textContent ?? '').trim();
  el.style.fontSize = '';
  el.style.paddingTop = '';
  if (!text) return Infinity;
  const cs = getComputedStyle(el);
  const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
  const h = el.clientHeight;
  const words = text.split(/\s+/);
  let best = { px: 3, lines: 1 };
  for (let px = Math.min(17 * uPx, h * 0.46, maxPx); px > 3; px *= 0.95) {
    if (textWidth(text, cs, px) <= w) { best = { px, lines: 1 }; break; }
    if (words.length > 1 && 2 * px * 1.08 <= h * 0.6) {
      const ok = words.slice(1).some((_, k) =>
        Math.max(textWidth(words.slice(0, k + 1).join(' '), cs, px), textWidth(words.slice(k + 1).join(' '), cs, px)) <= w);
      if (ok) { best = { px, lines: 2 }; break; }
    }
  }
  setU(el, best.px / uPx);
  el.style.paddingTop = `calc(${(Math.max(0, (h - best.lines * best.px * 1.08) / 2) / uPx).toFixed(2)} * var(--u))`;
  return best.px;
}

/** Wrapping cell (terminal information): shrink from `cap` until the text fits the height. */
function fitWrap(el: HTMLElement) {
  if (!(el.textContent ?? '').trim()) { el.style.fontSize = ''; return; }
  let size = Number(el.dataset.fitWrap) || 12;
  setU(el, size);
  while (el.scrollHeight > el.clientHeight + 1 && size > 4.5) {
    size -= 0.5;
    setU(el, size);
  }
}

/** Fits every sheet under `root`. */
export function fitSheets(root: HTMLElement | null) {
  if (!root) return;
  root.querySelectorAll<HTMLElement>('.md42').forEach((sheet) => {
    const uPx = sheet.offsetWidth / SHEET_UNITS;
    if (!(uPx > 0)) return;
    const lines = [...sheet.querySelectorAll<HTMLElement>('[data-fit]')];
    lines.forEach((el) => fitLine(el, uPx));
    // One size per column of the leg table: the smallest any of its cells needed.
    const cols = new Map<string, HTMLElement[]>();
    for (const el of lines) {
      const cell = el.closest<HTMLElement>('.tbl > div');
      if (!cell || !el.style.fontSize) continue;
      const col = cell.style.gridColumnStart || cell.style.gridColumn.split('/')[0].trim();
      cols.set(col, [...(cols.get(col) ?? []), el]);
    }
    const unitsOf = (el: HTMLElement) => Number(/calc\(([\d.]+)/.exec(el.style.fontSize)?.[1] ?? NaN);
    for (const els of cols.values()) {
      const min = Math.min(...els.map(unitsOf).filter(Number.isFinite));
      if (Number.isFinite(min)) els.forEach((el) => setU(el, min));
    }
    // Checkpoint names (origin included) all at one size: the smallest that fits every one.
    const cps = [...sheet.querySelectorAll<HTMLElement>('.cpn')];
    const px = Math.min(...cps.map((el) => fitCheckpoint(el, uPx)));
    if (Number.isFinite(px)) cps.forEach((el) => fitCheckpoint(el, uPx, px));
    sheet.querySelectorAll<HTMLElement>('[data-fit-wrap]').forEach((el) => fitWrap(el));
  });
}
