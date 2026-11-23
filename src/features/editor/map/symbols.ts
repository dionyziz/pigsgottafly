// Chart symbols drawn on a canvas and registered as map images (crisp at any pixel ratio, no
// sprite files to host). Shapes follow the ICAO VFR chart conventions loosely: aerodrome = ring with
// the runway bar, reporting point = triangle (solid charted, hollow open-flightmaps), my waypoint =
// four-point star. Radio navaids use the ICAO Annex 4 symbols: VOR hexagon with a centre dot, DME square,
// VOR/DME the hexagon in a rectangle, VORTAC the hexagon with three filled lobes (TACAN: outlined lobes),
// NDB and locator a centre dot in rings of dots.
import type { Map as MlMap } from 'maplibre-gl';

import { CHART } from './style';

const PR = 2; // drawn at 2× and registered with pixelRatio 2

function make(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): ImageData | null {
  const c = document.createElement('canvas');
  c.width = c.height = size * PR;
  const g = c.getContext('2d');
  if (!g) return null;
  g.scale(PR, PR);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g, size);
  return g.getImageData(0, 0, c.width, c.height);
}

function ring(g: CanvasRenderingContext2D, s: number, r: number, width: number, color: string) {
  g.beginPath();
  g.arc(s / 2, s / 2, r, 0, Math.PI * 2);
  g.fillStyle = CHART.halo;
  g.fill();
  g.lineWidth = width;
  g.strokeStyle = color;
  g.stroke();
}

function runwayBar(g: CanvasRenderingContext2D, s: number, len: number, width: number, color: string) {
  // vertical bar (north–south); the layer rotates the icon to the runway heading
  g.fillStyle = CHART.paper;
  g.fillRect(s / 2 - width / 2 - 1.2, s / 2 - len / 2 - 1.2, width + 2.4, len + 2.4);
  g.fillStyle = color;
  g.fillRect(s / 2 - width / 2, s / 2 - len / 2, width, len);
}

function triangle(g: CanvasRenderingContext2D, s: number, r: number) {
  const cx = s / 2,
    cy = s / 2 + r * 0.18;
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    const x = cx + r * Math.cos(a),
      y = cy + r * Math.sin(a);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

/** Flat-topped hexagon of circumradius r around (cx, cy). */
function hexagon(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = cx + r * Math.cos(a),
      y = cy + r * Math.sin(a);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
}

function vor(g: CanvasRenderingContext2D, s: number, r: number) {
  const c = s / 2;
  hexagon(g, c, c, r);
  g.fillStyle = CHART.halo;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = CHART.navaid;
  g.stroke();
  dot(g, c, c, 1.5, CHART.navaid);
}

/** The three lobes of a VORTAC / TACAN on the top, lower-left and lower-right sides of the hexagon. */
function lobes(g: CanvasRenderingContext2D, s: number, r: number, filled: boolean) {
  const c = s / 2,
    apo = (r * Math.sqrt(3)) / 2,
    half = r / 2,
    depth = r * 0.62;
  for (const deg of [-90, 30, 150]) {
    g.save();
    g.translate(c, c);
    g.rotate(((deg + 90) * Math.PI) / 180);
    g.beginPath();
    g.rect(-half, -apo - depth, 2 * half, depth);
    if (filled) {
      g.fillStyle = CHART.navaid;
      g.fill();
    } else {
      g.fillStyle = CHART.halo;
      g.fill();
      g.lineWidth = 1.3;
      g.strokeStyle = CHART.navaid;
      g.stroke();
    }
    g.restore();
  }
}

function ndb(g: CanvasRenderingContext2D, s: number, rings: number[]) {
  const c = s / 2;
  g.beginPath();
  g.arc(c, c, rings[rings.length - 1] + 1.6, 0, Math.PI * 2);
  g.fillStyle = CHART.halo;
  g.fill();
  dot(g, c, c, 1.8, CHART.navaid);
  for (const r of rings) {
    const n = Math.round((2 * Math.PI * r) / 2.6);
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n;
      dot(g, c + r * Math.cos(a), c + r * Math.sin(a), 0.75, CHART.navaid);
    }
  }
}

