// Export (d): ICAO 2012 flight plan. The FPL message ready to paste into AFTN / the ARO (copy
// button, multi-line or one line) and the ICAO flight plan form filled in, A4 portrait.
//
// Usage (ExportPage): <FplExport flight={flight} />. The aircraft is loaded from the hangar, the
// pilot comes from the session, EET from the navlog with live winds aloft, endurance from the
// fuel plan (fuel on board at the planning burn).
import { useMemo, useState, type ReactNode } from 'react';
import type { Flight } from '../../../shared';
import { usePilot } from '../../../app/session';
import { buildFpl, oneLine, MISSING, type FplOptions, type FplResult } from './fpl';
import { fplInputFrom } from './input';
import { useFplData } from './useFplData';
import './fpl.css';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function FplExport({ flight }: { flight: Flight }) {
  const pilot = usePilot();
  const data = useFplData(flight, pilot);
  const [opts, setOpts] = useState<Required<FplOptions>>({ includeItem19: false, regInItem18: false, pointNamesInRemarks: true, phoneIn: 'rmk' });
  const fpl = useMemo(
    () => buildFpl(fplInputFrom({ flight, aircraft: data.aircraft, pilot, navlog: data.navlog, fuel: data.fuel, options: opts })),
    [flight, data.aircraft, data.navlog, data.fuel, pilot, opts],
  );
  const [copied, setCopied] = useState<'' | 'lines' | 'one' | 'error'>('');
  const copy = async (kind: 'lines' | 'one') => {
    const ok = await copyText(kind === 'one' ? oneLine(fpl) : fpl.message);
    setCopied(ok ? kind : 'error');
    window.setTimeout(() => setCopied(''), 2000);
  };

  const loading = data.aircraftLoading || data.weatherLoading;
  const notes: string[] = [];
  if (!flight.aircraftId) notes.push('No aircraft chosen for this flight: items 7, 9, 10, 15 and 19 need one.');
  else if (!data.aircraftLoading && !data.aircraft) notes.push('The flight’s aircraft is no longer in the hangar.');
  if (data.weather && data.weather.status !== 'ok' && data.weather.message) notes.push(`Winds: ${data.weather.message}. EET computed with calm wind where missing.`);
  if (data.navlog && data.navlog.legs.some((l) => l.windMissing) && data.weather?.status === 'ok') notes.push('No wind forecast for some legs: EET computed with calm wind there.');

  return (
    <div className="fpl-export" data-testid="fpl-export">
      <div className="fpl-panel no-print">
        <div className="fpl-panel-head">
          <div>
            <div className="fpl-panel-title">FPL message</div>
            <div className="fpl-panel-sub">
              ICAO 2012 format (Doc 4444 App. 2), {fpl.lines.length} lines of at most 69 characters.
              {loading ? ' Computing EET…' : data.weather?.status === 'ok' && data.weather.message ? ` Winds: ${data.weather.message}.` : ''}
            </div>
            <div className="fpl-panel-sub" data-testid="fpl-altn-rmk">
              {flight.options.alternates?.length ? `Alternates: ${flight.options.alternates.join(', ')}.` : 'No alternate.'}
              {flight.options.remarks?.trim() ? ` Remarks: ${flight.options.remarks.trim()}.` : ''}
              {' '}Set alternates and remarks under “Flight plan” in the flight editor.
            </div>
          </div>
          <span className="spacer" />
          <button className="primary" onClick={() => copy('lines')} data-testid="fpl-copy" disabled={loading}>
            {copied === 'lines' ? 'Copied' : 'Copy message'}
          </button>
          <button onClick={() => copy('one')} disabled={loading}>{copied === 'one' ? 'Copied' : 'Copy as one line'}</button>
        </div>
        {copied === 'error' && <div className="fpl-note fpl-danger">Copy failed: select the text and copy it by hand.</div>}
        <pre className={`fpl-message${loading ? ' fpl-loading' : ''}`} data-testid="fpl-message" aria-busy={loading}>{fpl.message}</pre>
        <div className="fpl-options">
          <label title="Item 19 stays with the ARO and is not part of the AFTN FPL message. Add it only for an ARO or web form that asks for the whole form as text.">
            <input type="checkbox" checked={opts.includeItem19} onChange={(e) => setOpts({ ...opts, includeItem19: e.target.checked })} /> Append item 19 (ARO / web-form variant, not for AFTN)
          </label>
          <label title="Doc 4444 App. 2 asks for REG/ only when the registration differs from item 7.">
            <input type="checkbox" checked={opts.regInItem18} onChange={(e) => setOpts({ ...opts, regInItem18: e.target.checked })} /> REG/ in item 18
          </label>
          <label><input type="checkbox" checked={opts.pointNamesInRemarks} onChange={(e) => setOpts({ ...opts, pointNamesInRemarks: e.target.checked })} /> Point names in RMK/</label>
          <label>
            PIC phone in{' '}
            <select value={opts.phoneIn} onChange={(e) => setOpts({ ...opts, phoneIn: e.target.value as 'rmk' | 'n' })}>
              <option value="rmk">item 18 RMK/</option>
              <option value="n">item 19 N/</option>
            </select>
          </label>
        </div>
        {(notes.length > 0 || fpl.warnings.length > 0) && (
          <div className={`fpl-note ${fpl.complete ? 'fpl-warn' : 'fpl-danger'}`} role="note" data-testid="fpl-warnings">
            <strong>{fpl.complete ? 'Check before filing:' : `Incomplete: fields marked ${MISSING} need data.`}</strong>
            <ul>
              {[...notes, ...fpl.warnings].map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>
      <FplForm fpl={fpl} />
      <section className="fpl-sheet fpl-msg-sheet print-only" aria-hidden>
        <header className="fpl-title"><div className="fpl-title-main">FPL MESSAGE</div><div className="fpl-title-sub">{opts.includeItem19 ? 'With item 19 (ARO / web-form variant, not for AFTN)' : 'As filed (AFTN text, items 7–18)'}</div></header>
        <pre className="fpl-message">{fpl.message}</pre>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// The ICAO flight plan form (Doc 4444 Appendix 2, the 2012 form), A4 portrait.

/** Fixed character boxes; value left-aligned, one character per box. */
function Cells({ value, n, label }: { value: string; n: number; label?: string }) {
  const chars = Array.from({ length: n }, (_, i) => value[i] ?? '');
  return (
    <span className="fpl-cells" aria-label={label}>
      {chars.map((c, i) => <span key={i} className={`fpl-cell${c === '?' ? ' fpl-missing' : ''}`}>{c}</span>)}
    </span>
  );
}

const Arrow = () => <span className="fpl-end" aria-hidden>{'<<≡'}</span>;

function Field({ no, label, children, grow }: { no?: string; label: string; children: ReactNode; grow?: boolean }) {
  return (
    <div className={`fpl-field${grow ? ' fpl-grow' : ''}`}>
      <div className="fpl-label">{no && <b>{no}</b>} {label}</div>
      <div className="fpl-value">{children}</div>
    </div>
  );
}

/** A box of item 19 that is struck through when the equipment is not carried. */
function Strike({ letter, on, caption }: { letter: string; on: boolean; caption: string }) {
  return (
    <span className="fpl-strike-wrap">
      <span className="fpl-cap">{caption}</span>
      <span className={`fpl-cell fpl-letter${on ? '' : ' fpl-struck'}`}>{letter}</span>
    </span>
  );
}

function Lines({ text, rows }: { text: string; rows: number }) {
  return (
    <div className="fpl-lines" style={{ minHeight: `${rows * 7}mm` }}>
      <span className="fpl-typed">{text}</span>
    </div>
  );
}

export function FplForm({ fpl }: { fpl: FplResult }) {
  const f = fpl.fields;
  const i19 = f.item19;
  const has = (s: string) => !!s;
  return (
    <section className="fpl-sheet" aria-label="ICAO flight plan form" data-testid="fpl-form">
      <header className="fpl-title">
        <div className="fpl-title-main">FLIGHT PLAN</div>
        <div className="fpl-title-sub">ICAO Doc 4444, Appendix 2</div>
      </header>

      <div className="fpl-row fpl-addr">
        <Field label="PRIORITY"><span className="fpl-fixed">{'<<≡ FF →'}</span></Field>
        <Field label="ADDRESSEE(S)" grow><div className="fpl-blank-line" /><div className="fpl-blank-line" /></Field>
      </div>
      <div className="fpl-row fpl-addr">
        <Field label="FILING TIME"><Cells value="" n={6} /></Field>
        <Field label="ORIGINATOR"><Cells value="" n={8} /></Field>
        <Field label="SPECIFIC IDENTIFICATION OF ADDRESSEE(S) AND / OR ORIGINATOR" grow><div className="fpl-blank-line" /></Field>
      </div>

      <div className="fpl-row">
        <Field no="3" label="MESSAGE TYPE"><span className="fpl-fixed">{'<<≡ (FPL'}</span></Field>
        <Field no="7" label="AIRCRAFT IDENTIFICATION"><span className="fpl-dash">-</span><Cells value={f.item7} n={7} label="Item 7" /></Field>
        <Field no="8" label="FLIGHT RULES"><span className="fpl-dash">-</span><Cells value={f.item8.rules} n={1} /></Field>
        <Field label="TYPE OF FLIGHT"><Cells value={f.item8.type} n={1} /><Arrow /></Field>
      </div>

      <div className="fpl-row">
        <Field no="9" label="NUMBER"><span className="fpl-dash">-</span><Cells value={f.item9.number} n={2} /></Field>
        <Field label="TYPE OF AIRCRAFT"><Cells value={f.item9.type} n={4} label="Item 9 type" /></Field>
        <Field label="WAKE TURBULENCE CAT."><span className="fpl-dash">/</span><Cells value={f.item9.wake} n={1} /></Field>
        <Field no="10" label="EQUIPMENT" grow>
          <span className="fpl-dash">-</span><span className="fpl-typed-box">{f.item10.a}</span>
          <span className="fpl-dash">/</span><span className="fpl-typed-box">{f.item10.b}</span><Arrow />
        </Field>
      </div>

      <div className="fpl-row">
        <Field no="13" label="DEPARTURE AERODROME"><span className="fpl-dash">-</span><Cells value={f.item13.adep} n={4} label="Item 13 ADEP" /></Field>
        <Field label="TIME"><Cells value={f.item13.eobt} n={4} label="EOBT" /><Arrow /></Field>
      </div>

      <div className="fpl-row">
        <Field no="15" label="CRUISING SPEED"><span className="fpl-dash">-</span><Cells value={f.item15.speed} n={5} label="Speed" /></Field>
        <Field label="LEVEL"><Cells value={f.item15.level} n={5} label="Level" /></Field>
        <Field label="ROUTE" grow><span className="fpl-dash">→</span></Field>
      </div>
      <Lines text={f.item15.route} rows={3} />
      <div className="fpl-row-end"><Arrow /></div>

      <div className="fpl-row">
        <Field no="16" label="DESTINATION AERODROME"><span className="fpl-dash">-</span><Cells value={f.item16.ades} n={4} label="ADES" /></Field>
        <Field label="TOTAL EET HR MIN"><Cells value={f.item16.eet} n={4} label="Total EET" /></Field>
        <Field label="ALTN AERODROME"><span className="fpl-dash">→</span><Cells value={f.item16.altn1} n={4} /></Field>
        <Field label="2ND ALTN AERODROME"><span className="fpl-dash">→</span><Cells value={f.item16.altn2} n={4} /><Arrow /></Field>
      </div>

      <div className="fpl-row">
        <Field no="18" label="OTHER INFORMATION" grow><span className="fpl-dash">-</span></Field>
      </div>
      <Lines text={f.item18} rows={4} />
      <div className="fpl-row-end"><span className="fpl-fixed">{')'}</span><Arrow /></div>

      <div className="fpl-supp">SUPPLEMENTARY INFORMATION (NOT TO BE TRANSMITTED IN FPL MESSAGES)</div>

      <div className="fpl-row">
        <Field no="19" label="ENDURANCE HR MIN"><span className="fpl-dash">-E/</span><Cells value={i19.endurance} n={4} label="Endurance" /></Field>
        <Field label="PERSONS ON BOARD"><span className="fpl-dash">→ P/</span><Cells value={i19.persons} n={3} label="Persons on board" /></Field>
        <Field label="EMERGENCY RADIO" grow>
          <span className="fpl-dash">→ R/</span>
          <Strike letter="U" caption="UHF" on={i19.radio.uhf} />
          <Strike letter="V" caption="VHF" on={i19.radio.vhf} />
          <Strike letter="E" caption="ELT" on={i19.radio.elt} />
        </Field>
      </div>

      <div className="fpl-row">
        <Field label="SURVIVAL EQUIPMENT">
          <Strike letter="S" caption="" on={i19.survival.present} /><span className="fpl-dash">/</span>
          <Strike letter="P" caption="POLAR" on={i19.survival.polar} />
          <Strike letter="D" caption="DESERT" on={i19.survival.desert} />
          <Strike letter="M" caption="MARITIME" on={i19.survival.maritime} />
          <Strike letter="J" caption="JUNGLE" on={i19.survival.jungle} />
        </Field>
        <Field label="JACKETS" grow>
          <Strike letter="J" caption="" on={i19.jackets.present} /><span className="fpl-dash">/</span>
          <Strike letter="L" caption="LIGHT" on={i19.jackets.present && i19.jackets.light} />
          <Strike letter="F" caption="FLUORES" on={i19.jackets.present && i19.jackets.fluorescein} />
          <Strike letter="U" caption="UHF" on={i19.jackets.present && i19.jackets.uhf} />
          <Strike letter="V" caption="VHF" on={i19.jackets.present && i19.jackets.vhf} />
        </Field>
      </div>

      <div className="fpl-row">
        <Field label="DINGHIES" grow>
          <Strike letter="D" caption="" on={!!i19.dinghies} /><span className="fpl-dash">/</span>
          <span className="fpl-strike-wrap"><span className="fpl-cap">NUMBER</span><Cells value={i19.dinghies?.number ?? ''} n={2} /></span>
          <span className="fpl-strike-wrap"><span className="fpl-cap">CAPACITY</span><Cells value={i19.dinghies?.capacity ?? ''} n={3} /></span>
          <Strike letter="C" caption="COVER" on={!!i19.dinghies?.covered} />
          <span className="fpl-strike-wrap fpl-grow"><span className="fpl-cap">COLOUR</span><span className="fpl-typed-line">{i19.dinghies?.colour ?? ''}</span></span>
          <Arrow />
        </Field>
      </div>

      <div className="fpl-row">
        <Field label="AIRCRAFT COLOUR AND MARKINGS" grow><span className="fpl-dash">A/</span><span className="fpl-typed-line">{i19.colours}</span></Field>
      </div>
      <div className="fpl-row">
        <Field label="REMARKS" grow>
          <Strike letter="N" caption="" on={has(i19.remarks)} /><span className="fpl-dash">/</span><span className="fpl-typed-line">{i19.remarks}</span><Arrow />
        </Field>
      </div>
      <div className="fpl-row">
        <Field label="PILOT-IN-COMMAND" grow><span className="fpl-dash">C/</span><span className="fpl-typed-line">{i19.pic}</span><span className="fpl-fixed">{')'}</span><Arrow /></Field>
      </div>

      <div className="fpl-row fpl-foot">
        <Field label="FILED BY" grow><div className="fpl-blank-line" /></Field>
        <Field label="ACCEPTED BY" grow><div className="fpl-blank-line" /></Field>
        <Field label="ADDITIONAL INFORMATION" grow><div className="fpl-blank-line" /></Field>
      </div>
      <div className="fpl-row fpl-reserved">
        <Field label="SPACE RESERVED FOR ADDITIONAL REQUIREMENTS" grow><div className="fpl-blank-box" /></Field>
      </div>
    </section>
  );
}
