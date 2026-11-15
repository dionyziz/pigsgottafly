// Export (e): weight and balance, laid out like the club's MD 4.3 loading sheet
// (trn-docs/MD4_3_Loading_Sheet_C172M.pdf): the loading table (empty, fuel, each station with the
// people in it, baggage), totals at take-off and landing, the CG moment envelope chart with both
// points and the burn line, and a pass/fail verdict. One A4 portrait page.
//
// Usage (ExportPage): <WbExport flight={flight} />. Loads the pilot, the aircraft and the weather
// (trip fuel depends on the winds aloft) itself.
import type { Flight } from '../../../shared';
import { routeText } from '../form731/common';
import { EnvelopeChart, type ChartPoint } from './EnvelopeChart';
import { fmtArm, fmtCg, fmtKg, fmtMoment, wbSheetModel, type WbLine, type WbSheetModel } from './model';
import { useExportCalc } from './useExportCalc';
import './xp.css';
import './wb.css';

export function WbExport({ flight }: { flight: Flight }) {
  const st = useExportCalc(flight);
  if (st.loading || !st.calc) return <div className="xp-loading muted">Loading…</div>;
  const m = wbSheetModel({ doc: flight, aircraft: st.aircraft, pilot: st.pilot, calc: st.calc, route: routeText(flight.route) });
  const legs = st.calc.computed.navlog.legs.length;
  const windsOk = st.weather?.status === 'ok';
  return (
    <div className="xp-doc" data-testid="wb-export" data-ready={st.weatherPending ? 'false' : 'true'} data-verdict={m.verdict}>
      <div className="xp-status no-print">
        <div className="xp-status-row">
          <span className={`chip ${m.verdict === 'pass' ? 'ok' : m.verdict === 'fail' ? 'danger' : 'warn'}`}>{m.verdictText}</span>
          {legs > 0 && (
            <span className={`chip ${st.weatherPending ? '' : windsOk ? 'ok' : 'warn'}`}>
              {st.weatherPending ? 'Loading winds…' : windsOk ? 'Trip fuel with forecast winds' : 'Trip fuel without winds (calm)'}
            </span>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={st.refresh} disabled={st.weatherPending || !legs}>Refresh weather</button>
        </div>
        {m.warnings.length > 0 && <ul className="xp-warnings" data-testid="wb-warnings">{m.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      </div>
      <div className="xp-stage"><WbSheet m={m} /></div>
    </div>
  );
}

function Num({ v, cls = '' }: { v: string; cls?: string }) {
  return <td className={`num ${cls}`}>{v}</td>;
}

function LineRow({ l }: { l: WbLine }) {
  return (
    <>
      <tr className={`wb-row wb-row-${l.kind} ${l.over ? 'over' : ''}`} data-line={l.key}>
        <th scope="row">
          <span className="wb-label">{l.label}</span>
          {l.note && <span className="wb-note">{l.note}</span>}
        </th>
        <Num v={fmtKg(l.massKg)} cls="xp-fill" />
        <Num v={l.kind === 'total' || l.kind === 'empty' ? fmtCg(l.armM) : fmtArm(l.armM)} cls={l.kind === 'total' ? 'xp-fill' : ''} />
        <Num v={fmtMoment(l.momentKgM)} cls="xp-fill" />
      </tr>
      {l.people.map((p, i) => (
        <tr key={i} className="wb-row wb-person">
          <th scope="row" colSpan={1}>
            <span className="wb-person-name xp-fill">{p.role} · {p.name}</span>
            <span className="wb-note">{p.seat}</span>
          </th>
          <td className="num xp-fill">{p.massKg == null ? <span className="need">weight?</span> : fmtKg(p.massKg)}</td>
          <td />
          <td />
        </tr>
      ))}
    </>
  );
}

const tick = (ok: boolean | null | undefined) => (ok == null ? '–' : ok ? 'within' : 'OUTSIDE');

export function WbSheet({ m }: { m: WbSheetModel }) {
  const points: ChartPoint[] = [];
  const to = m.checks.find((c) => c.phase === 'takeoff');
  const ldg = m.checks.find((c) => c.phase === 'landing');
  if (m.zeroFuel && to) points.push({ key: 'zerofuel', label: 'ZFW', point: m.zeroFuel, ok: null });
  if (ldg) points.push({ key: 'landing', label: 'LDG', point: ldg.point, ok: ldg.ok });
  if (to) points.push({ key: 'takeoff', label: 'T/O', point: to.point, ok: to.ok });

  return (
    <section className="xp-sheet wb-sheet" aria-label="Loading sheet">
      <header className="xp-head">
        <h1>LOADING SHEET</h1>
        <div className={`xp-verdict ${m.verdict}`} data-testid="wb-verdict">
          <span className="xp-verdict-mark">{m.verdict === 'pass' ? 'PASS' : m.verdict === 'fail' ? 'FAIL' : 'INCOMPLETE'}</span>
          <span>{m.verdictText}</span>
        </div>
      </header>

      <dl className="xp-fields">
        <div><dt>Date</dt><dd className="xp-fill">{m.date}</dd></div>
        <div><dt>Registration</dt><dd className="xp-fill">{m.registration}</dd></div>
        <div><dt>Aircraft</dt><dd className="xp-fill">{m.makeModel}</dd></div>
        <div><dt>Pilot</dt><dd className="xp-fill">{m.pilot}</dd></div>
        <div className="wide"><dt>Route</dt><dd className="xp-fill">{m.route}</dd></div>
        <div><dt>Category</dt><dd className="xp-fill">{m.categoryLabel}</dd></div>
      </dl>

      <table className="wb-table">
        <colgroup><col /><col className="c-num" /><col className="c-num" /><col className="c-num" /></colgroup>
        <thead>
          <tr><th>Loading {m.registration}</th><th>Weight (kg)</th><th>Arm (m)</th><th>Moment (kg·m)</th></tr>
        </thead>
        <tbody>
          {m.lines.map((l) => <LineRow key={l.key} l={l} />)}
        </tbody>
        <tbody className="wb-totals">
          <LineRow l={m.takeoff} />
          <LineRow l={m.burn} />
          <LineRow l={m.landing} />
        </tbody>
      </table>
      <p className="xp-small">Arm of a total = centre of gravity, m aft of the datum{m.datum ? ` (${m.datum.toLowerCase()})` : ''}. Take-off with the fuel on board at block-off; landing after the taxi allowance and trip fuel.</p>

      <div className="wb-checks">
        {m.checks.map((c) => (
          <div key={c.phase} className={`wb-check ${c.ok ? 'ok' : 'bad'}`} data-phase={c.phase}>
            <div className="wb-check-head"><span>{c.label}</span><b>{c.ok ? 'WITHIN LIMITS' : 'OUTSIDE LIMITS'}</b></div>
            <div className="wb-check-body xp-fill">
              {fmtKg(c.point.massKg)} kg · CG {fmtCg(c.point.armM)} m · {fmtMoment(c.point.momentKgM)} kg·m
            </div>
            <div className="wb-check-cats">
              <span className={c.normal.inEnvelope && c.normal.massOk ? '' : 'bad'}>Normal: {tick(c.normal.inEnvelope && c.normal.massOk)}</span>
              {c.utility && <span className={c.utility.inEnvelope && c.utility.massOk ? '' : 'bad'}>Utility: {tick(c.utility.inEnvelope && c.utility.massOk)}</span>}
            </div>
          </div>
        ))}
      </div>

      {m.envelopes.length > 0 && (
        <figure className="wb-figure">
          <figcaption>CENTRE OF GRAVITY MOMENT ENVELOPE</figcaption>
          <EnvelopeChart envelopes={m.envelopes} points={points} />
          <div className="wb-legend">
            <span><i className="lg-to" /> Take-off</span>
            <span><i className="lg-ldg" /> Landing</span>
            <span><i className="lg-burn" /> Fuel burn</span>
            <span><i className="lg-zf" /> Zero fuel</span>
            {m.envelopes.some((e) => e.cgOutline) && <span><i className="lg-cg" /> CG limits (AFM)</span>}
          </div>
        </figure>
      )}

      <div className="xp-notes">
        {m.limits.length > 0 && <p><b>Limits:</b> {m.limits.join(' · ')}</p>}
        {m.weighing && <p><b>Empty mass:</b> {m.weighing}</p>}
        {m.warnings.length > 0 && <ul>{m.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      </div>

      <footer className="xp-sign">
        <span>DATE <b className="xp-fill">{m.date}</b></span>
        <span>REGISTR <b className="xp-fill">{m.registration}</b></span>
        <span>PILOT <b className="xp-fill">{m.pilot}</b></span>
        <span className="sign">SIGN</span>
        <span className="xp-form">MD 4.3</span>
      </footer>
    </section>
  );
}