/** Each symbol's size (points) and drawing, on a context whose origin is the symbol's top-left corner. */
const DRAW: Record<string, [number, (g: CanvasRenderingContext2D, s: number) => void]> = {
  'pgf-ad-major': [
    30,
    (g, s) => {
      ring(g, s, 8, 2.2, CHART.aerodrome);
      runwayBar(g, s, 24, 3.6, CHART.aerodrome);
    },
  ],
  'pgf-ad-minor': [
    26,
    (g, s) => {
      ring(g, s, 6.5, 1.8, CHART.aerodrome);
      runwayBar(g, s, 19, 2.8, CHART.aerodrome);
    },
  ],
  'pgf-ad-plain': [
    22,
    (g, s) => {
      ring(g, s, 6, 1.8, CHART.aerodrome);
      g.beginPath();
      g.arc(s / 2, s / 2, 2.2, 0, Math.PI * 2);
      g.fillStyle = CHART.aerodrome;
      g.fill();
    },
  ],
  'pgf-ad-water': [
    24,
    (g, s) => {
      ring(g, s, 7, 1.8, CHART.aerodrome);
      g.strokeStyle = CHART.aerodrome;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let x = -4.5; x <= 4.5; x += 0.5) {
        const y = Math.sin((x / 4.5) * Math.PI * 1.5) * 1.6;
        if (x === -4.5) g.moveTo(s / 2 + x, s / 2 + y);
        else g.lineTo(s / 2 + x, s / 2 + y);
      }
      g.stroke();
    },
  ],
  'pgf-vfr': [
    18,
    (g, s) => {
      triangle(g, s, 6.4);
      g.fillStyle = CHART.vfr;
      g.fill();
      g.lineWidth = 1.4;
      g.strokeStyle = CHART.paper;
      g.stroke();
    },
  ],
  'pgf-vfr-ofm': [
    18,
    (g, s) => {
      triangle(g, s, 5.6);
      g.fillStyle = CHART.halo;
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = CHART.vfr;
      g.stroke();
    },
  ],
  'pgf-wpt': [
    20,
    (g, s) => {
      const c = s / 2,
        r = 7,
        k = 2.2;
      g.beginPath();
      g.moveTo(c, c - r);
      g.lineTo(c + k, c - k);
      g.lineTo(c + r, c);
      g.lineTo(c + k, c + k);
      g.lineTo(c, c + r);
      g.lineTo(c - k, c + k);
      g.lineTo(c - r, c);
      g.lineTo(c - k, c - k);
      g.closePath();
      g.fillStyle = CHART.waypoint;
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = CHART.paper;
      g.stroke();
    },
  ],
  'pgf-nav-vor': [20, (g, s) => vor(g, s, 6.5)],
  'pgf-nav-vordme': [
    24,
    (g, s) => {
      const c = s / 2,
        w = 9.2,
        h = 7.6;
      g.fillStyle = CHART.halo;
      g.fillRect(c - w - 1, c - h - 1, 2 * w + 2, 2 * h + 2);
      g.lineWidth = 1.5;
      g.strokeStyle = CHART.navaid;
      g.strokeRect(c - w, c - h, 2 * w, 2 * h);
      vor(g, s, 6.5);
    },
  ],
  'pgf-nav-vortac': [
    28,
    (g, s) => {
      lobes(g, s, 6.5, true);
      vor(g, s, 6.5);
    },
  ],
  'pgf-nav-tacan': [
    28,
    (g, s) => {
      lobes(g, s, 6.5, false);
      vor(g, s, 6.5);
    },
  ],
  'pgf-nav-dme': [
    18,
    (g, s) => {
      const c = s / 2,
        h = 6;
      g.fillStyle = CHART.halo;
      g.fillRect(c - h - 1, c - h - 1, 2 * h + 2, 2 * h + 2);
      g.lineWidth = 1.5;
      g.strokeStyle = CHART.navaid;
      g.strokeRect(c - h, c - h, 2 * h, 2 * h);
      dot(g, c, c, 1.5, CHART.navaid);
    },
  ],
  'pgf-nav-ndb': [26, (g, s) => ndb(g, s, [4.2, 7, 9.8])],
  'pgf-nav-l': [20, (g, s) => ndb(g, s, [3.8, 6.6])],
  // one-way arrow along a VFR route (points along the line direction = image +x)
  'pgf-arrow': [
    14,
    (g, s) => {
      g.beginPath();
      g.moveTo(s / 2 - 3, s / 2 - 4);
      g.lineTo(s / 2 + 3, s / 2);
      g.lineTo(s / 2 - 3, s / 2 + 4);
      g.lineWidth = 2;
      g.strokeStyle = CHART.vfr;
      g.stroke();
    },
  ],
  // direction of flight on a route leg (points north; the layer rotates it to the leg): an arrowhead
  // a little wider than the route line, with a white edge
  'pgf-route-arrow': [
    22,
    (g, s) => {
      const c = s / 2;
      g.beginPath();
      g.moveTo(c, c - 7);
      g.lineTo(c + 6.5, c + 5.5);
      g.lineTo(c, c + 2.5);
      g.lineTo(c - 6.5, c + 5.5);
      g.closePath();
      g.lineWidth = 3;
      g.strokeStyle = CHART.paper;
      g.stroke();
      g.fillStyle = CHART.route;
      g.fill();
    },
  ],
  // restricted-area hatching (a fill-pattern tile: diagonal lines that join across tiles)
  'pgf-hatch-r': [
    8,
    (g, s) => {
      g.strokeStyle = CHART.restricted;
      g.globalAlpha = 0.45;
      g.lineWidth = 1;
      g.lineCap = 'butt';
      g.beginPath();
      for (const o of [-s, 0, s]) {
        g.moveTo(o, s);
        g.lineTo(o + s, 0);
      }
      g.stroke();
    },
  ],
};

