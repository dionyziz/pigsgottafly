// Screen-only warning lists of the export pages: each warning that has a fix is a link to where it
// is fixed (the flight editor with the input focused, the hangar, the profile, the passenger dialog).
import { Link, useParams } from 'react-router-dom';
import { fixLink, planningFix, type Fix, type FixContext } from './fix';

export function WarningItem({ text, fix, ctx }: { text: string; fix?: Fix | null; ctx: FixContext }) {
  const l = fix ? fixLink(fix, ctx) : null;
  if (!l) return <>{text}</>;
  return (
    <Link to={l.to} className="pgf-warn-link" data-testid="warning-fix">
      {text}<span className="pgf-fix">{l.label} →</span>
    </Link>
  );
}

/**
 * A <ul> of warnings. fixes: by warning text; warnings without one are mapped by planningFix()
 * (planning texts from src/calc) unless `classify` is false.
 */
export function WarningList({ warnings, fixes = {}, aircraftId, className, testId, classify = true }: {
  warnings: string[];
  fixes?: Record<string, Fix>;
  aircraftId?: string | null;
  className?: string;
  testId?: string;
  classify?: boolean;
}) {
  const { id } = useParams();
  if (!warnings.length) return null;
  const ctx: FixContext = { flightId: id, aircraftId };
  return (
    <ul className={className} data-testid={testId}>
      {warnings.map((w, i) => (
        <li key={`${i}:${w}`}><WarningItem text={w} fix={fixes[w] ?? (classify ? planningFix(w) : null)} ctx={ctx} /></li>
      ))}
    </ul>
  );
}
