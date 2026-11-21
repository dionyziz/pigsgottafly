// Every section stays mounted, so a stage switch keeps its state (stages: ReadinessBar.tsx, UX-PLAN.md).
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
