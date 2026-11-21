// Export (d): ICAO 2012 flight plan. The FPL message ready to paste into AFTN / EuroFPL (copy
// button, multi-line or one line) and the ICAO flight plan form filled in, one A4 portrait page,
// signed by the PIC in the FILED BY box.
//
// Usage (ExportPage): <FplExport flight={flight} />. The aircraft is loaded from the hangar, the
// pilot comes from the session, EET from the navlog with live winds aloft, endurance from the
// fuel plan (fuel on board at the planning burn).
import '../form731/forms.css';
import './fpl.css';

import { type ReactNode, useMemo, useState } from 'react';

import type { Flight } from '../../../shared';
import { Panel } from '../../../ui';
import type { Fix } from '../fix';
import { type ShownSignature, Signature } from '../form731/Form731';
import { useFlightPilot } from '../useExportData';
import { ExportWarnings } from '../WarningList';
import { FilingPanel } from './FilingPanel';
import { buildFpl, type FplResult, oneLine } from './fpl';
import { fplInputFrom } from './input';
import { useFplData } from './useFplData';

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
  const pilot = useFlightPilot(flight);
  const data = useFplData(flight, pilot);
  const fpl = useMemo(
    () => buildFpl(fplInputFrom({ flight, aircraft: data.aircraft, pilot, navlog: data.navlog, fuel: data.fuel })),
    [flight, data.aircraft, data.navlog, data.fuel, pilot],
  );
  const [copied, setCopied] = useState<'' | 'lines' | 'one' | 'error'>('');
  const [addresses, setAddresses] = useState<string[]>([]);
  // the PIC signs the plan as filed by them, when the page is generated
  const [signedAt] = useState(() => Date.now());
  const signature: ShownSignature | null = pilot.fullName.trim() ? { name: pilot.fullName, signedAt } : null;
  const copy = async (kind: 'lines' | 'one') => {
    const ok = await copyText(kind === 'one' ? oneLine(fpl) : fpl.message);
    setCopied(ok ? kind : 'error');
    window.setTimeout(() => setCopied(''), 2000);
  };

  const loading = data.aircraftLoading || data.weatherLoading;
  const warnings: { text: string; fix?: Fix }[] = [];
  if (!flight.aircraftId)
    warnings.push({ text: 'No aircraft chosen for this flight.', fix: { kind: 'flight', focus: 'aircraft' } });
  else if (!data.aircraftLoading && !data.aircraft)
    warnings.push({
      text: 'The flight’s aircraft is no longer in the hangar.',
      fix: { kind: 'flight', focus: 'aircraft' },
    });
  for (const w of fpl.warnings) warnings.push({ text: w, fix: fpl.fixes[w] });

  return (
    <div className="fpl-export print-sheet-page" data-testid="fpl-export">
      <Panel
        title="FPL message"
        className="fpl-panel"
        actions={
          <>
            <button className="primary" onClick={() => copy('lines')} data-testid="fpl-copy" disabled={loading}>
              {copied === 'lines' ? 'Copied' : 'Copy message'}
            </button>
            <button onClick={() => copy('one')} disabled={loading}>
              {copied === 'one' ? 'Copied' : 'Copy as one line'}
            </button>
          </>
        }
      >
        {copied === 'error' && <div className="form-error">Copy failed: select the text and copy it by hand.</div>}
        <pre className={`fpl-message${loading ? ' fpl-loading' : ''}`} data-testid="fpl-message" aria-busy={loading}>
          {fpl.message}
        </pre>
        <ExportWarnings
          warnings={warnings}
          aircraftId={flight.aircraftId}
          classify={false}
          title={fpl.complete ? 'Check before filing' : 'Incomplete'}
          level={fpl.complete ? 'warn' : 'danger'}
          testId="fpl-warnings"
        />
      </Panel>
      <FilingPanel
        flight={flight}
        message={fpl.message}
        complete={fpl.complete && !loading}
        onAddresses={setAddresses}
      />
      <FplForm fpl={fpl} addressees={addresses} signature={signature} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// The ICAO flight plan form (Doc 4444 Appendix 2, the 2012 form), one A4 portrait page.

/** Fixed character boxes; value left-aligned, one character per box. */
function Cells({ value, n, label, small }: { value: string; n: number; label?: string; small?: boolean }) {
  const chars = Array.from({ length: Math.max(n, value.length) }, (_, i) => value[i] ?? '');
  return (
    <span className={`fpl-cells${small ? ' fpl-cells-sm' : ''}`} aria-label={label}>
      {chars.map((c, i) => (
        <span key={i} className={`fpl-cell${c === '?' ? ' fpl-missing' : ''}`}>
          {c}
        </span>
      ))}
    </span>
  );
}

const Arrow = () => (
  <span className="fpl-end" aria-hidden>
    {'<<≡'}
  </span>
);
const Dash = ({ t }: { t: string }) => <span className="fpl-dash">{t}</span>;

function Field({
  no,
  label,
  children,
  grow,
  className,
}: {
  no?: string;
  label: string;
  children: ReactNode;
  grow?: boolean;
  className?: string;
}) {
  return (
    <div className={`fpl-field${grow ? ' fpl-grow' : ''}${className ? ` ${className}` : ''}`}>
      <div className="fpl-label">
        {no && <b>{no}</b>} {label}
      </div>
      <div className="fpl-value">{children}</div>
    </div>
  );
}

/** A pre-printed letter of item 19, crossed out (X) when the equipment is not carried. */
function Strike({ letter, on, caption }: { letter: string; on: boolean; caption: string }) {
  return (
    <span className="fpl-strike-wrap">
      <span className="fpl-cap">{caption}</span>
      <span className={`fpl-cell fpl-letter${on ? '' : ' fpl-struck'}`} data-struck={on ? undefined : 'true'}>
        {letter}
      </span>
    </span>
  );
}

function Lines({ text, rows }: { text: string; rows: number }) {
  return (
    <div className="fpl-lines" style={{ minHeight: `${rows * 6}mm` }}>
      <span className="fpl-typed">{text}</span>
    </div>
  );
}

/** AFTN addressees: two lines of seven 8-letter groups, as on the form. */
function Addressees({ a }: { a: string[] }) {
  const groups = Array.from({ length: 14 }, (_, i) => a[i] ?? '');
  return (
    <div className="fpl-addr-grid" data-testid="fpl-form-addressees">
      {[0, 1].map((row) => (
        <div key={row} className="fpl-addr-row">
          {groups.slice(row * 7, row * 7 + 7).map((g, i) => (
            <Cells key={i} value={g} n={8} small />
          ))}
          {row === 1 && <Arrow />}
        </div>
      ))}
    </div>
  );
}

export function FplForm({
  fpl,
  addressees = [],
  signature = null,
}: {
  fpl: FplResult;
  addressees?: string[];
  signature?: ShownSignature | null;
}) {
  const f = fpl.fields;
  const i19 = f.item19;
  return (
    <section className="fpl-sheet" aria-label="ICAO flight plan form" data-testid="fpl-form">
      <header className="fpl-title">
        <div className="fpl-title-main">FLIGHT PLAN</div>
      </header>

      <div className="fpl-box">
        <div className="fpl-row fpl-addr">
          <Field label="PRIORITY">
            <span className="fpl-fixed">{'<<≡ FF'}</span>
          </Field>
          <Field label="ADDRESSEE(S)" grow>
            <Addressees a={addressees} />
          </Field>
        </div>
        <div className="fpl-row">
          <Field label="FILING TIME">
            <Cells value="" n={6} />
          </Field>
          <Field label="ORIGINATOR">
            <Cells value="" n={8} />
            <Arrow />
          </Field>
        </div>
        <div className="fpl-row">
          <Field label="SPECIFIC IDENTIFICATION OF ADDRESSEE(S) AND / OR ORIGINATOR" grow>
            <div className="fpl-blank-line" />
          </Field>
        </div>
      </div>

      <div className="fpl-box">
        <div className="fpl-row">
          <Field no="3" label="MESSAGE TYPE">
            <span className="fpl-fixed">{'<<≡ (FPL'}</span>
          </Field>
          <Field no="7" label="AIRCRAFT IDENTIFICATION">
            <Dash t="-" />
            <Cells value={f.item7} n={7} label="Item 7" />
          </Field>
          <Field no="8" label="FLIGHT RULES">
            <Dash t="-" />
            <Cells value={f.item8.rules} n={1} />
          </Field>
          <Field label="TYPE OF FLIGHT">
            <Cells value={f.item8.type} n={1} />
            <Arrow />
          </Field>
        </div>

        <div className="fpl-row">
          <Field no="9" label="NUMBER">
            <Dash t="-" />
            <Cells value={f.item9.number} n={2} />
          </Field>
          <Field label="TYPE OF AIRCRAFT">
            <Cells value={f.item9.type} n={4} label="Item 9 type" />
          </Field>
          <Field label="WAKE TURBULENCE CAT.">
            <Dash t="/" />
            <Cells value={f.item9.wake} n={1} />
          </Field>
          <Field no="10" label="EQUIPMENT" grow>
            <Dash t="-" />
            <Cells value={f.item10.a} n={8} label="Item 10a" />
            <Dash t="/" />
            <Cells value={f.item10.b} n={4} label="Item 10b" />
            <Arrow />
          </Field>
        </div>

        <div className="fpl-row">
          <Field no="13" label="DEPARTURE AERODROME">
            <Dash t="-" />
            <Cells value={f.item13.adep} n={4} label="Item 13 ADEP" />
          </Field>
          <Field label="TIME">
            <Cells value={f.item13.eobt} n={4} label="EOBT" />
            <Arrow />
          </Field>
        </div>

        <div className="fpl-row">
          <Field no="15" label="CRUISING SPEED">
            <Dash t="-" />
            <Cells value={f.item15.speed} n={5} label="Speed" />
          </Field>
          <Field label="LEVEL">
            <Cells value={f.item15.level} n={5} label="Level" />
          </Field>
          <Field label="ROUTE" grow>
            <Dash t="→" />
          </Field>
        </div>
        <Lines text={f.item15.route} rows={2} />
        <div className="fpl-row-end">
          <Arrow />
        </div>

        <div className="fpl-row">
          <Field no="16" label="DESTINATION AERODROME">
            <Dash t="-" />
            <Cells value={f.item16.ades} n={4} label="ADES" />
          </Field>
          <Field label="TOTAL EET HR MIN">
            <Cells value={f.item16.eet} n={4} label="Total EET" />
          </Field>
          <Field label="ALTN AERODROME">
            <Dash t="→" />
            <Cells value={f.item16.altn1} n={4} label="Alternate" />
          </Field>
          <Field label="2ND ALTN AERODROME">
            <Dash t="→" />
            <Cells value={f.item16.altn2} n={4} />
            <Arrow />
          </Field>
        </div>

        <div className="fpl-row">
          <Field no="18" label="OTHER INFORMATION" grow>
            <Dash t="-" />
          </Field>
        </div>
        <Lines text={f.item18} rows={3} />
        <div className="fpl-row-end">
          <span className="fpl-fixed">{')'}</span>
          <Arrow />
        </div>
      </div>

      <div className="fpl-supp">SUPPLEMENTARY INFORMATION (NOT TO BE TRANSMITTED IN FPL MESSAGES)</div>

      <div className="fpl-box">
        <div className="fpl-row">
          <Field no="19" label="ENDURANCE HR MIN">
            <Dash t="-E/" />
            <Cells value={i19.endurance} n={4} label="Endurance" />
          </Field>
          <Field label="PERSONS ON BOARD">
            <Dash t="→ P/" />
            <Cells value={i19.persons} n={3} label="Persons on board" />
          </Field>
          <Field label="EMERGENCY RADIO" grow>
            <Dash t="→ R/" />
            <Strike letter="U" caption="UHF" on={i19.radio.uhf} />
            <Strike letter="V" caption="VHF" on={i19.radio.vhf} />
            <Strike letter="E" caption="ELT" on={i19.radio.elt} />
          </Field>
        </div>

        <div className="fpl-row">
          <Field label="SURVIVAL EQUIPMENT">
            <Strike letter="S" caption="" on={i19.survival.present} />
            <Dash t="/" />
            <Strike letter="P" caption="POLAR" on={i19.survival.polar} />
            <Strike letter="D" caption="DESERT" on={i19.survival.desert} />
            <Strike letter="M" caption="MARITIME" on={i19.survival.maritime} />
            <Strike letter="J" caption="JUNGLE" on={i19.survival.jungle} />
          </Field>
          <Field label="JACKETS" grow>
            <Strike letter="J" caption="" on={i19.jackets.present} />
            <Dash t="/" />
            <Strike letter="L" caption="LIGHT" on={i19.jackets.present && i19.jackets.light} />
            <Strike letter="F" caption="FLUORES" on={i19.jackets.present && i19.jackets.fluorescein} />
            <Strike letter="U" caption="UHF" on={i19.jackets.present && i19.jackets.uhf} />
            <Strike letter="V" caption="VHF" on={i19.jackets.present && i19.jackets.vhf} />
          </Field>
        </div>

        <div className="fpl-row">
          <Field label="DINGHIES" grow>
            <Strike letter="D" caption="" on={!!i19.dinghies} />
            <Dash t="/" />
            <span className="fpl-strike-wrap">
              <span className="fpl-cap">NUMBER</span>
              <Cells value={i19.dinghies?.number ?? ''} n={2} />
            </span>
            <span className="fpl-strike-wrap">
              <span className="fpl-cap">CAPACITY</span>
              <Cells value={i19.dinghies?.capacity ?? ''} n={3} />
            </span>
            <Strike letter="C" caption="COVER" on={!!i19.dinghies?.covered} />
            <span className="fpl-strike-wrap fpl-grow">
              <span className="fpl-cap">COLOUR</span>
              <span className="fpl-typed-line">{i19.dinghies?.colour ?? ''}</span>
            </span>
            <Arrow />
          </Field>
        </div>

        <div className="fpl-row">
          <Field label="AIRCRAFT COLOUR AND MARKINGS" grow>
            <Dash t="A/" />
            <span className="fpl-typed-line" data-testid="fpl-form-colours">
              {i19.colours}
            </span>
          </Field>
        </div>
        <div className="fpl-row">
          <Field label="REMARKS" grow>
            <Strike letter="N" caption="" on={!!i19.remarks} />
            <Dash t="/" />
            <span className="fpl-typed-line">{i19.remarks}</span>
            <Arrow />
          </Field>
        </div>
        <div className="fpl-row">
          <Field label="PILOT-IN-COMMAND" grow>
            <Dash t="C/" />
            <span className="fpl-typed-line" data-testid="fpl-form-pic">
              {i19.pic}
            </span>
            <span className="fpl-fixed">{')'}</span>
            <Arrow />
          </Field>
        </div>
      </div>

      <div className="fpl-row fpl-foot">
        <Field label="FILED BY" grow className="fpl-filed-by">
          <div className="fpl-sign-box" data-testid="fpl-filed-by">
            {signature && <Signature s={signature} size={4.4} />}
          </div>
        </Field>
        <Field label="ACCEPTED BY" grow>
          <div className="fpl-sign-box" />
        </Field>
        <Field label="ADDITIONAL INFORMATION" grow>
          <div className="fpl-sign-box" />
        </Field>
      </div>
      <div className="fpl-row fpl-reserved">
        <Field label="SPACE RESERVED FOR ADDITIONAL REQUIREMENTS" grow>
          <div className="fpl-blank-box" />
        </Field>
      </div>
    </section>
  );
}
