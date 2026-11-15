// The editor's left panel: When, Aircraft, Manifest & loading, Fuel, Take-off & landing, NOTAMs, ATC,
// Flight plan (alternates, remarks), Exports. Numbers come from useFlightCalc() (src/calc); edits
// go through useEditor().update().
import { EXPORT_KINDS, EXPORT_LABEL, type ExportKind } from '../../../shared';
import { flightStore } from '../../../data/flightStore';
import { useEditor } from '../state';
import { AircraftSection } from './AircraftSection';
import { AtcSection } from './AtcSection';
import { useFlightCalc } from './calc';
import { FplSection } from './FplSection';
import { FuelSection } from './FuelSection';
import { ManifestSection } from './ManifestSection';
import { NotamSection } from './NotamSection';
import { PerformanceSection } from './PerformanceSection';
import { Chip, Icon, Section } from './ui';
import { WhenSection } from './WhenSection';

const EXPORT_HINT: Record<ExportKind, string> = {
  navlog: 'MD 4.2 sheet',
  form731: 'HCAA persons on board',
  gendec: 'MD 4.7, ICAO Annex 9',
  fpl: 'ICAO FPL for AFTN',
  wb: 'MD 4.3 loading + envelope',
  performance: 'MD 4.4 departure + destination',
  briefing: 'NOTAMs along the route',
};

function ExportsSection() {
  const { flight } = useEditor();
  const { warnings } = useFlightCalc();
  const blocking = warnings.filter((w) => w.level === 'danger').length;
  return (
    <Section id="exports" title="Exports" badge={blocking ? <Chip tone="danger">{blocking} issue{blocking > 1 ? 's' : ''}</Chip> : undefined}>
      <ul className="ep-exports" data-testid="exports">
        {EXPORT_KINDS.map((k) => (
          <li key={k}>
            <a
              href={`/flights/${flight.id}/export/${k}`}
              target="_blank"
              rel="noopener"
              data-testid={`export-${k}`}
              // send pending edits first so the export page loads them
              onClick={() => { void flightStore.flushNow(); }}
            >
              <Icon name="print" />
              <span className="ep-export-label">{EXPORT_LABEL[k]}<span className="muted">{EXPORT_HINT[k]}</span></span>
              <Icon name="external" size={14} />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function FlightPanel() {
  return (
    <div className="ep" data-testid="flight-panel">
      <WhenSection />
      <AircraftSection />
      <ManifestSection />
      <FuelSection />
      <PerformanceSection />
      <NotamSection />
      <AtcSection />
      <FplSection />
      <ExportsSection />
    </div>
  );
}
