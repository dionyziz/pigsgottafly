// General Declaration (ICAO Annex 9 Appendix 1, club form MD 4.7), filled: one portrait A4 page
// laid out like the declaration the pilot uses: header lines (label, then the value in bold), the
// boxed flight routing (origin ⇩ destination with the PIC), passengers on this stage, the
// Declaration of Health struck through "NIL", the declaration with the PIC's e-signature and the
// footnotes. The PDF e-mailed to HCAA (api/_lib/formPdf.ts genDecPdf) has the same layout.
import './gendec.css';
import { FormWarnings } from '../form731/FormWarnings';
import { Signature, type ShownSignature } from '../form731/Form731';
import { GENDEC_DISINSECT_CONT, GENDEC_DISINSECT_LINES, GENDEC_HEALTH_CONT, GENDEC_HEALTH_LINES } from '../../../shared/forms';
import type { FormExportProps } from '../form731/common';
import { genDecModel, ROUTING_ROWS } from './model';
import type { ReactNode } from 'react';

const DOTS = ' .'.repeat(120);
/** Size of the Declaration of Health box (mm): the NIL strike runs corner to corner. */
const HEALTH_W = 110;
const HEALTH_H = 74;

/**
 * `signature`: the PIC's signature on the current version (GET /flights/:id/forms
 * gendec.picSignature), drawn on the signature line as on Form 731 and in the PDF sent to HCAA.
 */
export function GenDec(props: FormExportProps & { panel?: ReactNode; signature?: ShownSignature | null }) {
  const m = genDecModel(props);
  const [origin, dest] = m.routing;
  const rows: { place: ReactNode; crew: string; field?: string }[] = [];
  if (origin) rows.push({ place: origin.place, crew: origin.crew, field: 'origin' });
  if (dest) rows.push({ place: <DownArrow />, crew: '' }, { place: dest.place, crew: '', field: 'destination' });
  while (rows.length < ROUTING_ROWS) rows.push({ place: '', crew: '' });
  return (
    <div className="pgf-forms" data-testid="gendec">
      {props.panel}
      <FormWarnings warnings={m.warnings} fixes={m.fixes} />
      <section className="pgf-sheet gd-sheet" aria-label="General Declaration">
        <h1 className="gd-title">GENERAL DECLARATION</h1>
        <div className="gd-sub">(OUTWARD/INWARD)</div>

        <div className="gd-fields">
          <div className="gd-f">Operator: <Val v={m.operator} field="operator" /></div>
          <div className="gd-f gd-f-split">
            <span>Marks of Nationality and Registration: <Val v={m.registration} field="registration" /></span>
            <span className="gd-right">
              <span>Flight No.: <Val v={m.flightNo} field="flightNo" /></span>
              <span>Date: <Val v={m.date} field="date" /></span>
            </span>
          </div>
          <div className="gd-f gd-f-split gd-f-places">
            <span><span className="gd-placef">Departure from: <Val v={m.departure} field="departure" /><small>(Place)</small></span></span>
            <span className="gd-right"><span className="gd-placef">Arrival at: <Val v={m.arrival} field="arrival" /><small>(Place)</small></span></span>
          </div>
        </div>

        <div className="gd-box">
          <div className="gd-routing-head">
            <div className="gd-h2">FLIGHT ROUTING</div>
            <div>(“Place” Column always to list origin every en-route stop and destination)</div>
          </div>
          <div className="gd-body">
            <table className="gd-routing">
              <colgroup><col className="gd-c-place" /><col /></colgroup>
              <thead><tr><th>PLACE</th><th>NAMES OF CREW*</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="gd-place-col pgf-fill" data-field={r.field ? 'place' : undefined} data-end={r.field}>{r.place}</td>
                    <td className="gd-crew-col pgf-fill" data-field={r.crew ? 'crew' : undefined}>{r.crew}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="gd-pax">
              <div className="gd-pax-head">NUMBER OF PASSENGERS<br />ON THIS STAGE**</div>
              <div className="gd-pax-body">
                <div><i className="gd-u">Departure place:</i></div>
                <PaxLine label="Embarking" v={m.embarking} field="embarking" />
                <PaxLine label="Through on same flight" v={m.throughDeparture} field="throughDep" />
                <div className="gd-gap" />
                <div><i className="gd-u">Arrival place:</i></div>
                <PaxLine label="Disembarking" v={m.disembarking} field="disembarking" />
                <PaxLine label="Through on same flight" v={m.throughArrival} field="throughArr" />
              </div>
            </div>

            <div className="gd-health" style={{ width: `${HEALTH_W}mm`, height: `${HEALTH_H}mm` }}>
              <div className="gd-center">DECLARATION OF HEALTH</div>
              <Lines lines={GENDEC_HEALTH_LINES} />
              <div className="gd-dots">{GENDEC_HEALTH_CONT}{DOTS}</div>
              <div className="gd-dots">{DOTS.slice(1)}</div>
              <div className="gd-gap-s" />
              <Lines lines={GENDEC_DISINSECT_LINES} />
              <div className="gd-dots">{GENDEC_DISINSECT_CONT}{DOTS}</div>
              <div className="gd-dots">{DOTS.slice(1)}</div>
              <div className="gd-signed">
                Signed, if required, with time and date <span className="gd-signed-line" />
              </div>
              <div className="gd-concerned">Crew member concerned</div>
              <svg className="gd-nil" viewBox={`0 0 ${HEALTH_W} ${HEALTH_H}`} aria-label="NIL" data-testid="gendec-nil">
                <line x1={2} y1={HEALTH_H - 2} x2={HEALTH_W - 2} y2={2} />
                {/* written level, sitting on the middle of the stroke, as a pen would */}
                <text x={HEALTH_W / 2} y={HEALTH_H / 2 + 2} textAnchor="middle">NIL</text>
              </svg>
            </div>
            <div className="gd-official">FOR OFFICIAL USE ONLY</div>
          </div>
        </div>

        <p className="gd-declare">
          I declare that all statements and particulars contained in this General Declaration, and in any supplementary forms required to be presented with
          this General Declaration, are complete, exact and true to the best of my knowledge and that all through passengers will continue/have continued on
          the flight.
        </p>
        <div className="gd-signature">
          Signature<span className="gd-sigline">{props.signature && <span className="gd-pic-signature"><Signature s={props.signature} size={4.6} /></span>}</span>
        </div>
        <div className="gd-agent">Authorized Agent or Pilot-in-Command</div>

        <div className="gd-foot">
          <div>* To be completed when required by the State.</div>
          <div>** Not to be completed when passenger manifests are presented and to be completed only when required by the State.</div>
        </div>
      </section>
    </div>
  );
}

/** ⇩ drawn as an outlined arrow (the glyph is missing from many fonts); same shape as in the PDF. */
function DownArrow() {
  return (
    <svg className="gd-arrow" viewBox="0 0 6 5" role="img" aria-label="⇩" data-testid="gendec-arrow">
      <path d="M2 0.2H4V2.4H5.4L3 4.8L0.6 2.4H2Z" />
    </svg>
  );
}

function Val({ v, field }: { v: string; field: string }) {
  return <b className="gd-val pgf-fill" data-field={field}>{v}</b>;
}

function PaxLine({ label, v, field }: { label: string; v: number; field: string }) {
  return (
    <div className="gd-pax-line">
      <span>{label}</span>
      <span className="gd-pax-fill pgf-fill" data-field={field}>{v}</span>
    </div>
  );
}

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <div>
      {lines.map((l) => (
        <span className="gd-jl" key={l}>
          {l}
        </span>
      ))}
    </div>
  );
}
