// Screen-only list of what is missing from a filled form (never printed), each with a link to fix it.
import { ExportWarnings } from '../WarningList';
import type { Fix, PersonField as PF } from '../fix';

/** Where a warning is fixed (src/features/exports/fix.ts). */
export type FormFix = Fix;
export type PersonField = PF;

export function FormWarnings({ warnings, fixes = {}, aircraftId }: { warnings: string[]; fixes?: Record<string, FormFix>; aircraftId?: string | null }) {
  return <ExportWarnings warnings={warnings} fixes={fixes} aircraftId={aircraftId} classify={false} title="Missing details" testId="form-warnings" />;
}
