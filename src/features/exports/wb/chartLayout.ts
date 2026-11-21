// Label placement for the CG envelope chart (MD 4.3): captions and value labels must not cover each other,
// the point markers or the fuel-burn line, whatever the loading. SVG pixel space (y down). Text widths are
// estimated (Arial: digits 0.556 em, capitals ~0.7 em).

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export type Segment = [number, number, number, number];

export const boxArea = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

export function overlapArea(a: Box, b: Box): number {
  return (
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  );
}

/** Length of a segment inside a box (Liang–Barsky clipping). */
export function segmentInBox(s: Segment, b: Box): number {
  const [x0, y0, x1, y1] = s;
  const dx = x1 - x0,
    dy = y1 - y0;
  let t0 = 0,
    t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, x0 - b.x0) || !clip(dx, b.x1 - x0) || !clip(-dy, y0 - b.y0) || !clip(dy, b.y1 - y0)) return 0;
  return Math.max(0, t1 - t0) * Math.hypot(dx, dy);
}

export function textWidth(text: string, fontPx: number, bold = false, letterSpacingEm = 0): number {
  let em = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) em += 0.556;
    else if (ch === ' ') em += 0.278;
    else if (/[.,·:]/.test(ch)) em += 0.3;
    else if (/[A-Z]/.test(ch)) em += 0.7;
    else em += 0.56;
    em += letterSpacingEm;
  }
  return em * fontPx * (bold ? 1.06 : 1);
}

export function spanAt(poly: [number, number][], y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi <= y && y <= yj) || (yj <= y && y <= yi)) {
      if (yi === yj) xs.push(xi, xj);
      else xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
    }
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}

interface Scene {
  bounds: Box;
  /** Hard obstacles: markers, already placed labels. */
  boxes: Box[];
  /** Lines a label should not sit on: the fuel-burn line. */
  segments: Segment[];
  /** Lines a label may cross at a small cost (envelope outlines: the text has a white halo). */
  softSegments: Segment[];
}

function cost(b: Box, scene: Scene): number {
  let c = 0;
  for (const o of scene.boxes) c += overlapArea(b, o) * 20;
  for (const s of scene.segments) c += segmentInBox(s, b) * 60;
  for (const s of scene.softSegments) c += segmentInBox(s, b) * 2;
  const inside = overlapArea(b, scene.bounds);
  c += (boxArea(b) - inside) * 40;
  return c;
}

export interface EnvelopeLabelInput {
  key: string;
  text: string;
  fontPx: number;
  letterSpacingEm: number;
  outline: [number, number][];
  /** Preferred height (px) for the caption's centre line: near the top for the main envelope. */
  preferY: number;
}

export interface PointLabelInput {
  key: string;
  x: number;
  y: number;
  /** Marker half-size, px. */
  r: number;
  lines: string[];
  fontPx: number;
}

export interface PlacedText {
  key: string;
  /** Text anchor x and the first line's baseline y. */
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  box: Box;
  lineHeight: number;
  /** A thin line from the marker to its label when the label had to move away from it. */
  leader?: Segment;
}

export interface ChartLabelLayout {
  envelopes: PlacedText[];
  points: PlacedText[];
}

const LINE = 1.2;

/**
 * Places the envelope captions (inside their envelope where they fit, else just outside its
 * forward edge) and then the point labels (eight directions around the marker, two distances).
 */
