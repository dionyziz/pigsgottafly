// The editor's left panel: "Ready to fly" and three stages (ReadinessBar.tsx, UX-PLAN.md):
//   Plan          Route, When, Aircraft, Manifest & loading, Fuel
//   Brief         METAR (near the flight), NOTAMs, Aerodrome hours, Take-off & landing, ATC
//   File & forms  Flight plan (alternates, remarks), Filing, Forms and navlog
// Every section stays mounted (a stage switch keeps their state). Numbers come from useFlightCalc()
// (src/calc); edits go through useEditor().update().
import { flightStore } from '../../../data/flightStore';
import { EXPORT_KINDS, EXPORT_LABEL } from '../../../shared';
import { Icon } from '../../../ui';
import { useEditor } from '../state';
import { AerodromeSection } from './AerodromeSection';
import { AircraftSection } from './AircraftSection';
import { AtcSection } from './AtcSection';
import { FilingSection } from './FilingSection';
import { FplSection } from './FplSection';
import { FuelSection } from './FuelSection';
import { ManifestSection } from './ManifestSection';
import { MetarSection } from './MetarSection';
import { NotamSection } from './NotamSection';
import { PerformanceSection } from './PerformanceSection';
import { ReadinessBar, useStage } from './ReadinessBar';
import { RouteSection } from './RouteSection';
import { Section } from './ui';
import { WhenSection } from './WhenSection';

/** The flight's documents: the navlog to print, and the forms, which are sent and kept electronically. */
function DocumentsSection() {
  const { flight } = useEditor();
  const open = (k: string) => ({
    href: `/flights/${flight.id}/export/${k}`,
    target: '_blank',
    rel: 'noopener',
    // send pending edits first so the export page loads them
    onClick: () => void flightStore.flushNow(),
  });
  return (
    <Section id="documents" title="Forms and navlog" edits={false}>
      <a className="btn primary ep-print-navlog" data-testid="export-navlog" {...open('navlog')}>
        <Icon name="print" /> Print the navlog
      </a>
      <ul className="ep-exports" data-testid="exports">
        {EXPORT_KINDS.filter((k) => k !== 'navlog').map((k) => (
          <li key={k}>
            <a data-testid={`export-${k}`} {...open(k)}>
              <Icon name="file" className="ep-icon" />
              <span className="ep-export-label">{EXPORT_LABEL[k]}</span>
              <Icon name="external" size={14} className="ep-icon" />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function FlightPanel() {
  const [stage, setStage] = useStage();
  return (
    <div className="ep" data-testid="flight-panel">
      <ReadinessBar stage={stage} onStage={setStage} />
      <div hidden={stage !== 'plan'} data-testid="stage-body-plan">
        <RouteSection />
        <WhenSection />
        <AircraftSection />
        <ManifestSection />
        <FuelSection />
      </div>
      <div hidden={stage !== 'brief'} data-testid="stage-body-brief">
        <MetarSection />
        <NotamSection />
        <AerodromeSection />
        <PerformanceSection />
        <AtcSection />
      </div>
      <div hidden={stage !== 'file'} data-testid="stage-body-file">
        <FplSection />
        <FilingSection />
        <DocumentsSection />
      </div>
    </div>
  );
}
