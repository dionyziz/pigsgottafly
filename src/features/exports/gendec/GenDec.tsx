// General Declaration (trn-docs/MD4_7_General_Declaration.pdf), filled: portrait A4, positions
// measured from the original (mm). The club manual's document-control header and page number are
// left out; the form itself (ICAO Annex 9 Appendix 1, MD 4.7) is reproduced.
import './gendec.css';
import { FormWarnings } from '../form731/FormWarnings';
import type { FormExportProps } from '../form731/common';
import { genDecModel } from './model';
import type { ReactNode } from 'react';

const DOTS = ' .'.repeat(120);

export function GenDec(props: FormExportProps & { panel?: ReactNode }) {
  const m = genDecModel(props);
  return (
    <div className="pgf-forms" data-testid="gendec">
      {props.panel}
      <FormWarnings warnings={m.warnings} />
      <section className="pgf-sheet gd-sheet" aria-label="General Declaration">
        <h1 className="gd-title">GENERAL DECLARATION</h1>
        <div className="gd-sub">(OUTWARD/INWARD)</div>

        <div className="gd-line" style={{ top: '24.3mm' }}>
          Operator <Blank w={141.7} value={m.operator} field="operator" />
        </div>
        <div className="gd-line" style={{ top: '28.9mm' }}>
          Marks of Nationality and Registration <Blank w={44} value={m.registration} field="registration" />
          Flight No. <Blank w={20.5} value={m.flightNo} field="flightNo" /> Date <Blank w={5.3} value={m.date[0]} field="dd" />/
          <Blank w={5.3} value={m.date[1]} field="mm" />/<Blank w={10.6} value={m.date[2]} field="yyyy" />
        </div>
        <div className="gd-line" style={{ top: '33.5mm' }}>
          Departure from <Blank w={59} value={m.departure} field="departure" /> Arrival at <Blank w={60} value={m.arrival} field="arrival" />
        </div>
        <div className="gd-place" style={{ left: '78.2mm' }}>(Place)</div>
        <div className="gd-place" style={{ left: '149.4mm' }}>(Place)</div>

        <div className="gd-box">
          <div className="gd-routing-head">
            <div className="gd-h2">FLIGHT ROUTING</div>
            <div>(“Place” Column always to list origin every en-route stop and destination)</div>
          </div>
          <div className="gd-grid">
            <div className="gd-crew">
              <div className="gd-row gd-row-head">
                <div className="gd-place-col">PLACE</div>
                <div className="gd-crew-col">NAMES OF CREW*</div>
              </div>
              {m.routing.map((r, i) => (
                <div className="gd-row" key={i}>
                  <div className="gd-place-col pgf-fill" data-field="place">{r.place}</div>
                  <div className="gd-crew-col pgf-fill" data-field="crew">{r.crew}</div>
                </div>
              ))}
            </div>
            <div className="gd-pax">
              <div className="gd-pax-head">
                NUMBER OF PASSENGERS
                <br />
                ON THIS STAGE**
              </div>
              <div className="gd-pax-body">
                <div>
                  <i className="gd-u">Departure place:</i> <span className="pgf-fill" data-field="depCode">{m.departureCode}</span>
                </div>
                <div className="gd-pax-line">
                  Embarking&nbsp;<Blank w={33} value={String(m.embarking)} field="embarking" left />
                </div>
                <div className="gd-pax-line">
                  Through on same flight&nbsp;<Blank w={15.5} value={String(m.throughDeparture)} field="throughDep" left />
                </div>
                <div className="gd-gap" />
                <div>
                  <i className="gd-u">Arrival place:</i> <span className="pgf-fill" data-field="arrCode">{m.arrivalCode}</span>
                </div>
                <div className="gd-pax-line">
                  Disembarking<Blank w={27} value={String(m.disembarking)} field="disembarking" left />
                </div>
                <div className="gd-pax-line">
                  Through on same flight&nbsp;<Blank w={15.5} value={String(m.throughArrival)} field="throughArr" left />
                </div>
              </div>
            </div>
          </div>
          <div className="gd-grid gd-health-grid">
            <div className="gd-health">
              <div className="gd-center">DECLARATION OF HEALTH</div>
              <Lines
                lines={[
                  'Name and seat number or function of persons on board with illnesses other than',
                  'airsickness or the effects of accidents, who may be suffering from a communicable',
                  'disease (a fever — temperature 38°C/100°F or greater — associated with one or',
                  'more of the following signs or symptoms, e.g. appearing obviously unwell;',
                  'persistent coughing; impaired breathing; persistent diarrhoea; persistent vomiting;',
                  'skin rash; bruising or bleeding without previous injury; or confusion of recent',
                  'onset, increases the likelihood that the person is suffering a communicable disease)',
                  'as well as such cases of illness disembarked during a previous',
                ]}
              />
              <div className="gd-dots">stop{DOTS}</div>
              <div className="gd-dots">{DOTS.slice(1)}</div>
              <Lines
                lines={[
                  'Details of each disinsecting or sanitary treatment (place, date, time, method)',
                  'during the flight. If no disinsecting has been carried out during the flight, give',
                ]}
              />
              <div className="gd-dots">details of most recent disinsecting{DOTS}</div>
              <div className="gd-dots">{DOTS.slice(1)}</div>
              <div className="gd-signed">
                Signed, if required, with time and date <Blank w={41} value="" />
              </div>
              <div className="gd-concerned">Crew member concerned</div>
            </div>
            <div className="gd-official">FOR OFFICIAL USE ONLY</div>
          </div>
          <div className="gd-declare">
            <p className="gd-just">
              <span className="gd-indent" />I declare that all statements and particulars contained in this General Declaration, and in any supplementary forms
              required to be presented with this General Declaration, are complete, exact and true to the best of my knowledge and that all through passengers
              will continue/have continued on the flight.
            </p>
            <div className="gd-signature">
              Signature<span className="gd-sigline" />
            </div>
            <div className="gd-agent">Authorized Agent or Pilot-in-Command</div>
            <div className="gd-pic-name pgf-fill" data-field="pic">{m.picName}</div>
          </div>
        </div>

        <div className="gd-foot" style={{ top: '213.9mm' }}>* To be completed when required by the State.</div>
        <div className="gd-foot" style={{ top: '216.9mm' }}>** Not to be completed when passenger manifests are presented and to be completed only when required by the State.</div>
        <div className="gd-annex">ICAO ANNEX 9 - APPENDIX 1.1</div>
        <div className="gd-md">MD 4.7</div>
      </section>
    </div>
  );
}

function Lines({ lines }: { lines: string[] }) {
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

function Blank({ w, value, field, left }: { w: number; value: string; field?: string; left?: boolean }) {
  return (
    <span className={'pgf-blank' + (left ? ' pgf-blank-left' : '')} style={{ minWidth: `${w}mm` }} data-field={field}>
      <span className="pgf-fill">{value || ' '}</span>
    </span>
  );
}
