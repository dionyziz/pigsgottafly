// Laid out like the club's MD 4.3 loading sheet (trn-docs/MD4_3_Loading_Sheet_C172M.pdf), one A4 portrait page.
// Drawn from WbPerfContent so the export page and the PDF e-mailed to the operator (src/pdf/) are the same.
import './xp.css';
import './wb.css';

import type { WbPerfContent, WbPerfRow } from '../../../shared/declarations';
import type { ShownSignature } from '../form731/Form731';
import { type ChartPoint, EnvelopeChart } from './EnvelopeChart';
import { SignLine } from './SignLine';

function Num({ v, cls = '' }: { v: string; cls?: string }) {
  return <td className={`num ${cls}`}>{v}</td>;
}

function Row({ r }: { r: WbPerfRow }) {
  if (r.kind === 'person')
    return (
      <tr className="wb-row wb-person">
        <th scope="row" colSpan={1}>
          <span className="wb-person-name xp-fill">{r.label}</span>
          <span className="wb-note">{r.note}</span>
        </th>
        <td className="num xp-fill">{r.need ? <span className="need">{r.mass}</span> : r.mass}</td>
        <td />
        <td />
      </tr>
    );
  return (
    <tr className={`wb-row wb-row-${r.kind} ${r.over ? 'over' : ''}`} data-line={r.key}>
      <th scope="row">
        <span className="wb-label">{r.label}</span>
        {r.note && <span className="wb-note">{r.note}</span>}
      </th>
      <Num v={r.mass} cls="xp-fill" />
      <Num v={r.arm} cls={r.kind === 'total' ? 'xp-fill' : ''} />
      <Num v={r.moment} cls="xp-fill" />
    </tr>
  );
}

const tick = (ok: boolean) => (ok ? 'within' : 'OUTSIDE');

export function WbSheet({ c, signature }: { c: WbPerfContent; signature?: ShownSignature | null }) {
  const m = c.wb;
  const points: ChartPoint[] = m.chart.points.map((p) => ({
    key: p.key,
    label: p.label,
    point: { massKg: p.mass, momentKgM: p.moment },
    ok: p.ok,
  }));
  const stops = m.checks.some((k) => k.phase === 'stop');

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
        {c.operator && (
          <div>
            <dt>Operator</dt>
            <dd className="xp-fill" data-testid="wb-operator">
              {c.operator}
            </dd>
          </div>
        )}
        <div className={c.operator ? 'wide2' : 'wide'}>
          <dt>Route</dt>
          <dd className="xp-fill">{c.route}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd className="xp-fill">{c.category}</dd>
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
            <th>Loading {c.registration}</th>
            <th>Weight (kg)</th>
            <th>Arm (m)</th>
            <th>Moment (kg·m)</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r, i) => (
            <Row key={i} r={r} />
          ))}
        </tbody>
        <tbody className="wb-totals">
          {m.totals.map((r, i) => (
            <Row key={i} r={r} />
          ))}
        </tbody>
      </table>
      <p className="xp-small">{m.note}</p>

      <div className="wb-checks">
        {m.checks.map((k, i) => (
          <div key={`${k.phase}${i}`} className={`wb-check ${k.ok ? 'ok' : 'bad'}`} data-phase={k.phase}>
            <div className="wb-check-head">
              <span>{k.label}</span>
              <b>{k.ok ? 'WITHIN LIMITS' : 'OUTSIDE LIMITS'}</b>
            </div>
            <div className="wb-check-body xp-fill">{k.text}</div>
            <div className="wb-check-cats">
              {k.categories.map((cat) => (
                <span key={cat.label} className={cat.ok ? '' : 'bad'}>
                  {cat.label}: {tick(cat.ok)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {m.chart.envelopes.length > 0 && (
        <figure className="wb-figure">
          <figcaption>CENTRE OF GRAVITY MOMENT ENVELOPE</figcaption>
          <EnvelopeChart envelopes={m.chart.envelopes} points={points} />
          <div className="wb-legend">
            <span>
              <i className="lg-to" /> Take-off
            </span>
            <span>
              <i className="lg-ldg" /> Landing
            </span>
            {stops && (
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
            {m.chart.envelopes.some((e) => e.cgOutline) && (
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
          DATE <b className="xp-fill">{c.date}</b>
        </span>
        <span>
          REGISTR <b className="xp-fill">{c.registration}</b>
        </span>
        <span>
          PILOT <b className="xp-fill">{c.pilot}</b>
        </span>
        <SignLine signature={signature} />
      </footer>
    </section>
  );
}
