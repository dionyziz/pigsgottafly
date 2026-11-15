// Screen-only list of what is missing from a filled form (never printed), each a link to fix it.
import { WarningList } from '../WarningList';
import type { Fix, PersonField as PF } from '../fix';

/** Where a warning is fixed (src/features/exports/fix.ts). */
export type FormFix = Fix;
export type PersonField = PF;

export function FormWarnings({ warnings, fixes = {}, aircraftId }: { warnings: string[]; fixes?: Record<string, FormFix>; aircraftId?: string | null }) {
  if (!warnings.length) return null;
  return (
    <div className="pgf-form-warnings no-print" role="note" data-testid="form-warnings">
      <strong>Missing details:</strong>
      <WarningList warnings={warnings} fixes={fixes} aircraftId={aircraftId} classify={false} />
    </div>
  );
}
