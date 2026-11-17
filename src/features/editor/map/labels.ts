// Leg label text and placement (VFR-chart style: "062°  24 NM" along the leg, altitude "3000").
// Pure functions, unit-tested.
import { fmtAltitude as fmtAlt, fmtHdg } from '../../../calc';
import { ARROW_AT } from './features';
import type { ScreenPoint } from './snap';

/** Magnetic course as on VFR charts: '062°', 0 → '360°'; '---°' when unknown. */
export function fmtCourse(mcDeg: number): string {
  return isFinite(mcDeg) ? `${fmtHdg(mcDeg)}°` : '---°';
}

/** Leg distance, NM: whole NM (as the navlog totals), one decimal under 10 NM. */
export function fmtDistance(nm: number): string {
  if (!isFinite(nm)) return '-- NM';
  if (nm < 9.95) return `${(Math.round(nm * 10) / 10).toFixed(1)} NM`;
  return `${Math.round(nm)} NM`;
}

/** Altitude label: the app-wide altitude format (calc fmtAltitude): '3000', 'FL065'; '---' if unknown. */
export function fmtAltitude(ft: number): string {
  return fmtAlt(ft);
}

/**
 * Parse what the pilot typed in the altitude box.
 *   ''                → null (remove the override: back to the default)
 *   '3500', '3500ft'  → 3500
 *   '35', 'A035'      → 3500 (hundreds of feet)
 *   'FL055'           → 5500
 * Anything else (or outside 0…20 000 ft) → NaN.
 */
