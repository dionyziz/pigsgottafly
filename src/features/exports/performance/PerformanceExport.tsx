// Take-off and landing performance, laid out like the club's MD 4.4 performance log
// (trn-docs/MD4_4_Performance_Log_C172M.pdf): departure and destination blocks in the form's
// order, a runway/wind diagram for each, the condition-factor table, crosswind limits, the
// weather used and a pass/fail. One A4 portrait page per sector: a flight with an intermediate
// full stop gets a page for each take-off → landing (the landing at the stop and the take-off
// from it included). Each page carries the PIC's signature. These pages follow the loading sheet
// in the "Weight & balance and performance" export (../wbperf).
import { SignLine } from '../wb/SignLine';
import type { ShownSignature } from '../form731/Form731';
import type { PerfBlock, PerfPage, PerfSheetModel } from './model';
import '../wb/xp.css';
import './performance.css';

/** 'Departure', or 'Landing at stop LGSY' for a stop's block. */
export function blockName(b: PerfBlock): string {
  return b.title === 'Departure' || b.title === 'Destination' ? b.title : `${b.title} ${b.aerodrome.split(' ')[0]}`;
}

/** One MD 4.4 page: the take-off and landing of one sector (the first page by default). */
export function PerfSheet({ m, page = m.pages[0], pageNo = 1, signature }: { m: PerfSheetModel; page?: PerfPage; pageNo?: number; signature?: ShownSignature | null }) {
  const pg = page ?? { takeoff: m.departure, landing: m.arrival, speeds: m.speeds, label: '' };
  const pages = m.pages.length;
  const blocks = [pg.takeoff, pg.landing];
  return (
    <section className="xp-sheet perf-sheet" aria-label={pages > 1 ? `Performance log, sector ${pageNo} of ${pages}` : 'Performance log'} data-sector={pageNo}>
      <header className="xp-head">
        <h1>PERFORMANCE LOG</h1>
        {pages > 1 && <span className="perf-sector" data-testid="perf-sector">Sector {pageNo} of {pages} <b className="xp-fill">{pg.label}</b></span>}
        <div className={`xp-verdict ${m.verdict}`} data-testid="performance-verdict">
          <span className="xp-verdict-mark">{m.verdict === 'pass' ? 'PASS' : m.verdict === 'fail' ? 'FAIL' : 'INCOMPLETE'}</span>
          <span>{m.verdictText}</span>
        </div>
      </header>

      <dl className="xp-fields">
        <div><dt>Date</dt><dd className="xp-fill">{m.date}</dd></div>
        <div><dt>Registration</dt><dd className="xp-fill">{m.registration}</dd></div>
        <div><dt>Aircraft</dt><dd className="xp-fill">{m.makeModel}</dd></div>
        <div><dt>Pilot</dt><dd className="xp-fill">{m.pilot}</dd></div>
      </dl>

      <div className="perf-cols">
        <Block b={pg.takeoff} />
        <Block b={pg.landing} />
      </div>

      <div className="perf-bottom">
        {m.conditionTable.length > 0 && (
          <table className="perf-factors">
            <thead><tr><th>Condition</th><th>Factor for take-off or landing</th></tr></thead>
            <tbody>
              {m.conditionTable.map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.factor}</td></tr>)}
              {m.slopeRule && <tr><td colSpan={2}>{m.slopeRule}</td></tr>}
            </tbody>
          </table>
        )}
        <div className="perf-limits">
          {(m.crosswindLimits.takeoff != null || m.crosswindLimits.landing != null) && (
            <p><b>Crosswind limits</b>{m.registration ? ` ${m.makeModel || m.registration}` : ''}: take-off {m.crosswindLimits.takeoff ?? '–'} kt, landing {m.crosswindLimits.landing ?? '–'} kt</p>
          )}
          {(pg.speeds.vsKt != null || pg.speeds.vsoKt != null) && (
            <p><b>Stall IAS</b> (power off, wings level, MTOW): flaps up {pg.speeds.vsKt ?? '–'} kt, landing flaps {pg.speeds.vsoKt ?? '–'} kt</p>
          )}
          {m.conditionNotes.map((n, i) => <p key={i} className="xp-small">{n}</p>)}
          <p className="xp-small">
            Distances: AFM tables at the density altitude, interpolated in mass; headwind −10 % per 5 kt, tailwind +10 % per 2 kt;
            then × condition × safety factor. Required distances rounded up to the metre.
            {pg.speeds.source ? ` Vx, Vy, Vglide: ${pg.speeds.source}.` : ''}
          </p>
        </div>
      </div>

      {m.warnings.length + blocks.reduce((s, b) => s + b.warnings.length, 0) > 0 && (
        <div className="xp-notes">
          <ul>
            {m.warnings.map((w, i) => <li key={`g${i}`}>{w}</li>)}
            {blocks.map((b, j) => b.warnings.map((w, i) => <li key={`b${j}-${i}`}>{blockName(b)}: {w}</li>))}
          </ul>
        </div>
      )}

      <footer className="xp-sign">
        <span>DATE <b className="xp-fill">{m.date}</b></span>
        <span>REGISTRATION <b className="xp-fill">{m.registration}</b></span>
        <span>PILOT <b className="xp-fill">{m.pilot}</b></span>
        <SignLine signature={signature} />
        <span className="xp-form">MD 4.4</span>
      </footer>
    </section>
  );
}