export function layoutChartLabels(o: {
  bounds: Box;
  envelopes: EnvelopeLabelInput[];
  points: PointLabelInput[];
  burn: Segment[];
}): ChartLabelLayout {
  const markers: Box[] = o.points.map((p) => ({
    x0: p.x - p.r - 3,
    y0: p.y - p.r - 3,
    x1: p.x + p.r + 3,
    y1: p.y + p.r + 3,
  }));
  const scene: Scene = { bounds: o.bounds, boxes: [...markers], segments: [...o.burn], softSegments: [] };
  for (const e of o.envelopes)
    for (let i = 0; i < e.outline.length; i++) {
      const [ax, ay] = e.outline[i];
      const [bx, by] = e.outline[(i + 1) % e.outline.length];
      scene.softSegments.push([ax, ay, bx, by]);
    }
  // Point labels must also stay off the point markers' surroundings, so the captions keep clear of
  // a margin around each point where its label will go.
  const pointHalo: Box[] = o.points.map((p) => ({ x0: p.x - 40, y0: p.y - 34, x1: p.x + 40, y1: p.y + 34 }));

  const envelopes: PlacedText[] = [];
  for (const e of o.envelopes) {
    const w = textWidth(e.text, e.fontPx, true, e.letterSpacingEm);
    const h = e.fontPx * 1.1;
    const ys = e.outline.map(([, y]) => y);
    const top = Math.min(...ys),
      bottom = Math.max(...ys);
    type Cand = { cx: number; cy: number; anchor: PlacedText['anchor']; pen: number };
    const cands: Cand[] = [];
    const step = Math.max(6, (bottom - top) / 24);
    for (let k = 0; k <= 24; k++) {
      for (const dir of [1, -1]) {
        if (k === 0 && dir < 0) continue;
        const cy = e.preferY + dir * k * step;
        if (cy - h / 2 < top + 2 || cy + h / 2 > bottom - 2) continue;
        const a = spanAt(e.outline, cy - h / 2);
        const b = spanAt(e.outline, cy + h / 2);
        if (!a || !b) continue;
        const lo = Math.max(a[0], b[0]) + 6,
          hi = Math.min(a[1], b[1]) - 6;
        if (hi - lo < w) continue;
        for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          const cx = lo + w / 2 + (hi - lo - w) * f;
          cands.push({ cx, cy, anchor: 'middle', pen: k * 4 + Math.abs(f - 0.5) * 20 });
        }
      }
    }
    // Outside the forward (left) edge, right-aligned to it: used when the envelope is too narrow.
    for (let k = 0; k <= 12; k++) {
      const cy = (top + bottom) / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step;
      const s = spanAt(e.outline, cy);
      if (!s) continue;
      cands.push({ cx: s[0] - 10 - w / 2, cy, anchor: 'end', pen: 500 + k * 4 });
    }
    let best: { b: Box; c: Cand; cost: number } | null = null;
    for (const c of cands) {
      const b: Box = { x0: c.cx - w / 2, y0: c.cy - h / 2, x1: c.cx + w / 2, y1: c.cy + h / 2 };
      // a caption sitting on an outline is hard to read: outlines count fully here
      let k = cost(b, scene) + c.pen;
      for (const sg of scene.softSegments) k += segmentInBox(sg, b) * 20;
      for (const p of pointHalo) k += overlapArea(b, p) * 4;
      if (!best || k < best.cost) best = { b, c, cost: k };
    }
    if (!best) continue;
    const { b, c } = best;
    envelopes.push({
      key: e.key,
      x: c.anchor === 'end' ? b.x1 : c.cx,
      y: c.cy + e.fontPx * 0.36,
      anchor: c.anchor,
      box: b,
      lineHeight: e.fontPx * LINE,
    });
    scene.boxes.push(b);
  }

  const points: PlacedText[] = [];
  // Take-off first (the figure that matters most), then landing, then zero fuel.
  const PRIORITY: Record<string, number> = { takeoff: 0, landing: 1, zerofuel: 2 };
  const ordered = [...o.points].sort((x, y) => (PRIORITY[x.key] ?? 9) - (PRIORITY[y.key] ?? 9));
  for (const p of ordered) {
    const w = Math.max(...p.lines.map((l) => textWidth(l, p.fontPx, true)));
    const lh = p.fontPx * LINE;
    const h = lh * (p.lines.length - 1) + p.fontPx * 1.05;
    let best: { b: Box; cost: number; dx: number } | null = null;
    // Eight directions around the marker (E, W, NE, NW, SE, SW, N, S), at growing distances; the
    // in-between heights (dy ±0.5) give more room next to a crowded fuel-burn line.
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [1, -1],
      [-1, -1],
      [1, 1],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -0.5],
      [-1, -0.5],
      [1, 0.5],
      [-1, 0.5],
    ];
    dirs.forEach(([dx, dy], i) => {
      for (const gap of [p.r + 8, p.r + 26, p.r + 48, p.r + 80, p.r + 120]) {
        const g = dx && dy ? gap * 0.75 : gap;
        const cx = p.x + dx * (g + w / 2);
        const cy = p.y + dy * (g + h / 2);
        const b: Box = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
        const k = cost(b, scene) + i * 3 + (gap - p.r) * 1.5;
        if (!best || k < best.cost) best = { b, cost: k, dx };
      }
    });
    const { b, dx } = (best as { b: Box; cost: number; dx: number } | null)!;
    const anchor: PlacedText['anchor'] = dx < 0 ? 'end' : dx > 0 ? 'start' : 'middle';
    const x = anchor === 'end' ? b.x1 : anchor === 'start' ? b.x0 : (b.x0 + b.x1) / 2;
    const nx = Math.min(Math.max(p.x, b.x0), b.x1);
    const ny = Math.min(Math.max(p.y, b.y0), b.y1);
    const far = Math.hypot(nx - p.x, ny - p.y) > p.r + 30;
    const leader: Segment | undefined = far ? [p.x, p.y, nx, ny] : undefined;
    points.push({ key: p.key, x, y: b.y0 + p.fontPx * 0.86, anchor, box: b, lineHeight: lh, leader });
    scene.boxes.push(b);
  }
  return { envelopes, points };
}