export const SYMBOLS: Record<string, () => ImageData | null> = Object.fromEntries(
  Object.entries(DRAW).map(([name, [size, draw]]) => [name, () => make(size, draw)]),
);

/** Draws a symbol centred in a box×box square at (x, y), shrunk to fit: the map's own drawing, for
 *  the legend. */
export function drawSymbol(g: CanvasRenderingContext2D, name: string, x: number, y: number, box: number): void {
  const d = DRAW[name];
  if (!d) return;
  const [size, draw] = d;
  const k = Math.min(1, box / size);
  g.save();
  g.translate(x + (box - size * k) / 2, y + (box - size * k) / 2);
  g.scale(k, k);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g, size);
  g.restore();
}

/**
 * What each symbol of SYMBOLS looks like, for apps that draw them natively (the iPhone app: the
 * native core's PGF.symbolNames()): its size in points (drawn at pixelRatio 2), the chart colours it
 * uses (CHART keys) and a description of the drawing above.
 */
export const SYMBOL_INFO: Record<
  string,
  { size: number; colors: (keyof typeof CHART)[]; rotates?: boolean; pattern?: boolean; description: string }
> = {
  'pgf-ad-major': {
    size: 30,
    colors: ['aerodrome', 'halo', 'paper'],
    rotates: true,
    description:
      'Aerodrome with a hard runway: a ring (radius 8, stroke 2.2, halo filled) and a runway bar north-south (24 × 3.6, a 1.2 white edge) through it; the layer rotates it to the runway heading.',
  },
  'pgf-ad-minor': {
    size: 26,
    colors: ['aerodrome', 'halo', 'paper'],
    rotates: true,
    description:
      'Smaller aerodrome: ring (radius 6.5, stroke 1.8) and runway bar (19 × 2.8, white edge 1.2), rotated to the runway.',
  },
  'pgf-ad-plain': {
    size: 22,
    colors: ['aerodrome', 'halo'],
    description:
      'Aerodrome without a known runway: ring (radius 6, stroke 1.8, halo filled) with a filled centre dot (radius 2.2).',
  },
  'pgf-ad-water': {
    size: 24,
    colors: ['aerodrome', 'halo'],
    description:
      'Water aerodrome: ring (radius 7, stroke 1.8, halo filled) with a wave across it (1.5 sine periods, amplitude 1.6, stroke 1.6).',
  },
  'pgf-vfr': {
    size: 18,
    colors: ['vfr', 'paper'],
    description:
      'Charted VFR reporting point: a solid triangle pointing up (circumradius 6.4) with a white 1.4 outline.',
  },
  'pgf-vfr-ofm': {
    size: 18,
    colors: ['vfr', 'halo'],
    description:
      'Other (openflightmaps) reporting point: a hollow triangle (circumradius 5.6), halo filled, 1.6 outline.',
  },
  'pgf-wpt': {
    size: 20,
    colors: ['waypoint', 'paper'],
    description: "The pilot's saved waypoint: a filled four-point star (radius 7, waist 2.2) with a white 1.2 outline.",
  },
  'pgf-nav-vor': {
    size: 20,
    colors: ['navaid', 'halo'],
    description: 'VOR: flat-topped hexagon (circumradius 6.5, halo filled, stroke 1.5) with a centre dot (radius 1.5).',
  },
  'pgf-nav-vordme': {
    size: 24,
    colors: ['navaid', 'halo'],
    description: 'VOR/DME: the VOR hexagon inside a rectangle (18.4 × 15.2, halo filled, stroke 1.5).',
  },
  'pgf-nav-vortac': {
    size: 28,
    colors: ['navaid', 'halo'],
    description:
      'VORTAC: the VOR hexagon with three filled rectangular lobes on its top, lower-left and lower-right sides.',
  },
  'pgf-nav-tacan': {
    size: 28,
    colors: ['navaid', 'halo'],
    description: 'TACAN: the VORTAC shape with outlined (halo filled) lobes.',
  },
  'pgf-nav-dme': {
    size: 18,
    colors: ['navaid', 'halo'],
    description: 'DME: a square (12 × 12, halo filled, stroke 1.5) with a centre dot.',
  },
  'pgf-nav-ndb': {
    size: 26,
    colors: ['navaid', 'halo'],
    description:
      'NDB: a centre dot (radius 1.8) in three rings of small dots (radii 4.2, 7, 9.8; dots of radius 0.75 every 2.6) on a halo disc.',
  },
  'pgf-nav-l': {
    size: 20,
    colors: ['navaid', 'halo'],
    description: 'Locator: the NDB symbol with two rings of dots (radii 3.8, 6.6).',
  },
  'pgf-arrow': {
    size: 14,
    colors: ['vfr'],
    rotates: true,
    description: 'One-way arrow along a VFR route: an open chevron pointing along +x (6 wide, 8 tall, stroke 2).',
  },
  'pgf-route-arrow': {
    size: 22,
    colors: ['route', 'paper'],
    rotates: true,
    description:
      'Direction of flight on a route leg: a filled arrowhead pointing north (13 wide, 12.5 tall, notched base) with a white 3 edge; rotated to the leg.',
  },
  'pgf-hatch-r': {
    size: 8,
    colors: ['restricted'],
    pattern: true,
    description:
      'Restricted-area fill pattern: diagonal lines (bottom-left to top-right, stroke 1, 45% opacity) that join across tiles.',
  },
};

/** Idempotent. */
export function addSymbols(map: MlMap): void {
  for (const [name, draw] of Object.entries(SYMBOLS)) {
    if (map.hasImage(name)) continue;
    const img = draw();
    if (img) map.addImage(name, img, { pixelRatio: PR });
  }
}
