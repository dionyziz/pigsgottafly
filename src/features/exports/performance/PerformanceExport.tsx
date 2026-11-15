// Export (f): take-off and landing performance, laid out like the club's MD 4.4 performance log
// (trn-docs/MD4_4_Performance_Log_C172M.pdf): departure and destination blocks in the form's
// order, a runway/wind diagram for each, the condition-factor table, crosswind limits, the
// weather used and a pass/fail. One A4 portrait page.
//
// Usage (ExportPage): <PerformanceExport flight={flight} />. Loads the pilot, the aircraft and the
// weather (surface forecast / METAR at the take-off and landing times) itself.
import type { Flight } from '../../../shared';
import { useExportCalc } from '../wb/useExportCalc';
import { perfSheetModel, type PerfBlock, type PerfSheetModel } from './model';
import '../wb/xp.css';
import './performance.css';

export function PerformanceExport({ flight }: { flight: Flight }) {
  const st = useExportCalc(flight);
  if (st.loading || !st.calc) return <div className="xp-loading muted">Loading…</div>;
  const m = perfSheetModel({ doc: flight, aircraft: st.aircraft, pilot: st.pilot, calc: st.calc });
  const screenWarnings = [...m.warnings, ...m.departure.warnings.map((w) => `Departure: ${w}`), ...m.arrival.warnings.map((w) => `Destination: ${w}`)];
  const anyWx = !!(st.calc.departure.conditions || st.calc.arrival.conditions);
  return (
    <div className="xp-doc" data-testid="performance-export" data-ready={st.weatherPending ? 'false' : 'true'} data-verdict={m.verdict}>
      <div className="xp-status no-print">
        <div className="xp-status-row">
          <span className={`chip ${m.verdict === 'pass' ? 'ok' : m.verdict === 'fail' ? 'danger' : 'warn'}`}>{m.verdictText}</span>
          <span className={`chip ${st.weatherPending ? '' : anyWx ? 'ok' : 'warn'}`}>
            {st.weatherPending ? 'Loading weather…' : anyWx ? 'Surface weather loaded' : 'No surface weather: ISA and calm'}
          </span>
          <span className="spacer" />
          <button className="ghost" onClick={st.refresh} disabled={st.weatherPending}>Refresh weather</button>
        </div>
        {screenWarnings.length > 0 && <ul className="xp-warnings" data-testid="performance-warnings">{screenWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      </div>
      <div className="xp-stage"><PerfSheet m={m} /></div>
    </div>
  );
}

export function PerfSheet({ m }: { m: PerfSheetModel }) {
  return (
    <section className="xp-sheet perf-sheet" aria-label="Performance log">
      <header className="xp-head">
        <h1>PERFORMANCE LOG</h1>
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
        <Block b={m.departure} />
        <Block b={m.arrival} />
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
          {(m.speeds.vsKt != null || m.speeds.vsoKt != null) && (
            <p><b>Stall IAS</b> (power off, wings level, MTOW): flaps up {m.speeds.vsKt ?? '–'} kt, landing flaps {m.speeds.vsoKt ?? '–'} kt</p>
          )}
          {m.conditionNotes.map((n, i) => <p key={i} className="xp-small">{n}</p>)}
          <p className="xp-small">
            Distances: AFM tables at the density altitude, interpolated in mass; headwind −10 % per 5 kt, tailwind +10 % per 2 kt;
            then × condition × safety factor. Required distances rounded up to the metre.
            {m.speeds.source ? ` Vx, Vy, Vglide: ${m.speeds.source}.` : ''}
          </p>
        </div>
      </div>

      {m.warnings.length + m.departure.warnings.length + m.arrival.warnings.length > 0 && (
        <div className="xp-notes">
          <ul>
            {m.warnings.map((w, i) => <li key={`g${i}`}>{w}</li>)}
            {m.departure.warnings.map((w, i) => <li key={`d${i}`}>Departure: {w}</li>)}
            {m.arrival.warnings.map((w, i) => <li key={`a${i}`}>Destination: {w}</li>)}
          </ul>
        </div>
      )}

      <footer className="xp-sign">
        <span>DATE <b className="xp-fill">{m.date}</b></span>
        <span>REGISTRATION <b className="xp-fill">{m.registration}</b></span>
        <span>PILOT <b className="xp-fill">{m.pilot}</b></span>
        <span className="sign">SIGN</span>
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
