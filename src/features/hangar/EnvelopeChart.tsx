// SVG preview of W&B envelopes: CG (arm m × mass kg) or moment (kg·m × mass kg), with optional
// marked points (empty aircraft). Pure presentational; scales to the container width.
import { useId } from 'react';

export interface ChartSeries {
  label: string;
  points: [number, number][];
  kind: 'normal' | 'utility';
}
export interface ChartMarker {
  label: string;
  at: [number, number];
}

/** "Nice" tick step for a span (1, 2, 2.5, 5 × 10^n). */
function niceStep(span: number, target = 6): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}
function ticks(lo: number, hi: number, target?: number): number[] {
  const s = niceStep(hi - lo, target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / s - 1e-9) * s; v <= hi + 1e-9; v += s) out.push(Math.round(v / s) * s);
  return out;
}
const fmt = (v: number, step: number) => v.toFixed(Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));

export function EnvelopeChart({
  series,
  markers = [],
  xLabel,
  yLabel,
  height = 300,
  maxLine,
}: {
  series: ChartSeries[];
  markers?: ChartMarker[];
  xLabel: string;
  yLabel: string;
  height?: number;
  /** Horizontal dashed line, e.g. MTOW. */
  maxLine?: { label: string; y: number } | null;
}) {
  const clip = useId().replace(/:/g, '');
  const pts = [...series.flatMap((s) => s.points), ...markers.map((m) => m.at)].filter(
    ([x, y]) => isFinite(x) && isFinite(y),
  );
  const W = 560,
    H = height,
    L = 58,
    R = 16,
    T = 14,
    B = 42;
  if (pts.length < 2) {
    return (
      <svg className="env-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Envelope chart (no data)">
        <rect x={L} y={T} width={W - L - R} height={H - T - B} className="plot-bg" />
        <text x={(L + W - R) / 2} y={(T + H - B) / 2} textAnchor="middle" className="empty-msg">
          Enter at least three points to see the envelope
        </text>
      </svg>
    );
  }
  let x0 = Math.min(...pts.map((p) => p[0])),
    x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1])),
    y1 = Math.max(...pts.map((p) => p[1]), maxLine?.y ?? -Infinity);
  const px = (x1 - x0 || Math.abs(x0) || 1) * 0.08,
    py = (y1 - y0 || Math.abs(y0) || 1) * 0.08;
  x0 -= px;
  x1 += px;
  y0 -= py;
  y1 += py;
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const xt = ticks(x0, x1, 7),
    yt = ticks(y0, y1, 6);
  const xs = niceStep(x1 - x0, 7),
    ys = niceStep(y1 - y0, 6);
  const desc = series.map((s) => `${s.label}: ${s.points.map(([x, y]) => `(${x}, ${y})`).join(' ')}`).join('; ');
  return (
    <svg className="env-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} against ${xLabel}. ${desc}`}>
      <defs>
        <clipPath id={clip}>
          <rect x={L} y={T} width={W - L - R} height={H - T - B} />
        </clipPath>
      </defs>
      <rect x={L} y={T} width={W - L - R} height={H - T - B} className="plot-bg" />
      {xt.map((v) => (
        <g key={'x' + v}>
          <line x1={sx(v)} x2={sx(v)} y1={T} y2={H - B} className="grid" />
          <text x={sx(v)} y={H - B + 16} textAnchor="middle" className="tick">
            {fmt(v, xs)}
          </text>
        </g>
      ))}
      {yt.map((v) => (
        <g key={'y' + v}>
          <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="grid" />
          <text x={L - 6} y={sy(v) + 4} textAnchor="end" className="tick">
            {fmt(v, ys)}
          </text>
        </g>
      ))}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="axis-label">
        {xLabel}
      </text>
      <text transform={`translate(14 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">
        {yLabel}
      </text>
      <g clipPath={`url(#${clip})`}>
        {series
          .filter((s) => s.points.length >= 2)
          .map((s) => (
            <polygon
              key={s.label}
              points={s.points.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}
              className={'env ' + s.kind}
            />
          ))}
        {series.map((s) =>
          s.points.map(([x, y], i) => (
            <circle key={s.label + i} cx={sx(x)} cy={sy(y)} r={2.6} className={'vtx ' + s.kind} />
          )),
        )}
        {maxLine && maxLine.y > 0 && (
          <g>
            <line x1={L} x2={W - R} y1={sy(maxLine.y)} y2={sy(maxLine.y)} className="maxline" />
            <text x={W - R - 4} y={sy(maxLine.y) - 4} textAnchor="end" className="tick">
              {maxLine.label}
            </text>
          </g>
        )}
        {markers.map((m) => (
          <g key={m.label} className="marker">
            <path d={`M${sx(m.at[0])},${sy(m.at[1]) - 6} l6,6 l-6,6 l-6,-6 z`} />
            <text x={sx(m.at[0]) + 9} y={sy(m.at[1]) + 4}>
              {m.label}
            </text>
          </g>
        ))}
      </g>
      <g className="legend" transform={`translate(${L + 8} ${T + 8})`}>
        {series
          .filter((s) => s.points.length >= 2)
          .map((s, i) => (
            <g key={s.label} transform={`translate(${i * 110} 0)`}>
              <rect width={14} height={10} className={'env ' + s.kind} />
              <text x={20} y={9}>
                {s.label}
              </text>
            </g>
          ))}
      </g>
    </svg>
  );
}
