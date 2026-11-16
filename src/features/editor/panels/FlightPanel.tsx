// The editor's left panel: Route (origin, destination), When, Aerodrome hours, Aircraft, Manifest & loading, Fuel, Take-off & landing, NOTAMs, ATC,
// Flight plan (alternates, remarks), Documents. Numbers come from useFlightCalc() (src/calc); edits
// go through useEditor().update().
import { useState } from 'react';

import { flightStore } from '../../../data/flightStore';
import { EXPORT_KINDS, EXPORT_LABEL } from '../../../shared';
import { Chip, Icon, WarningList } from '../../../ui';
import { editorWarningFix } from '../focus';
import { useEditor } from '../state';
import { AerodromeSection } from './AerodromeSection';
import { AircraftSection } from './AircraftSection';
import { AtcSection } from './AtcSection';
import { useFlightCalc } from './calc';
import { FplSection } from './FplSection';
import { FuelSection } from './FuelSection';
import { ManifestSection } from './ManifestSection';
import { NotamSection } from './NotamSection';
import { PerformanceSection } from './PerformanceSection';
import { RouteSection } from './RouteSection';
import { Section } from './ui';
import { WhenSection } from './WhenSection';

/** The printable documents; the issues count opens the list of issues, each with its fix. */
function DocumentsSection() {
  const { flight, doc } = useEditor();
  const { warnings } = useFlightCalc();
  const issues = warnings.filter((w) => w.level === 'danger');
  const [showIssues, setShowIssues] = useState(false);
  const badge = issues.length ? (
    <button
      type="button"
      className="ep-chip-btn"
      aria-expanded={showIssues}
      data-testid="documents-issues"
      onClick={() => setShowIssues((v) => !v)}
      title={showIssues ? 'Hide the issues' : 'Show the issues'}
    >
      <Chip tone="danger">
        {issues.length} issue{issues.length > 1 ? 's' : ''}
      </Chip>
    </button>
  ) : undefined;
  return (
    <Section id="documents" title="Documents" badge={badge}>
      {showIssues && issues.length > 0 && (
        <WarningList
          warnings={issues}
          className="ep-issues"
          testId="documents-issue-list"
          fix={(w) => editorWarningFix(w.text, doc.aircraftId)}
        />
      )}
      <ul className="ep-exports" data-testid="exports">
        {EXPORT_KINDS.map((k) => (
          <li key={k}>
            <a
              href={`/flights/${flight.id}/export/${k}`}
              target="_blank"
              rel="noopener"
              data-testid={`export-${k}`}
              // send pending edits first so the export page loads them
              onClick={() => {
                void flightStore.flushNow();
              }}
            >
              <Icon name="print" className="ep-icon" />
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
  return (
    <div className="ep" data-testid="flight-panel">
      <RouteSection />
      <WhenSection />
      <AerodromeSection />
      <AircraftSection />
      <ManifestSection />
      <FuelSection />
      <PerformanceSection />
      <NotamSection />
      <AtcSection />
      <FplSection />
      <DocumentsSection />
    </div>
  );
}
