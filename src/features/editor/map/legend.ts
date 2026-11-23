// The legend sample beside each layer toggle, drawn with the map's own line styles (LINE_STYLES) and
// symbol drawings (symbols.ts), so it shows exactly what the layer draws.
import { CHART, LINE_STYLES, type LineStyleId } from './style';
import { drawSymbol } from './symbols';

/** A line, an area (its tint or hatching inside its outline) or a symbol image, named by `title`. */
export type LegendSample = ({ line: LineStyleId } | { area: LineStyleId } | { symbol: string }) & { title: string };

export const SAMPLE_HEIGHT = 20;

export function sampleWidth(s: LegendSample): number {
  return 'line' in s ? 28 : 20;
}

/** `line:tma`, `area:danger`, `symbol:pgf-vfr`. */
export function sampleId(s: LegendSample): string {
  return 'line' in s ? `line:${s.line}` : 'area' in s ? `area:${s.area}` : `symbol:${s.symbol}`;
}

/** Draws the sample on a context scaled to CSS pixels (`pr` device pixels each). */
export function drawLegendSample(g: CanvasRenderingContext2D, s: LegendSample, pr: number): void {
  const w = sampleWidth(s),
    h = SAMPLE_HEIGHT;
  if ('symbol' in s) {
    drawSymbol(g, s.symbol, (w - h) / 2, 0, h);
    return;
  }
  const st = LINE_STYLES['line' in s ? s.line : s.area];
  const lw = st.width;
  // MapLibre counts dashes in line widths
  const dash = 'dash' in st ? st.dash.map((d) => d * lw) : [];
  g.save();
  if ('line' in s) {
    const y = h / 2;
    const inset = 'casing' in st ? st.casing / 2 : 1;
    if ('casing' in st) {
      g.lineCap = 'round';
      g.strokeStyle = CHART.paper;
      g.lineWidth = st.casing;
      line(g, inset, y, w - inset, y);
    }
    // the route has round caps; the chart lines MapLibre's default butt caps
    g.lineCap = 'casing' in st ? 'round' : 'butt';
    g.setLineDash(dash);
    g.globalAlpha = st.opacity;
    g.strokeStyle = CHART[st.color];
    g.lineWidth = lw;
    line(g, inset, y, w - inset, y);
  } else {
    const x = 2 + lw / 2,
      y = 4 + lw / 2,
      rw = w - 4 - lw,
      rh = h - 8 - lw;
    g.fillStyle = CHART[st.color];
    if ('hatch' in st) {
      const pattern = hatch(g, st.hatch, pr);
      if (pattern) g.fillStyle = pattern;
    }
    if ('fill' in st) {
      g.globalAlpha = st.fill;
      g.fillRect(x, y, rw, rh);
    }
    g.setLineDash(dash);
    g.globalAlpha = st.opacity;
    g.strokeStyle = CHART[st.color];
    g.lineWidth = lw;
    g.strokeRect(x, y, rw, rh);
  }
  g.restore();
}

/** The fill-pattern symbol as a canvas pattern at CSS-pixel scale. */
function hatch(g: CanvasRenderingContext2D, name: string, pr: number): CanvasPattern | null {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 8 * pr;
  const tg = tile.getContext('2d');
  if (!tg) return null;
  tg.scale(pr, pr);
  drawSymbol(tg, name, 0, 0, 8);
  const pattern = g.createPattern(tile, 'repeat');
  // the context is already scaled by pr, and so would the pattern's device-pixel tile be
  pattern?.setTransform(new DOMMatrix().scale(1 / pr));
  return pattern;
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}
