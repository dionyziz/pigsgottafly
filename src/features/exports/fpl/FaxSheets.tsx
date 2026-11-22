// The pages of a flight plan faxed to an ATS reporting office (src/shared/fax.ts), printed by the
// server's headless Chromium (src/pdf/main.tsx): a cover page, then for a new plan the ICAO form
// drawn from the filed message, so the office re-keys exactly what was filed.
import type { FplFaxContent } from '../../../shared/fax';
import type { FplResult } from './fpl';
import { FplForm } from './FplForm';
import { parseFplMessage } from './parseFpl';

const TITLE: Record<FplFaxContent['kind'], string> = {
  file: 'FLIGHT PLAN',
  delay: 'DELAY (DLA)',
  cancel: 'CANCELLATION (CNL)',
};

const stampZ = (ms: number) => {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? `${d.toISOString().slice(0, 16).replace('T', ' ')}Z` : '';
};
/** '+302103532635' → '+30 210 3532635' (Greek numbers), else as given. */
const showNumber = (n: string) => n.replace(/^\+30(\d{3})(\d+)$/, '+30 $1 $2');

function Cover({ c, pages }: { c: FplFaxContent; pages: number }) {
  const f = parseFplMessage(c.fpl);
  const dof = /\bDOF\/(\d{6})\b/.exec(f.item18)?.[1] ?? '';
  const reach = [c.from.phone, c.from.email].filter(Boolean).join(' or ');
  const rows: [string, string][] = [
    ['To', `${c.to.unit}, fax ${showNumber(c.to.number)}`],
    ['From', [c.from.name, 'pilot in command'].filter(Boolean).join(', ')],
    ['Phone', c.from.phone],
    ['E-mail', c.from.email],
    ['Sent', stampZ(c.sentAt)],
    [
      'Flight',
      [f.item7, `${f.item13.adep} → ${f.item16.ades}`, `EOBT ${f.item13.eobt}Z`, dof && `DOF ${dof}`]
        .filter(Boolean)
        .join('   '),
    ],
    ['Route', f.item15.route],
    ['Pages', `${pages} (this cover${c.kind === 'file' ? ' and the ICAO flight plan form' : ''})`],
  ];
  return (
    <section className="fax-sheet" data-testid="fax-cover">
      <header className="fax-head">
        <div className="fax-word">FAX</div>
        <div className="fax-title">{TITLE[c.kind]}</div>
      </header>
      <table className="fax-rows">
        <tbody>
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="fax-sub">{c.kind === 'file' ? 'FPL message' : 'Message'}</div>
      <pre className="fax-message" data-testid="fax-message">
        {c.message}
      </pre>
      {c.kind !== 'file' && (
        <>
          <div className="fax-sub">Flight plan it refers to</div>
          <pre className="fax-message fax-message-sm">{c.fpl}</pre>
        </>
      )}
      {reach && <div className="fax-ack">Please acknowledge receipt to {reach}.</div>}
    </section>
  );
}

export function FaxSheets({ c }: { c: FplFaxContent }) {
  const fields = parseFplMessage(c.fpl);
  const fpl: FplResult = {
    fields,
    message: c.fpl,
    lines: c.fpl.split('\n'),
    complete: true,
    warnings: [],
    fixes: {},
  };
  const pages = c.kind === 'file' ? 2 : 1;
  return (
    <div className="page export-page">
      <div className="fpl-export print-sheet-page" data-testid="fax-sheets">
        <Cover c={c} pages={pages} />
        {c.kind === 'file' && <FplForm fpl={fpl} addressees={c.addresses} signature={c.signature} />}
      </div>
    </div>
  );
}
