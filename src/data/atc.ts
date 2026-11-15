// ATC list generation (data agent): departure, aerodromes near the route, destination, TMAs/MTMAs
// entered at the planned altitude, FIS — as js/app.js terminalRows() did in v2 (legacy copy:
// see ARCHITECTURE.md). Pure; inputs/outputs typed in src/calc/atc.ts.
import type { AtcGenInput, AtcGenOutput } from '../calc';
import { NotImplementedError } from '../calc';

/** @throws NotImplementedError until the data agent implements it. */
export function generateAtcList(input: AtcGenInput): AtcGenOutput {
  void input;
  throw new NotImplementedError('generateAtcList');
}
