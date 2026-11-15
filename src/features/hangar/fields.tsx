// Form controls for the aircraft page: numeric inputs that keep what is being typed and commit only
// valid numbers, labelled fields with units, inline issue messages, and an editable point table.
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Issue } from './model';

/** Parses a number typed with '.' or ','; '' → null; NaN for garbage. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.').replace(/−/g, '-');
  if (!t) return null;
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN;
}
const show = (v: number | null | undefined, zeroEmpty?: boolean) => (v == null || !isFinite(v) || (zeroEmpty && v === 0) ? '' : String(v));

export interface NumInputProps {
  value: number | null;
  onChange: (v: number | null) => void;
  /** Allow an empty value (→ null). Otherwise an empty field commits 0. */
  optional?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  invalid?: boolean;
  width?: number | string;
  ariaLabel?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  /** 0 means "not set": show an empty field (with the placeholder) instead of 0. */
  zeroAsEmpty?: boolean;
}

/** Numeric input: keeps the text while typing; commits only values that parse and are in range. */
export function NumInput({ value, onChange, optional, integer, min, max, unit, placeholder, invalid, width, ariaLabel, name, disabled, className, zeroAsEmpty }: NumInputProps) {
  const [text, setText] = useState(show(value, zeroAsEmpty));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(show(value, zeroAsEmpty));
    else {
      const p = parseNum(text);
      if (p !== value && !(p === null && !optional && value === 0)) setText(show(value, zeroAsEmpty));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const parsed = parseNum(text);
  const bad = parsed !== null && (Number.isNaN(parsed) || (integer && !Number.isInteger(parsed)) || (min != null && parsed < min) || (max != null && parsed > max));
  const commit = (t: string) => {
    setText(t);
    const p = parseNum(t);
    if (p === null) { onChange(optional ? null : 0); return; }
    if (Number.isNaN(p) || (integer && !Number.isInteger(p)) || (min != null && p < min) || (max != null && p > max)) return;
    onChange(p);
  };
  const title = bad ? `Enter ${integer ? 'a whole number' : 'a number'}${min != null && max != null ? ` from ${min} to ${max}` : min != null ? ` of at least ${min}` : max != null ? ` up to ${max}` : ''}` : undefined;
  const input = (
    <input
      className={[className, bad || invalid ? 'invalid' : ''].filter(Boolean).join(' ') || undefined}
      inputMode={integer && (min ?? 0) >= 0 ? 'numeric' : 'decimal'}
      value={text}
      name={name}
      placeholder={placeholder ?? (optional ? '—' : undefined)}
      aria-label={ariaLabel}
      aria-invalid={bad || invalid || undefined}
      title={title}
      disabled={disabled}
      style={width != null ? { width } : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setText(show(value, zeroAsEmpty)); }}
      onChange={(e) => commit(e.target.value)}
    />
  );
  if (!unit) return input;
  return <div className="unit-input" style={width != null ? { width } : undefined}>{input}<span>{unit}</span></div>;
}

/** Labelled field with optional hint and the issues of its path. */
export function Field({ label, hint, issues, children, req, wide, focus }: { label: ReactNode; hint?: ReactNode; issues?: Issue[]; children: ReactNode; req?: boolean; wide?: boolean; /** ?focus= deep-link key */ focus?: string }) {
  return (
    <label className={'field' + (wide ? ' span2' : '')} data-focus={focus}>
      <span>{label}{req && <span className="req" aria-hidden>*</span>}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {issues?.map((i, k) => <span key={k} className={'issue ' + i.level}>{i.message}</span>)}
    </label>
  );
}

/** Messages of a set of issues, as a compact list. */
export function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="issue-list">
      {issues.map((i, k) => <li key={k} className={i.level}>{i.message}</li>)}
    </ul>
  );
}

export function Check({ checked, onChange, children, title }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Section card with a header and an anchor id. */
export function Section({ id, title, intro, actions, children }: { id: string; title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="ac-section card" id={id} aria-labelledby={id + '-h'}>
      <header>
        <div>
          <h2 id={id + '-h'}>{title}</h2>
          {intro && <p>{intro}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/**
 * Editable table of [x, y] points (envelope vertices, compass card rows). Rows can be added,
 * removed and moved; `extra` renders an additional read-only cell per row.
 */
export function PointTable({ points, onChange, xLabel, yLabel, xUnit, yUnit, xProps, yProps, extra, extraLabel, addPoint, caption, minRows = 0 }: {
  points: [number, number][];
  onChange: (p: [number, number][]) => void;
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  xProps?: Partial<NumInputProps>;
  yProps?: Partial<NumInputProps>;
  extra?: (p: [number, number], i: number) => ReactNode;
  extraLabel?: string;
  addPoint?: (points: [number, number][]) => [number, number];
  caption?: string;
  minRows?: number;
}) {
  const id = useId();
  const set = (i: number, k: 0 | 1, v: number | null) => onChange(points.map((p, j) => (j === i ? (k === 0 ? [v ?? 0, p[1]] : [p[0], v ?? 0]) : p)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= points.length) return;
    const n = points.slice();
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  const add = () => onChange([...points, addPoint ? addPoint(points) : (points.length ? [...points[points.length - 1]] as [number, number] : [0, 0])]);
  return (
    <div className="pt-table">
      <table aria-describedby={caption ? id : undefined}>
        <thead><tr><th>#</th><th>{xLabel}{xUnit && <span className="u"> {xUnit}</span>}</th><th>{yLabel}{yUnit && <span className="u"> {yUnit}</span>}</th>{extra && <th>{extraLabel}</th>}<th /></tr></thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td className="muted idx">{i + 1}</td>
              <td><NumInput value={p[0]} onChange={(v) => set(i, 0, v)} ariaLabel={`${xLabel} ${i + 1}`} {...xProps} /></td>
              <td><NumInput value={p[1]} onChange={(v) => set(i, 1, v)} ariaLabel={`${yLabel} ${i + 1}`} {...yProps} /></td>
              {extra && <td className="extra">{extra(p, i)}</td>}
              <td className="row-tools">
                <button type="button" className="icon sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" title="Move up">↑</button>
                <button type="button" className="icon sm" onClick={() => move(i, 1)} disabled={i === points.length - 1} aria-label="Move down" title="Move down">↓</button>
                <button type="button" className="icon sm danger" onClick={() => onChange(points.filter((_, j) => j !== i))} disabled={points.length <= minRows} aria-label="Remove row" title="Remove">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row pt-foot">
        <button type="button" className="ghost sm" onClick={add}>+ Add point</button>
        {caption && <span className="hint" id={id}>{caption}</span>}
      </div>
    </div>
  );
}