export function parseAltitudeInput(s: string): number | null {
  const t = s.trim().toUpperCase().replace(/\s+/g, '');
  if (!t) return null;
  let m: RegExpMatchArray | null;
  let ft: number;
  if ((m = t.match(/^(?:FL|A)(\d{1,3})$/))) ft = +m[1] * 100;
  else if ((m = t.match(/^(\d{1,5})(?:FT|')?$/))) ft = +m[1] < 300 ? +m[1] * 100 : +m[1];
  else return NaN;
  if (!(ft >= 0 && ft <= 20000)) return NaN;
  return Math.round(ft);
}

export type LabelMode = 'full' | 'compact' | 'hidden';

/**
 * How a leg label is laid out along a leg of this many screen pixels. Every visible label carries the
 * magnetic course, the distance and the altitude (as on VFR charts):
 *   full     one row, "062° │ 24 NM │ 3000" (about 120 px wide)
 *   compact  two smaller rows, "062° 24 NM" over "3000" (about 64 px wide)
 *   hidden   the leg is too short on screen for any label (zoom in)
 */
export function labelMode(screenLenPx: number): LabelMode {
  if (screenLenPx >= 130) return 'full';
  if (screenLenPx >= 44) return 'compact';
  return 'hidden';
}

export interface LabelPlacement {
  /** Rotation of the label, degrees clockwise from screen horizontal, always in (−90, 90]. */
  angleDeg: number;
  /** Midpoint of the leg on screen. */
  mid: ScreenPoint;
  /** Unit normal pointing to the side the label sits on (the upper side of the line on screen). */
  normal: ScreenPoint;
  /** Screen length of the leg, px. */
  lengthPx: number;
  /**
   * The side the label goes, along `normal`: +1 (above) when the text reads in the direction of
   * travel, −1 (below) when it reads against it. The label thus always sits left of the track, and
   * the two legs of an out-and-back (A → B, B → A) get one label on each side instead of on top of
   * each other.
   */
  side: 1 | -1;
}

/**
 * Place a label along the screen segment a → b so the text reads left to right (never upside down);
 * `normal` points to the upper side of the line (for a vertical leg: the left side), `side` says
 * which of the two sides to use.
 */
export function placeLabel(a: ScreenPoint, b: ScreenPoint): LabelPlacement {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI; // screen y grows downward → clockwise
  let side: 1 | -1 = 1;
  if (ang > 90) {
    ang -= 180;
    side = -1;
  } else if (ang <= -90) {
    ang += 180;
    side = -1;
  }
  const r = (ang * Math.PI) / 180;
  // Direction along the text (left → right) is (cos r, sin r); the normal "above" the text is
  // (sin r, −cos r) (rotate the direction 90° counter-clockwise on screen).
  const normal = len > 0 ? { x: Math.sin(r), y: -Math.cos(r) } : { x: 0, y: -1 };
  return { angleDeg: ang, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, normal, lengthPx: len, side };
}

/** Where a leg's label sits along it: `t`, the fraction of the leg from its origin to the label's centre,
 *  and `room`, the fraction of the leg's length the label may take (for labelMode). */
export interface LegLabelSlot {
  t: number;
  room: number;
}

/**
 * Label slots of the legs of a route. A leg alone on its line has its label in the middle. Legs sharing a
 * line (A → B and B → A, or the same leg flown twice) spread out so each label is clear of the others:
 * when the line is flown both ways, each direction's labels sit in the half nearer that direction's
 * origin (the two directions' labels are also on opposite sides of the line, see placeLabel); several
 * legs in one direction share their stretch evenly, in route order from the origin.
 */
export function legLabelSlots(
  legs: { from: { lat: number; lon: number }; to: { lat: number; lon: number } }[],
): LegLabelSlot[] {
  const pos = (p: { lat: number; lon: number }) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const lines = new Map<string, { fwd: number[]; rev: number[] }>();
  legs.forEach((l, i) => {
    const a = pos(l.from),
      b = pos(l.to);
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    const g = lines.get(k) ?? { fwd: [], rev: [] };
    (a < b ? g.fwd : g.rev).push(i);
    lines.set(k, g);
  });
  const out: LegLabelSlot[] = legs.map(() => ({ t: 0.5, room: 1 }));
  for (const { fwd, rev } of lines.values()) {
    const range = fwd.length && rev.length ? 0.5 : 1;
    for (const dir of [fwd, rev]) {
      const n = dir.length;
      dir.forEach((i, j) => {
        out[i] = { t: (range * (j + 1)) / (n + 1), room: n === 1 ? range : range / (n + 1) };
      });
    }
  }
  return out;
}

/** Gap kept between a label and the end of its stretch of the leg (a route point, the insert handle), px. */
const LABEL_END_PX = 14;
/** Gap kept between a label and a direction arrow on the line, px. */
const LABEL_ARROW_PX = 10;

/**
 * Where along its leg (fraction from the origin) a label `widthPx` wide goes: the middle for a leg alone
 * on its line; for a leg sharing its line, as near its slot as it can within its stretch (slot.t ± room/2)
 * without covering the direction arrows on the line (features.ts ARROW_AT); the slot itself when no
 * stretch between the arrows is wide enough.
 */
export function labelAlong(slot: LegLabelSlot, lengthPx: number, widthPx: number): number {
  const L = lengthPx;
  if ((slot.t === 0.5 && slot.room === 1) || !(L > 0)) return slot.t;
  const lo = (slot.t - slot.room / 2) * L + LABEL_END_PX,
    hi = (slot.t + slot.room / 2) * L - LABEL_END_PX;
  const edges = [lo];
  for (const a of ARROW_AT.map((f) => f * L).filter((x) => x > lo && x < hi))
    edges.push(a - LABEL_ARROW_PX, a + LABEL_ARROW_PX);
  edges.push(hi);
  const want = slot.t * L,
    half = widthPx / 2;
  let best: number | null = null;
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const [a, b] = [edges[i], edges[i + 1]];
    if (b - a < widthPx) continue;
    const c = Math.min(Math.max(want, a + half), b - half);
    if (best === null || Math.abs(c - want) < Math.abs(best - want)) best = c;
  }
  return best === null ? slot.t : best / L;
}
