// Screen-only list of what is missing from a filled form (never printed), each with a link to fix it.
import { Link, useParams } from 'react-router-dom';

/** Where a warning is fixed: the flight editor, a person's details, or an aircraft in the hangar. */
export type FormFix = { kind: 'flight' } | { kind: 'person'; key: string } | { kind: 'aircraft'; id: string };

function fixLink(f: FormFix, flightId: string | undefined): { to: string; label: string } | null {
  if (f.kind === 'flight') return flightId ? { to: `/flights/${flightId}`, label: 'Open the flight' } : null;
  if (f.kind === 'person') return { to: `/passengers?edit=${encodeURIComponent(f.key === 'PIC' ? 'me' : f.key)}`, label: f.key === 'PIC' ? 'Edit your details' : 'Edit passenger' };
  return { to: `/hangar/${f.id}`, label: 'Open in the hangar' };
}

export function FormWarnings({ warnings, fixes = {} }: { warnings: string[]; fixes?: Record<string, FormFix> }) {
  const { id } = useParams();
  if (!warnings.length) return null;
  return (
    <div className="pgf-form-warnings no-print" role="note" data-testid="form-warnings">
      <strong>Missing details:</strong>
      <ul>
        {warnings.map((w) => {
          const l = fixes[w] ? fixLink(fixes[w], id) : null;
          return <li key={w}>{w}{l && <> <Link to={l.to} className="pgf-fix">{l.label}</Link></>}</li>;
        })}
      </ul>
    </div>
  );
}
