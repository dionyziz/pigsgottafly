// A labelled form field: label, required mark, hint, its issues inline, a ?focus= key; a field with
// an error gets .invalid (its input turns red). And a checkbox with its label.
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

export type IssueLevel = 'error' | 'warning';
/** A message about a field: a plain string is an error. */
export type FieldIssue = string | { level: IssueLevel | 'danger' | 'warn'; message: string };

const levelOf = (i: FieldIssue): IssueLevel =>
  typeof i === 'string' || i.level === 'error' || i.level === 'danger' ? 'error' : 'warning';
const textOf = (i: FieldIssue) => (typeof i === 'string' ? i : i.message);

export function Field({
  label,
  req,
  hint,
  issues,
  error,
  focus,
  wide,
  className,
  children,
  testId,
}: {
  label: ReactNode;
  /** Required: a red asterisk after the label. */
  req?: boolean;
  hint?: ReactNode;
  issues?: FieldIssue[];
  /** One error message (same as issues={[error]}). */
  error?: string | null;
  /** ?focus= deep-link key (data-focus). */
  focus?: string;
  /** Spans two columns of a .grid2/.grid3. */
  wide?: boolean;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const all: FieldIssue[] = [...(error ? [error] : []), ...(issues ?? [])];
  const invalid = all.some((i) => levelOf(i) === 'error');
  // A plain input/select/textarea child is marked aria-invalid too.
  const child =
    invalid && isValidElement(children) && typeof children.type === 'string'
      ? // eslint-disable-next-line @eslint-react/no-clone-element -- marks the one native control passed in
        cloneElement(children as ReactElement<{ 'aria-invalid'?: boolean }>, { 'aria-invalid': true })
      : children;
  return (
    <label
      className={['field', wide && 'span2', invalid && 'invalid', className].filter(Boolean).join(' ')}
      data-focus={focus}
      data-testid={testId}
    >
      <span>
        {label}
        {req && (
          <span className="req" aria-hidden>
            *
          </span>
        )}
      </span>
      {child}
      {hint && <span className="hint">{hint}</span>}
      {all.map((i, k) => (
        <span key={k} className={'issue ' + levelOf(i)} role={levelOf(i) === 'error' ? 'alert' : undefined}>
          {textOf(i)}
        </span>
      ))}
    </label>
  );
}

/** Messages of a set of issues, as a compact list. */
export function IssueList({ issues }: { issues: FieldIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="issue-list">
      {issues.map((i, k) => (
        <li key={k} className={levelOf(i)}>
          {textOf(i)}
        </li>
      ))}
    </ul>
  );
}

export function Check({
  checked,
  onChange,
  children,
  title,
  disabled,
  name,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  name?: string;
  testId?: string;
}) {
  return (
    <label className="check" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        name={name}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
