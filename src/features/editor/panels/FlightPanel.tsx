// The editor's left panel: "Ready to fly" and the stages (ReadinessBar.tsx, UX-PLAN.md):
//   Plan          Route, When, Aircraft, Manifest & loading, Fuel, Flight plan (alternates, remarks)
//   Brief         METAR (near the flight), NOTAMs, Aerodrome hours, Take-off & landing, ATC
//   File & forms  its own page, without the map: the flight plan and filing, the forms (the exports)
// Every section stays mounted (a stage switch keeps their state). Numbers come from useFlightCalc()
// (src/calc); edits go through useEditor().update().
import { AerodromeSection } from './AerodromeSection';
import { AircraftSection } from './AircraftSection';
import { AtcSection } from './AtcSection';
import { FplSection } from './FplSection';
import { FuelSection } from './FuelSection';
import { ManifestSection } from './ManifestSection';
import { MetarSection } from './MetarSection';
import { NotamSection } from './NotamSection';
import { PerformanceSection } from './PerformanceSection';
import { ReadinessBar, useStage } from './ReadinessBar';
import { RouteSection } from './RouteSection';
import { WhenSection } from './WhenSection';

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
        <FplSection />
      </div>
      <div hidden={stage !== 'brief'} data-testid="stage-body-brief">
        <MetarSection />
        <NotamSection />
        <AerodromeSection />
        <PerformanceSection />
        <AtcSection />
      </div>
    </div>
  );
}
