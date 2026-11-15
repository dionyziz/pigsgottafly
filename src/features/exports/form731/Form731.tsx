// Form 731 (trn-docs/Form_731.pdf), filled: landscape A4, positions measured from the original (mm).
import './form731.css';
import { form731Model, ROWS_PER_SHEET, type Form731Row } from './model';
import type { FormExportProps } from './common';
import { FormWarnings } from './FormWarnings';

export function Form731(props: FormExportProps) {
  const m = form731Model(props);
  return (
    <div className="pgf-forms" data-testid="form731">
      <FormWarnings warnings={m.warnings} />
      {m.sheets.map((rows, i) => (
        <Sheet key={i} rows={rows} m={m} index={i} />
      ))}
    </div>
  );
}

function Sheet({ rows, m, index }: { rows: Form731Row[]; m: ReturnType<typeof form731Model>; index: number }) {
  const blanks = Array.from({ length: ROWS_PER_SHEET - rows.length }, (_, k) => index * ROWS_PER_SHEET + rows.length + k + 1);
  return (
    <section className="pgf-sheet f731-sheet" aria-label={`Form 731, sheet ${index + 1} of ${m.sheets.length}`}>
      <h1 className="f731-title">OFFICIAL STATEMENT OF PERSONS BOARDING PRIVATE AIRCRAFTS</h1>
      <p className="f731-to">
        TO: HELLENIC CIVIL AVIATION AUTHORITY/AIRPORT <Blank w={68} value={m.airport} data-field="airport" /> DATE{' '}
        <Blank w={74} value={m.date} data-field="date" />
      </p>
      <p className="f731-decl">
        We, the undersigned on our own responsibility&nbsp; and being fully aware&nbsp; of the sanctions stipulated by Law 1599/1986, declare solemly that we are fully aware
        <br />
        that the flight on which we are boarding, operated by aircraft with registration <Blank w={50} value={m.registration} data-field="registration" />
        &nbsp; and operating the route <Blank w={37} value={m.route} data-field="route" /> ,
        <br />
        is not a commercial flight and no fare (fee) has been paid for the afore mentioned transport.
      </p>
      <table className="f731-table">
        <colgroup>
          <col style={{ width: '8.6mm' }} />
          <col style={{ width: '62.1mm' }} />
          <col style={{ width: '65.1mm' }} />
          <col style={{ width: '35mm' }} />
          <col style={{ width: '65mm' }} />
          <col style={{ width: '32.5mm' }} />
        </colgroup>
        <thead>
          <tr>
            <th>No</th>
            <th>NAME AND SURNAME</th>
            <th>
              Relation to the person/entity operating the
              <br />
              aircraft *
            </th>
            <th>ID/Passport</th>
            <th>Contact details</th>
            <th>Signature</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.no} data-role={r.role}>
              <td className="f731-no">{r.no}.</td>
              <td className="pgf-fill" data-field="name">{r.name}</td>
              <td className="pgf-fill" data-field="relation">{r.relation}</td>
              <td className="pgf-fill" data-field="id">{r.idPassport}</td>
              <td className="pgf-fill" data-field="contact">{r.contact}</td>
              <td />
            </tr>
          ))}
          {blanks.map((no) => (
            <tr key={no}>
              <td className="f731-no">{no}.</td>
              <td /><td /><td /><td /><td />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="f731-guide">
        <b>Official Statement Guidelines</b>
        <div className="f731-guide-a">
          a.&nbsp;&nbsp; This form must be submitted by the Pilot in Command to the HCAA/Airport Office (wherever applicable)
          <br />
          <span className="f731-indent">otherwise to&nbsp; the Airport Manager Office for validation before flight departure</span>
        </div>
        <div className="f731-guide-b">b.(*) In field “Relation to the person/entity) “Aeroclub members must additionally state their Aeroclub Code Number</div>
      </div>
      <div className="f731-pic">The Pilot in Command</div>
      <div className="f731-verified">It is verified by</div>
      <div className="f731-pic-name pgf-fill" data-field="pic">{m.picName}</div>
      <div className="f731-sig">(Fullname-signature)</div>
      <div className="f731-formno">FORM&nbsp; 731</div>
    </section>
  );
}

function Blank({ w, value, ...rest }: { w: number; value: string; 'data-field'?: string }) {
  return (
    <span className="pgf-blank" style={{ minWidth: `${w}mm` }} {...rest}>
      <span className="pgf-fill">{value || ' '}</span>
    </span>
  );
}
