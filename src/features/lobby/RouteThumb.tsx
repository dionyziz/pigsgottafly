// The lobby's route thumbnail. Styles in lists.css.
import './lists.css';

/** Route sketch from summary.route ([lat, lon] pairs), equirectangular with cos(lat) scaling. */
export function RouteThumb({ route, size = 44 }: { route: [number, number][]; size?: number }) {
  const pad = 5;
  if (route.length < 2) {
    return (
      <svg className="thumb" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={3} className="thumb-dot" />
      </svg>
    );
  }
  const k = Math.cos((route.reduce((s, p) => s + p[0], 0) / route.length) * Math.PI / 180);
  const xs = route.map((p) => p[1] * k), ys = route.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const s = (size - 2 * pad) / span;
  const ox = pad + ((size - 2 * pad) - (maxX - minX) * s) / 2, oy = pad + ((size - 2 * pad) - (maxY - minY) * s) / 2;
  const pts = route.map((_, i) => [ox + (xs[i] - minX) * s, oy + (ys[i] - minY) * s] as const);
  const closed = route[0][0] === route[route.length - 1][0] && route[0][1] === route[route.length - 1][1];
  return (
    <svg className="thumb" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} className="thumb-line" />
      <circle cx={pts[0][0]} cy={pts[0][1]} r={2.6} className="thumb-start" />
      {!closed && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.6} className="thumb-end" />}
    </svg>
  );
}