function Block({ b }: { b: PerfBlock }) {
  return (
    <div className={`perf-block ${b.verdict}`} data-phase={b.phase} data-testid={`perf-${b.phase}`}>
      <div className="perf-block-head">
        <span className="perf-block-title">{b.title}</span>
        <span className="perf-block-time xp-fill">{b.time}</span>
      </div>
      <table className="perf-rows">
        <colgroup><col className="c-label" /><col className="c-val" /><col /></colgroup>
        <tbody>
          {b.rows.map((r) => (
            <tr key={r.key} data-row={r.key} className={r.status ? `st-${r.status}` : ''}>
              <th scope="row">{r.label}</th>
              {r.key === 'aerodrome'
                ? <td className="perf-val perf-wide xp-fill" colSpan={2}>{r.value}</td>
                : <><td className="perf-val xp-fill">{r.value}</td><td className="perf-note">{r.note}</td></>}
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
          {b.weatherSource && <p className="xp-small"><b>Weather:</b> {b.weatherSource}</p>}
          {b.rawMetar && <p className="xp-small perf-metar">{b.rawMetar}</p>}
        </div>
      </div>
    </div>
  );
}

/** Runway pointing up (direction of travel); the wind arrow blows toward the runway from its relative bearing. */
function WindDiagram({ d }: { d: NonNullable<PerfBlock['diagram']> }) {
  const S = 120;
  const c = S / 2;
  const rel = d.windFromMag == null ? null : ((d.windFromMag - d.runwayHdgMag) % 360 + 360) % 360;
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
      <text x={c} y={c + 40} textAnchor="middle" className="perf-wind-num">{d.runway}</text>
      <text x={c} y={c - 33} textAnchor="middle" className="perf-wind-num" transform={`rotate(180 ${c} ${c - 36})`}>{d.reciprocal}</text>
      {rel != null && (
        <g className="perf-wind-arrow">
          <line x1={ax0} y1={ay0} x2={ax1} y2={ay1} />
          <polygon points={`${ax1},${ay1} ${head(0.45)} ${head(-0.45)}`} />
        </g>
      )}
      <text x={3} y={10} className="perf-wind-txt">{d.headwindKt < -0.05 ? `TW ${(-d.headwindKt).toFixed(0)}` : `HW ${Math.max(0, d.headwindKt).toFixed(0)}`} kt</text>
      <text x={S - 3} y={10} textAnchor="end" className="perf-wind-txt">XW {d.crosswindKt.toFixed(0)}{d.crossFrom ? ` ${d.crossFrom}` : ''}</text>
      {rel == null && <text x={c} y={S - 3} textAnchor="middle" className="perf-wind-txt">calm</text>}
    </svg>
  );
}
