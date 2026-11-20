// Filing the flight plan from the editor (UX-PLAN.md step 3): the FPL message built as the export
// builds it (buildFpl, from the editor's live navlog and fuel), and the filing panel: addressees,
// File / Delay / Cancel / Refresh, the status and the log. The export page keeps the form.
import { useMemo } from 'react';

import { FilingPanel } from '../../exports/fpl/FilingPanel';
import { buildFpl } from '../../exports/fpl/fpl';
import { fplInputFrom } from '../../exports/fpl/input';
import { useEditor } from '../state';
import { useFlightCalc } from './calc';
import { Section } from './ui';

export function FilingSection() {
  const { flight, doc, aircraft, pilot, saveStatus } = useEditor();
  const { navlog, fuel, weatherLoading } = useFlightCalc();
  const current = useMemo(() => ({ ...flight, ...doc }), [flight, doc]);
  const fpl = useMemo(
    () => buildFpl(fplInputFrom({ flight: current, aircraft, pilot, navlog, fuel })),
    [current, aircraft, pilot, navlog, fuel],
  );
  return (
    <Section id="filing" title="Filing">
      <details className="ep-fpl-message">
        <summary>The message</summary>
        <pre className="fpl-message" data-testid="editor-fpl-message">
          {fpl.message}
        </pre>
      </details>
      {/* filed as saved: the server checks the plan against the saved flight */}
      <FilingPanel
        title="autorouter"
        flight={current}
        message={fpl.message}
        complete={fpl.complete && !weatherLoading && saveStatus === 'saved'}
      />
    </Section>
  );
}
