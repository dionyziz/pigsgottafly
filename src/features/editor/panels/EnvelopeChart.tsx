// Compact CG envelope chart (mass vs CG arm) with the take-off and landing points (and the point at
// each intermediate stop, on the fuel-burn line between them), for the panel.
// The full-size MD 4.3 chart is in the W&B export.
import type { MassBalance, WbCategory } from '../../../shared';
import type { WbPoint } from '../../../calc';

const W = 296, H = 150, PAD = { l: 34, r: 8, t: 8, b: 22 };

export function EnvelopeChart({ massBalance, category, takeoff, landing, stops = [] }: {
  massBalance: MassBalance;
  category: WbCategory;
  takeoff: WbPoint;
  landing: WbPoint;
  /** Intermediate stops in flight order, with a short label (ICAO). */
  stops?: { label: string; point: WbPoint }[];
}) {
  const normal = massBalance.envelopes.normal;
  const utility = massBalance.envelopes.utility;
  const polys = [normal.polygon, ...(utility ? [utility.polygon] : [])].filter((p) => p.length > 2);
  if (!polys.length) return null;
  const xs = [...polys.flat().map((p) => p[0]), takeoff.armM, landing.armM, ...stops.map((s) => s.point.armM)].filter(isFinite);
  const ys = [...polys.flat().map((p) => p[1]), takeoff.massKg, landing.massKg, ...stops.map((s) => s.point.massKg)].filter(isFinite);
  const x0 = Math.min(...xs) - 0.02, x1 = Math.max(...xs) + 0.02;
  const y0 = Math.min(...ys) - 20, y1 = Math.max(...ys) + 20;
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => H - PAD.b - ((y - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const path = (poly: [number, number][]) => poly.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('') + 'Z';
  const xticks: number[] = [];
  for (let x = Math.ceil(x0 * 20) / 20; x <= x1; x += 0.05) xticks.push(+x.toFixed(2));
  const ystep = y1 - y0 > 400 ? 100 : 50;
  const yticks: number[] = [];
  for (let y = Math.ceil(y0 / ystep) * ystep; y <= y1; y += ystep) yticks.push(y);
  const pt = (p: WbPoint, label: string, cls: string) => isFinite(p.armM) && isFinite(p.massKg) && (
    <g className={cls}>
      <circle cx={sx(p.armM)} cy={sy(p.massKg)} r={4} />
      <text x={sx(p.armM) + 6} y={sy(p.massKg) + (cls === 'to' ? -4 : 11)}>{label}</text>
    </g>
  );
  return (
    <svg className="ep-env" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="CG envelope with take-off and landing points">
      {xticks.map((x) => (
        <g key={'x' + x}>
          <line x1={sx(x)} x2={sx(x)} y1={PAD.t} y2={H - PAD.b} className="grid" />
          <text x={sx(x)} y={H - 6} textAnchor="middle" className="tick">{x.toFixed(2)}</text>
        </g>
      ))}
      {yticks.map((y) => (
        <g key={'y' + y}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(y)} y2={sy(y)} className="grid" />
          <text x={PAD.l - 4} y={sy(y) + 3} textAnchor="end" className="tick">{y}</text>
        </g>
      ))}
      <path d={path(normal.polygon)} className={'env normal' + (category === 'normal' ? ' active' : '')} />
      {utility && utility.polygon.length > 2 && <path d={path(utility.polygon)} className={'env utility' + (category === 'utility' ? ' active' : '')} />}
      {[takeoff, ...stops.map((s) => s.point), landing].slice(1).map((b, i, rest) => {
        const a = i === 0 ? takeoff : rest[i - 1];
        return <line key={i} x1={sx(a.armM)} y1={sy(a.massKg)} x2={sx(b.armM)} y2={sy(b.massKg)} className="burn" />;
      })}
      {stops.map((s, i) => <g key={i}>{pt(s.point, s.label, 'stop')}</g>)}
      {pt(takeoff, 'TO', 'to')}
      {pt(landing, 'LDG', 'ldg')}
    </svg>
  );
}
