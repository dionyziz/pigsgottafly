// CG moment envelope (moment vs mass), as the AFM chart on the MD 4.3 form: normal and utility
// envelopes, the take-off and landing points joined by the fuel-burn line (through the point at
// each intermediate stop), and the zero-fuel point at the end of a dashed continuation (where the
// aircraft would be with all fuel burnt).
import type { WbPoint } from '../../../calc';
import { chartDomain, fmtKg, type ChartEnvelope } from './model';
import { layoutChartLabels, type Box, type Segment } from './chartLayout';

export interface ChartPoint {
  /** stop0, stop1…: intermediate full stops, in flight order. */
  key: 'takeoff' | 'landing' | 'zerofuel' | `stop${number}`;
  label: string;
  point: WbPoint;
  ok: boolean | null;
}

const W = 1000;
const H = 560;
const M = { l: 78, r: 18, t: 18, b: 62 };

/** Chart geometry: scales, the points by key and the label layout (exported for the tests). */
export function envelopeChartGeometry(envelopes: ChartEnvelope[], points: ChartPoint[]) {
  const valid = points.filter((p) => p.point.massKg > 0 && isFinite(p.point.momentKgM));
  const d = chartDomain(
    envelopes,
    valid.map((p) => p.point),
  );
  const sx = (x: number) => M.l + ((x - d.x0) / (d.x1 - d.x0)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - d.y0) / (d.y1 - d.y0)) * (H - M.t - M.b);
  const byKey = new Map(valid.map((p) => [p.key, p]));
  const to = byKey.get('takeoff');
  const ldg = byKey.get('landing');
  const zf = byKey.get('zerofuel');
  const stops = valid.filter((p) => p.key.startsWith('stop'));
  // fuel burn: take-off → each stop → landing
  const burnPath = [to, ...stops, ldg].filter((p): p is ChartPoint => !!p);

  // Captions and value labels placed clear of each other, the markers and the fuel-burn line.
  const px = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [sx(x), sy(y)]);
  const burn: Segment[] = [];
  if (to && ldg)
    for (let i = 0; i + 1 < burnPath.length; i++) {
      const a = burnPath[i].point,
        b = burnPath[i + 1].point;
      burn.push([sx(a.momentKgM), sy(a.massKg), sx(b.momentKgM), sy(b.massKg)]);
    }
  if (ldg && zf)
    burn.push([sx(ldg.point.momentKgM), sy(ldg.point.massKg), sx(zf.point.momentKgM), sy(zf.point.massKg)]);
  const bounds: Box = { x0: M.l + 2, y0: M.t + 2, x1: W - M.r - 2, y1: H - M.b - 2 };
  const pointInputs = valid.map((p) => ({
    key: p.key,
    x: sx(p.point.momentKgM),
    y: sy(p.point.massKg),
    r: markR(p.key),
    lines: [`${p.label} ${fmtKg(p.point.massKg)} kg`, `${p.point.momentKgM.toFixed(1)} kg·m`],
    fontPx: p.key === 'zerofuel' ? 14 : 16,
  }));
  const layout = layoutChartLabels({
    bounds,
    envelopes: envelopes
      .filter((e) => e.outline.length >= 3)
      .map((e, i) => {
        const ys = e.outline.map(([, y]) => sy(y));
        const top = Math.min(...ys),
          bottom = Math.max(...ys);
        return {
          key: e.category,
          text: e.label.toUpperCase(),
          fontPx: i === 0 ? 17 : 15,
          letterSpacingEm: 0.08,
          outline: px(e.outline),
          preferY: i === 0 ? top + 14 : (top + bottom) / 2,
        };
      }),
    points: pointInputs,
    burn,
  });
  return { d, sx, sy, valid, to, ldg, zf, stops, burnPath, burn, bounds, markers: pointInputs, layout };
}

const MARK_R = { takeoff: 8, landing: 7, zerofuel: 6 } as const;
const markR = (key: ChartPoint['key']) => (key in MARK_R ? MARK_R[key as keyof typeof MARK_R] : 7);

