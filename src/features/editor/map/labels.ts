// Leg label text and placement (VFR-chart style: "062°  24 NM" along the leg, altitude "3000").
// Pure functions, unit-tested.
import { fmtAltitude as fmtAlt, fmtHdg } from '../../../calc';
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
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI; // screen y grows downward → clockwise
  let side: 1 | -1 = 1;
  if (ang > 90) { ang -= 180; side = -1; }
  else if (ang <= -90) { ang += 180; side = -1; }
  const r = (ang * Math.PI) / 180;
  // Direction along the text (left → right) is (cos r, sin r); the normal "above" the text is
  // (sin r, −cos r) (rotate the direction 90° counter-clockwise on screen).
  const normal = len > 0 ? { x: Math.sin(r), y: -Math.cos(r) } : { x: 0, y: -1 };
  return { angleDeg: ang, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, normal, lengthPx: len, side };
}
