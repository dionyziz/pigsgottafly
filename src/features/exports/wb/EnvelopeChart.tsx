// CG moment envelope (moment vs mass), as the AFM chart on the MD 4.3 form: normal and utility
// envelopes, the take-off and landing points joined by the fuel-burn line, and the zero-fuel point
// at the end of a dashed continuation (where the aircraft would be with all fuel burnt).
import type { WbPoint } from '../../../calc';
import { chartDomain, fmtKg, type ChartEnvelope } from './model';

export interface ChartPoint {
  key: 'takeoff' | 'landing' | 'zerofuel';
  label: string;
  point: WbPoint;
  ok: boolean | null;
}

const W = 1000;
const H = 560;
const M = { l: 78, r: 18, t: 18, b: 62 };

export function EnvelopeChart({ envelopes, points }: { envelopes: ChartEnvelope[]; points: ChartPoint[] }) {
  const valid = points.filter((p) => p.point.massKg > 0 && isFinite(p.point.momentKgM));
  const d = chartDomain(envelopes, valid.map((p) => p.point));
  const sx = (x: number) => M.l + ((x - d.x0) / (d.x1 - d.x0)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - d.y0) / (d.y1 - d.y0)) * (H - M.t - M.b);
  const path = (pts: [number, number][]) => (pts.length ? `M${pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('L')}Z` : '');
  const byKey = new Map(valid.map((p) => [p.key, p]));
  const to = byKey.get('takeoff');
  const ldg = byKey.get('landing');
  const zf = byKey.get('zerofuel');

  const minor: number[] = [];
  for (let x = d.x0 + 50; x < d.x1; x += 100) minor.push(x);
  const minorY: number[] = [];
  for (let y = d.y0 + 25; y < d.y1; y += 50) minorY.push(y);

  const labelPos = (e: ChartEnvelope, i: number): [number, number] => {
    if (i === 0) {
      const top = e.outline.filter(([, m]) => m >= e.maxKg - 1);
      const xs = (top.length ? top : e.outline).map(([x]) => x);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, e.maxKg - (d.y1 - d.y0) * 0.06];
    }
    const xs = e.outline.map(([x]) => x);
    const ys = e.outline.map(([, y]) => y);
    return [(Math.min(...xs) + Math.max(...xs)) / 2 - (Math.max(...xs) - Math.min(...xs)) * 0.12, (Math.min(...ys) + Math.max(...ys)) / 2];
  };

  return (
    <svg className="wb-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Centre of gravity moment envelope with the take-off and landing points">
      <defs>
        <pattern id="wb-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="9" className="wb-hatch-line" />
        </pattern>
        <clipPath id="wb-plot"><rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} /></clipPath>
      </defs>

      {/* grid */}
      <g className="wb-grid-minor">
        {minor.map((x) => <line key={`mx${x}`} x1={sx(x)} x2={sx(x)} y1={M.t} y2={H - M.b} />)}
        {minorY.map((y) => <line key={`my${y}`} x1={M.l} x2={W - M.r} y1={sy(y)} y2={sy(y)} />)}
      </g>
      <g className="wb-grid">
        {d.xTicks.map((x) => <line key={`x${x}`} x1={sx(x)} x2={sx(x)} y1={M.t} y2={H - M.b} />)}
        {d.yTicks.map((y) => <line key={`y${y}`} x1={M.l} x2={W - M.r} y1={sy(y)} y2={sy(y)} />)}
      </g>
      <rect className="wb-frame" x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />

      {/* envelopes */}
      <g clipPath="url(#wb-plot)">
        {envelopes.map((e, i) => (
          <g key={e.category} className={`wb-env wb-env-${e.category}`}>
            <path d={path(e.outline)} className="wb-env-fill" fill={i > 0 ? 'url(#wb-hatch)' : undefined} />
            <path d={path(e.outline)} className="wb-env-line" />
            {e.cgOutline && <path d={path(e.cgOutline)} className="wb-env-cg" />}
          </g>
        ))}
      </g>
      {envelopes.map((e, i) => {
        if (!e.outline.length) return null;
        const [x, y] = labelPos(e, i);
        return <text key={`l${e.category}`} x={sx(x)} y={sy(y)} className={`wb-env-label wb-env-label-${e.category}`} textAnchor="middle">{e.label.toUpperCase()}</text>;
      })}

      {/* fuel burn: take-off → landing, then on to zero fuel (dashed) */}
      <g clipPath="url(#wb-plot)">
        {ldg && zf && <line className="wb-burn-rest" x1={sx(ldg.point.momentKgM)} y1={sy(ldg.point.massKg)} x2={sx(zf.point.momentKgM)} y2={sy(zf.point.massKg)} />}
        {to && ldg && <line className="wb-burn" x1={sx(to.point.momentKgM)} y1={sy(to.point.massKg)} x2={sx(ldg.point.momentKgM)} y2={sy(ldg.point.massKg)} />}
      </g>

      {/* points */}
      {valid.map((p) => {
        const x = sx(p.point.momentKgM);
        const y = sy(p.point.massKg);
        const cls = `wb-pt wb-pt-${p.key} ${p.ok === false ? 'bad' : ''}`;
        const marker = p.key === 'takeoff'
          ? <circle cx={x} cy={y} r={8} />
          : p.key === 'landing'
            ? <rect x={x - 7} y={y - 7} width={14} height={14} />
            : <circle cx={x} cy={y} r={6} className="hollow" />;
        const right = x < W - 260;
        return (
          <g key={p.key} className={cls}>
            {marker}
            <text x={right ? x + 14 : x - 14} y={y + (p.key === 'landing' ? 22 : p.key === 'zerofuel' ? 20 : -10)} textAnchor={right ? 'start' : 'end'} className="wb-pt-label">
              {p.label} {fmtKg(p.point.massKg)} kg · {p.point.momentKgM.toFixed(1)} kg·m
            </text>
          </g>
        );
      })}

      {/* axes */}
      <g className="wb-axis">
        {d.xTicks.map((x) => <text key={`tx${x}`} x={sx(x)} y={H - M.b + 22} textAnchor="middle">{x}</text>)}
        {d.yTicks.map((y) => <text key={`ty${y}`} x={M.l - 10} y={sy(y) + 6} textAnchor="end">{y}</text>)}
        <text x={(M.l + W - M.r) / 2} y={H - 10} textAnchor="middle" className="wb-axis-title">LOADED AIRCRAFT MOMENT (kg·m)</text>
        <text transform={`translate(20 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" className="wb-axis-title">LOADED AIRCRAFT WEIGHT (kg)</text>
      </g>
    </svg>
  );
}
