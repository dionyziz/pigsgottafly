// Laid out like the club's MD 4.4 performance log (trn-docs/MD4_4_Performance_Log_C172M.pdf).
// One A4 portrait page per sector: a flight with an intermediate full stop gets a page for each
// take-off → landing (the landing at the stop and the take-off from it included).
import '../wb/xp.css';
import './performance.css';

import type { PerfBlockContent, PerfDiagram, WbPerfContent } from '../../../shared/declarations';
import type { ShownSignature } from '../form731/Form731';
import { SignLine } from '../wb/SignLine';
import type { PerfBlock } from './model';

/** 'Departure', or 'Landing at stop LGSY' for a stop's block. */
export function blockName(b: Pick<PerfBlock, 'title' | 'aerodrome'>): string {
  return b.title === 'Departure' || b.title === 'Destination' ? b.title : `${b.title} ${b.aerodrome.split(' ')[0]}`;
}

/** One MD 4.4 page: the take-off and landing of one sector (`pageNo`, from 1). Drawn from
 *  WbPerfContent, like the loading sheet (../wb/WbExport.tsx): on the export page and in the PDF. */
export function PerfSheet({
  c,
  pageNo = 1,
  signature,
}: {
  c: WbPerfContent;
  pageNo?: number;
  signature?: ShownSignature | null;
}) {
  const m = c.perf;
  const pg = m.pages[pageNo - 1];
  if (!pg) return null;
  const pages = m.pages.length;
  return (
    <section
      className="xp-sheet perf-sheet"
      aria-label={pages > 1 ? `Performance log, sector ${pageNo} of ${pages}` : 'Performance log'}
      data-sector={pageNo}
    >
      <header className="xp-head">
        <h1>PERFORMANCE LOG</h1>
        {pages > 1 && (
          <span className="perf-sector" data-testid="perf-sector">
            Sector {pageNo} of {pages} <b className="xp-fill">{pg.label}</b>
          </span>
        )}
        <div className={`xp-verdict ${m.verdict}`} data-testid="performance-verdict">
          <span className="xp-verdict-mark">
            {m.verdict === 'pass' ? 'PASS' : m.verdict === 'fail' ? 'FAIL' : 'INCOMPLETE'}
          </span>
          <span>{m.verdictText}</span>
        </div>
      </header>

      <dl className="xp-fields">
        <div>
          <dt>Date</dt>
          <dd className="xp-fill">{c.date}</dd>
        </div>
        <div>
          <dt>Registration</dt>
          <dd className="xp-fill">{c.registration}</dd>
        </div>
        <div>
          <dt>Aircraft</dt>
          <dd className="xp-fill">{c.makeModel}</dd>
        </div>
        <div>
          <dt>Pilot</dt>
          <dd className="xp-fill">{c.pilot}</dd>
        </div>
      </dl>

      <div className="perf-cols">
        <Block b={pg.takeoff} />
        <Block b={pg.landing} />
      </div>

      <div className="perf-bottom">
        {m.factors.length > 0 && (
          <table className="perf-factors">
            <thead>
              <tr>
                <th>Condition</th>
                <th>Factor for take-off or landing</th>
              </tr>
            </thead>
            <tbody>
              {m.factors.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.factor}</td>
                </tr>
              ))}
              {m.slopeRule && (
                <tr>
                  <td colSpan={2}>{m.slopeRule}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        <div className="perf-limits">
          {(m.crosswind.takeoff != null || m.crosswind.landing != null) && (
            <p>
              <b>Crosswind limits</b>
              {c.registration ? ` ${c.makeModel || c.registration}` : ''}: take-off {m.crosswind.takeoff ?? '–'} kt,
              landing {m.crosswind.landing ?? '–'} kt
            </p>
          )}
          {(pg.stall.vsKt != null || pg.stall.vsoKt != null) && (
            <p>
              <b>Stall IAS</b> (power off, wings level, MTOW): flaps up {pg.stall.vsKt ?? '–'} kt, landing flaps{' '}
              {pg.stall.vsoKt ?? '–'} kt
            </p>
          )}
          {m.notes.map((n, i) => (
            <p key={i} className="xp-small">
              {n}
            </p>
          ))}
          <p className="xp-small">
            Distances: AFM tables at the density altitude, interpolated in mass; headwind −10 % per 5 kt, tailwind +10 %
            per 2 kt; then × condition × safety factor. Required distances rounded up to the metre.
            {pg.speedsSource ? ` Vx, Vy, Vglide: ${pg.speedsSource}.` : ''}
          </p>
        </div>
      </div>

      <footer className="xp-sign">
        <span>
          DATE <b className="xp-fill">{c.date}</b>
        </span>
        <span>
          REGISTRATION <b className="xp-fill">{c.registration}</b>
        </span>
        <span>
          PILOT <b className="xp-fill">{c.pilot}</b>
        </span>
        <SignLine signature={signature} />
      </footer>
    </section>
  );
}

function Block({ b }: { b: PerfBlockContent }) {
  return (
    <div className={`perf-block ${b.verdict}`} data-phase={b.phase} data-testid={`perf-${b.phase}`}>
      <div className="perf-block-head">
        <span className="perf-block-title">{b.title}</span>
        <span className="perf-block-time xp-fill">{b.time}</span>
      </div>
      <table className="perf-rows">
        <colgroup>
          <col className="c-label" />
          <col className="c-val" />
          <col />
        </colgroup>
        <tbody>
          {b.rows.map((r, i) => (
            <tr key={r.key || i} data-row={r.key} className={r.status ? `st-${r.status}` : ''}>
              <th scope="row">{r.label}</th>
              {r.key === 'aerodrome' ? (
                <td className="perf-val perf-wide xp-fill" colSpan={2}>
                  {r.value}
                </td>
              ) : (
                <>
                  <td className="perf-val xp-fill">{r.value}</td>
                  <td className="perf-note">{r.note}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="perf-block-foot">
        {b.diagram && <WindDiagram d={b.diagram} />}
        <div className="perf-block-wx">
          <div className={`perf-verdict ${b.verdict}`}>
            <b>{b.verdict === 'pass' ? 'PASS' : b.verdict === 'fail' ? 'FAIL' : 'INCOMPLETE'}</b> {b.verdictText}
          </div>
          {b.weather && (
            <p className="xp-small">
              <b>Weather:</b> {b.weather}
            </p>
          )}
          {b.metar && <p className="xp-small perf-metar">{b.metar}</p>}
        </div>
      </div>
    </div>
  );
}

/** Runway pointing up (direction of travel); the wind arrow blows toward the runway from its relative bearing. */
function WindDiagram({ d }: { d: PerfDiagram }) {
  const S = 120;
  const c = S / 2;
  const rel = d.windFromMag == null ? null : (((d.windFromMag - d.runwayHdgMag) % 360) + 360) % 360;
  const rad = rel == null ? 0 : (rel * Math.PI) / 180;
  const R0 = 52;
  const R1 = 24;
  const ax0 = c + R0 * Math.sin(rad);
  const ay0 = c - R0 * Math.cos(rad);
  const ax1 = c + R1 * Math.sin(rad);
  const ay1 = c - R1 * Math.cos(rad);
  const ang = Math.atan2(ay1 - ay0, ax1 - ax0);
  const head = (a: number) => `${ax1 + 7 * Math.cos(ang + Math.PI - a)},${ay1 + 7 * Math.sin(ang + Math.PI - a)}`;
  return (
    <svg className="perf-wind" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Runway ${d.runway}, wind components`}>
      <circle cx={c} cy={c} r={R0 + 4} className="perf-wind-ring" />
      <rect x={c - 7} y={c - 44} width={14} height={88} rx={1.5} className="perf-wind-rwy" />
      <line x1={c} y1={c - 38} x2={c} y2={c + 38} className="perf-wind-cl" />
      <text x={c} y={c + 40} textAnchor="middle" className="perf-wind-num">
        {d.runway}
      </text>
      <text x={c} y={c - 33} textAnchor="middle" className="perf-wind-num" transform={`rotate(180 ${c} ${c - 36})`}>
        {d.reciprocal}
      </text>
      {rel != null && (
        <g className="perf-wind-arrow">
          <line x1={ax0} y1={ay0} x2={ax1} y2={ay1} />
          <polygon points={`${ax1},${ay1} ${head(0.45)} ${head(-0.45)}`} />
        </g>
      )}
      <text x={3} y={10} className="perf-wind-txt">
        {d.headwindKt < -0.05 ? `TW ${(-d.headwindKt).toFixed(0)}` : `HW ${Math.max(0, d.headwindKt).toFixed(0)}`} kt
      </text>
      <text x={S - 3} y={10} textAnchor="end" className="perf-wind-txt">
        XW {d.crosswindKt.toFixed(0)}
        {d.crossFrom ? ` ${d.crossFrom}` : ''}
      </text>
      {rel == null && (
        <text x={c} y={S - 3} textAnchor="middle" className="perf-wind-txt">
          calm
        </text>
      )}
    </svg>
  );
}
