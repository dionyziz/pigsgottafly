// Chart symbols drawn on a canvas and registered as map images (crisp at any pixel ratio, no
// sprite files to host). Shapes follow the ICAO VFR chart conventions loosely: aerodrome = ring with
// the runway bar, reporting point = triangle (solid charted, hollow open-flightmaps), my waypoint =
// four-point star.
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

export const SYMBOLS: Record<string, () => ImageData | null> = {
  'pgf-ad-major': () =>
    make(30, (g, s) => {
      ring(g, s, 8, 2.2, CHART.aerodrome);
      runwayBar(g, s, 24, 3.6, CHART.aerodrome);
    }),
  'pgf-ad-minor': () =>
    make(26, (g, s) => {
      ring(g, s, 6.5, 1.8, CHART.aerodrome);
      runwayBar(g, s, 19, 2.8, CHART.aerodrome);
    }),
  'pgf-ad-plain': () =>
    make(22, (g, s) => {
      ring(g, s, 6, 1.8, CHART.aerodrome);
      g.beginPath();
      g.arc(s / 2, s / 2, 2.2, 0, Math.PI * 2);
      g.fillStyle = CHART.aerodrome;
      g.fill();
    }),
  'pgf-ad-water': () =>
    make(24, (g, s) => {
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
    }),
  'pgf-vfr': () =>
    make(18, (g, s) => {
      triangle(g, s, 6.4);
      g.fillStyle = CHART.vfr;
      g.fill();
      g.lineWidth = 1.4;
      g.strokeStyle = CHART.paper;
      g.stroke();
    }),
  'pgf-vfr-ofm': () =>
    make(18, (g, s) => {
      triangle(g, s, 5.6);
      g.fillStyle = CHART.halo;
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = CHART.vfr;
      g.stroke();
    }),
  'pgf-wpt': () =>
    make(20, (g, s) => {
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
    }),
  // one-way arrow along a VFR route (points along the line direction = image +x)
  'pgf-arrow': () =>
    make(14, (g, s) => {
      g.beginPath();
      g.moveTo(s / 2 - 3, s / 2 - 4);
      g.lineTo(s / 2 + 3, s / 2);
      g.lineTo(s / 2 - 3, s / 2 + 4);
      g.lineWidth = 2;
      g.strokeStyle = CHART.vfr;
      g.stroke();
    }),
  // direction of flight on a route leg (points north; the layer rotates it to the leg): an arrowhead
  // a little wider than the route line, with a white edge
  'pgf-route-arrow': () =>
    make(22, (g, s) => {
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
    }),
  // restricted-area hatching (a fill-pattern tile: diagonal lines that join across tiles)
  'pgf-hatch-r': () =>
    make(8, (g, s) => {
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
    }),
};

/** Register every chart symbol on the map (idempotent). */
export function addSymbols(map: MlMap): void {
  for (const [name, draw] of Object.entries(SYMBOLS)) {
    if (map.hasImage(name)) continue;
    const img = draw();
    if (img) map.addImage(name, img, { pixelRatio: PR });
  }
}
