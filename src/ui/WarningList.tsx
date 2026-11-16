// A list of warnings, each with its level and, when it can be fixed, a fix: a link to where it is
// fixed (`to`) or a fix done in place (`onFix`, e.g. open a section and focus a field).
import { Link } from 'react-router';
import { Icon } from './Icon';

export type WarningLevel = 'danger' | 'warn' | 'info';
/** A plain string is a warning; or anything with a level and a text (CalcWarning). */
export type WarningEntry = string | { level: WarningLevel; text: string };
export type WarningFix = { label: string; to: string } | { label: string; onFix: () => void };

const levelOf = (w: WarningEntry): WarningLevel => (typeof w === 'string' ? 'warn' : w.level);
const textOf = (w: WarningEntry) => (typeof w === 'string' ? w : w.text);

export function WarningList<W extends WarningEntry>({ warnings, fix, className, testId, icons = true }: {
  warnings: readonly W[];
  /** The fix of a warning, if it has one. */
  fix?: (w: W) => WarningFix | null | undefined;
  className?: string;
  testId?: string;
  /** Draw the level icon (default true). */
  icons?: boolean;
}) {
  if (!warnings.length) return null;
  return (
    <ul className={'warnings' + (className ? ' ' + className : '')} data-testid={testId}>
      {warnings.map((w, i) => {
        const level = levelOf(w);
        const f = fix?.(w);
        return (
          <li key={`${i}:${textOf(w)}`} className={level}>
            {icons && <Icon name={level === 'info' ? 'info' : 'warn'} size={14} />}
            <span className="warning-text">{textOf(w)}</span>
            {f && ('to' in f
              ? <Link to={f.to} className="warning-fix" data-testid="warning-fix">{f.label} →</Link>
              : <button type="button" className="linkish warning-fix" data-testid="warning-fix" onClick={f.onFix}>{f.label} →</button>)}
          </li>
        );
      })}
    </ul>
  );
}
