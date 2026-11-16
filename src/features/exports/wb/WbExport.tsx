// Weight and balance, laid out like the club's MD 4.3 loading sheet
// (trn-docs/MD4_3_Loading_Sheet_C172M.pdf): the loading table (empty, fuel, each station with the
// people in it, baggage), totals at take-off and landing, the CG moment envelope chart with both
// points and the burn line, a pass/fail verdict and the PIC's signature. One A4 portrait page,
// the first page of the "Weight & balance and performance" export (../wbperf).
import { EnvelopeChart, type ChartPoint } from './EnvelopeChart';
import { fmtArm, fmtCg, fmtKg, fmtMoment, type WbLine, type WbSheetModel } from './model';
import { SignLine } from './SignLine';
import type { ShownSignature } from '../form731/Form731';
import './xp.css';
import './wb.css';

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
        <Num
          v={l.kind === 'total' || l.kind === 'empty' ? fmtCg(l.armM) : fmtArm(l.armM)}
          cls={l.kind === 'total' ? 'xp-fill' : ''}
        />
        <Num v={fmtMoment(l.momentKgM)} cls="xp-fill" />
      </tr>
      {l.people.map((p, i) => (
        <tr key={i} className="wb-row wb-person">
          <th scope="row" colSpan={1}>
            <span className="wb-person-name xp-fill">
              {p.role} · {p.name}
            </span>
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

export function WbSheet({ m, signature }: { m: WbSheetModel; signature?: ShownSignature | null }) {
  const points: ChartPoint[] = [];
  const to = m.checks.find((c) => c.phase === 'takeoff');
  const ldg = m.checks.find((c) => c.phase === 'landing');
  if (m.zeroFuel && to) points.push({ key: 'zerofuel', label: 'ZFW', point: m.zeroFuel, ok: null });
  if (ldg) points.push({ key: 'landing', label: 'LDG', point: ldg.point, ok: ldg.ok });
  m.checks
    .filter((c) => c.phase === 'stop')
    .forEach((c, i) =>
      points.push({ key: `stop${i}`, label: c.label.replace(/^Stop /, ''), point: c.point, ok: c.ok }),
    );
  if (to) points.push({ key: 'takeoff', label: 'T/O', point: to.point, ok: to.ok });

  return (
    <section className="xp-sheet wb-sheet" aria-label="Loading sheet">
      <header className="xp-head">
        <h1>LOADING SHEET</h1>
        <div className={`xp-verdict ${m.verdict}`} data-testid="wb-verdict">
          <span className="xp-verdict-mark">
            {m.verdict === 'pass' ? 'PASS' : m.verdict === 'fail' ? 'FAIL' : 'INCOMPLETE'}
          </span>
          <span>{m.verdictText}</span>
        </div>
      </header>

      <dl className="xp-fields">
        <div>
          <dt>Date</dt>
          <dd className="xp-fill">{m.date}</dd>
        </div>
        <div>
          <dt>Registration</dt>
          <dd className="xp-fill">{m.registration}</dd>
        </div>
        <div>
          <dt>Aircraft</dt>
          <dd className="xp-fill">{m.makeModel}</dd>
        </div>
        <div>
          <dt>Pilot</dt>
          <dd className="xp-fill">{m.pilot}</dd>
        </div>
        {m.operator && (
          <div>
            <dt>Operator</dt>
            <dd className="xp-fill" data-testid="wb-operator">
              {m.operator}
            </dd>
          </div>
        )}
        <div className={m.operator ? 'wide2' : 'wide'}>
          <dt>Route</dt>
          <dd className="xp-fill">{m.route}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd className="xp-fill">{m.categoryLabel}</dd>
        </div>
      </dl>

      <table className="wb-table">
        <colgroup>
          <col />
          <col className="c-num" />
          <col className="c-num" />
          <col className="c-num" />
        </colgroup>
        <thead>
          <tr>
            <th>Loading {m.registration}</th>
            <th>Weight (kg)</th>
            <th>Arm (m)</th>
            <th>Moment (kg·m)</th>
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l) => (
            <LineRow key={l.key} l={l} />
          ))}
        </tbody>
        <tbody className="wb-totals">
          {m.totals.map((l) => (
            <LineRow key={l.key} l={l} />
          ))}
        </tbody>
      </table>
      <p className="xp-small">
        Arm of a total = centre of gravity, m aft of the datum{m.datum ? ` (${m.datum.toLowerCase()})` : ''}. Take-off
        with the fuel on board at block-off; landing after the taxi allowance and trip fuel
        {m.checks.some((c) => c.phase === 'stop')
          ? '; each stop: one more taxi allowance, no refuelling, the take-off there with the fuel it landed with'
          : ''}
        .
      </p>

      <div className="wb-checks">
        {m.checks.map((c, i) => (
          <div key={`${c.phase}${i}`} className={`wb-check ${c.ok ? 'ok' : 'bad'}`} data-phase={c.phase}>
            <div className="wb-check-head">
              <span>{c.label}</span>
              <b>{c.ok ? 'WITHIN LIMITS' : 'OUTSIDE LIMITS'}</b>
            </div>
            <div className="wb-check-body xp-fill">
              {fmtKg(c.point.massKg)} kg · CG {fmtCg(c.point.armM)} m · {fmtMoment(c.point.momentKgM)} kg·m
            </div>
            <div className="wb-check-cats">
              <span className={c.normal.inEnvelope && c.normal.massOk ? '' : 'bad'}>
                Normal: {tick(c.normal.inEnvelope && c.normal.massOk)}
              </span>
              {c.utility && (
                <span className={c.utility.inEnvelope && c.utility.massOk ? '' : 'bad'}>
                  Utility: {tick(c.utility.inEnvelope && c.utility.massOk)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {m.envelopes.length > 0 && (
        <figure className="wb-figure">
          <figcaption>CENTRE OF GRAVITY MOMENT ENVELOPE</figcaption>
          <EnvelopeChart envelopes={m.envelopes} points={points} />
          <div className="wb-legend">
            <span>
              <i className="lg-to" /> Take-off
            </span>
            <span>
              <i className="lg-ldg" /> Landing
            </span>
            {m.checks.some((c) => c.phase === 'stop') && (
              <span>
                <i className="lg-stop" /> Stop
              </span>
            )}
            <span>
              <i className="lg-burn" /> Fuel burn
            </span>
            <span>
              <i className="lg-zf" /> Zero fuel
            </span>
            {m.envelopes.some((e) => e.cgOutline) && (
              <span>
                <i className="lg-cg" /> CG limits (AFM)
              </span>
            )}
          </div>
        </figure>
      )}

      <div className="xp-notes">
        {m.limits.length > 0 && (
          <p>
            <b>Limits:</b> {m.limits.join(' · ')}
          </p>
        )}
        {m.weighing && (
          <p>
            <b>Empty mass:</b> {m.weighing}
          </p>
        )}
      </div>

      <footer className="xp-sign">
        <span>
          DATE <b className="xp-fill">{m.date}</b>
        </span>
        <span>
          REGISTR <b className="xp-fill">{m.registration}</b>
        </span>
        <span>
          PILOT <b className="xp-fill">{m.pilot}</b>
        </span>
        <SignLine signature={signature} />
      </footer>
    </section>
  );
}
