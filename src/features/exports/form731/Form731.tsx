// Form 731 (trn-docs/Form_731.pdf), filled: landscape A4, positions measured from the original (mm).
import './form731.css';
import { form731Model, ROWS_PER_SHEET, type Form731Row } from './model';
import type { FormExportProps } from './common';
import { FormWarnings } from './FormWarnings';
import { signatureName } from '../../../shared/forms';
import { transliterate } from '../../../shared/translit';
import type { ReactNode } from 'react';

/** A signature on the current version of the form: the signer's name and when (epoch ms). */
export interface ShownSignature { name: string; signedAt: number }

export function Form731(props: FormExportProps & { signatures?: Record<string, ShownSignature>; panel?: ReactNode }) {
  const m = form731Model(props);
  return (
    <div className="pgf-forms print-sheet-page" data-testid="form731">
      {props.panel}
      <FormWarnings warnings={m.warnings} fixes={m.fixes} />
      {m.sheets.map((rows, i) => (
        <Sheet key={i} rows={rows} m={m} index={i} signatures={props.signatures ?? {}} />
      ))}
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');
function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}

/** "D. Zindros" in the handwriting font over a faint Pig's Gotta Fly mark, with when it was signed. */
export function Signature({ s, size = 4.6 }: { s: ShownSignature; size?: number }) {
  return (
    <span className="pgf-signature-wrap" data-testid="signature">
      <span className="pgf-signature-mark" aria-hidden="true"><img src="/icon.svg" alt="" /></span>
      <span className="pgf-signature" style={{ fontSize: `${size}mm` }}>{transliterate(signatureName(s.name), { keepCase: true })}</span>
      <span className="pgf-signature-when">Electronically signed {stamp(s.signedAt)}</span>
    </span>
  );
}

function Sheet({ rows, m, index, signatures }: { rows: Form731Row[]; m: ReturnType<typeof form731Model>; index: number; signatures: Record<string, ShownSignature> }) {
  const picKey = rows.find((r) => r.role === 'PIC')?.key ?? 'PIC';
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
              <td data-field="signature">{signatures[r.key] && <Signature s={signatures[r.key]} size={3.8} />}</td>
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
      {signatures[picKey] && <div className="f731-pic-signature"><Signature s={signatures[picKey]} /></div>}
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
