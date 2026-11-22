// The FPL message for AFTN / EuroFPL and the filled ICAO form. EET comes from the navlog with live
// winds aloft, endurance from the fuel plan (fuel on board at the planning burn).
import '../form731/forms.css';
import './fpl.css';

import { useMemo, useState } from 'react';

import type { Flight } from '../../../shared';
import { Panel } from '../../../ui';
import type { Fix } from '../fix';
import type { ShownSignature } from '../form731/Form731';
import { useFlightPilot } from '../useExportData';
import { ExportWarnings } from '../WarningList';
import { FilingPanel } from './FilingPanel';
import { buildFpl, oneLine } from './fpl';
import { FplForm } from './FplForm';
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