export function EnvelopeChart({ envelopes, points }: { envelopes: ChartEnvelope[]; points: ChartPoint[] }) {
  const { d, sx, sy, valid, to, ldg, zf, burnPath, layout } = envelopeChartGeometry(envelopes, points);
  const path = (pts: [number, number][]) =>
    pts.length ? `M${pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('L')}Z` : '';

  const minor: number[] = [];
  for (let x = d.x0 + 50; x < d.x1; x += 100) minor.push(x);
  const minorY: number[] = [];
  for (let y = d.y0 + 25; y < d.y1; y += 50) minorY.push(y);
  const envLabel = new Map(layout.envelopes.map((l) => [l.key, l]));
  const ptLabel = new Map(layout.points.map((l) => [l.key, l]));

  return (
    <svg
      className="wb-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Centre of gravity moment envelope with the take-off and landing points"
    >
      <defs>
        <pattern id="wb-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="9" className="wb-hatch-line" />
        </pattern>
        <clipPath id="wb-plot">
          <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
        </clipPath>
      </defs>

      {/* grid */}
      <g className="wb-grid-minor">
        {minor.map((x) => (
          <line key={`mx${x}`} x1={sx(x)} x2={sx(x)} y1={M.t} y2={H - M.b} />
        ))}
        {minorY.map((y) => (
          <line key={`my${y}`} x1={M.l} x2={W - M.r} y1={sy(y)} y2={sy(y)} />
        ))}
      </g>
      <g className="wb-grid">
        {d.xTicks.map((x) => (
          <line key={`x${x}`} x1={sx(x)} x2={sx(x)} y1={M.t} y2={H - M.b} />
        ))}
        {d.yTicks.map((y) => (
          <line key={`y${y}`} x1={M.l} x2={W - M.r} y1={sy(y)} y2={sy(y)} />
        ))}
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
      {envelopes.map((e) => {
        const l = envLabel.get(e.category);
        if (!l) return null;
        return (
          <text
            key={`l${e.category}`}
            x={l.x}
            y={l.y}
            className={`wb-env-label wb-env-label-${e.category}`}
            textAnchor={l.anchor}
          >
            {e.label.toUpperCase()}
          </text>
        );
      })}

      {/* fuel burn: take-off → landing, then on to zero fuel (dashed) */}
      <g clipPath="url(#wb-plot)">
        {ldg && zf && (
          <line
            className="wb-burn-rest"
            x1={sx(ldg.point.momentKgM)}
            y1={sy(ldg.point.massKg)}
            x2={sx(zf.point.momentKgM)}
            y2={sy(zf.point.massKg)}
          />
        )}
        {to &&
          ldg &&
          burnPath.slice(1).map((b, i) => {
            const a = burnPath[i];
            return (
              <line
                key={`burn${i}`}
                className="wb-burn"
                x1={sx(a.point.momentKgM)}
                y1={sy(a.point.massKg)}
                x2={sx(b.point.momentKgM)}
                y2={sy(b.point.massKg)}
              />
            );
          })}
      </g>

      {/* points */}
      {valid.map((p) => {
        const x = sx(p.point.momentKgM);
        const y = sy(p.point.massKg);
        const cls = `wb-pt wb-pt-${p.key} ${p.ok === false ? 'bad' : ''}`;
        const marker =
          p.key === 'takeoff' ? (
            <circle cx={x} cy={y} r={8} />
          ) : p.key === 'landing' ? (
            <rect x={x - 7} y={y - 7} width={14} height={14} />
          ) : p.key === 'zerofuel' ? (
            <circle cx={x} cy={y} r={6} className="hollow" />
          ) : (
            <polygon points={`${x},${y - 8} ${x + 8},${y} ${x},${y + 8} ${x - 8},${y}`} />
          );
        const l = ptLabel.get(p.key);
        return (
          <g key={p.key} className={cls}>
            {l?.leader && (
              <line className="wb-pt-leader" x1={l.leader[0]} y1={l.leader[1]} x2={l.leader[2]} y2={l.leader[3]} />
            )}
            {marker}
            {l && (
              <text x={l.x} y={l.y} textAnchor={l.anchor} className="wb-pt-label" data-label={p.key}>
                <tspan x={l.x}>
                  {p.label} {fmtKg(p.point.massKg)} kg
                </tspan>
                <tspan x={l.x} dy={l.lineHeight} className="wb-pt-sub">
                  {p.point.momentKgM.toFixed(1)} kg·m
                </tspan>
              </text>
            )}
          </g>
        );
      })}

      {/* axes */}
      <g className="wb-axis">
        {d.xTicks.map((x) => (
          <text key={`tx${x}`} x={sx(x)} y={H - M.b + 22} textAnchor="middle">
            {x}
          </text>
        ))}
        {d.yTicks.map((y) => (
          <text key={`ty${y}`} x={M.l - 10} y={sy(y) + 6} textAnchor="end">
            {y}
          </text>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 10} textAnchor="middle" className="wb-axis-title">
          LOADED AIRCRAFT MOMENT (kg·m)
        </text>
        <text
          transform={`translate(20 ${(M.t + H - M.b) / 2}) rotate(-90)`}
          textAnchor="middle"
          className="wb-axis-title"
        >
          LOADED AIRCRAFT WEIGHT (kg)
        </text>
      </g>
    </svg>
  );
}
