// The one number input. It keeps what is typed while editing and commits every keystroke that
// leaves a valid number (the page updates live; pass a coalesce key to an undoable update so a
// typed number is one undo step). A draft outside [min, max] is never cut to its first digits: the
// field turns red with the limit shown under it and, on blur or Enter, the value is clamped to the
// limit and committed, so the stored value always matches the field. Anything else that is not a
// number goes back to the stored value on blur. Parsing: src/shared/number.ts.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { parseNumber, type NumberDraft } from '../shared/number';

export interface NumberFieldProps {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  /** Empty is allowed and commits null (default true). */
  optional?: boolean;
  /** When not optional: what an empty field commits (e.g. 0). Without it, empty reverts on blur. */
  emptyValue?: number;
  /** 0 means "not set": show an empty field (with the placeholder) instead of 0. */
  zeroAsEmpty?: boolean;
  /** Round what is shown to this many decimals. */
  decimals?: number;
  /** Drawn inside the field on the right ('kg', 'L', 'ft'). */
  unit?: ReactNode;
  placeholder?: string;
  /** Width of the field (with its unit). */
  width?: number | string;
  /** Marked invalid by the caller (a calculation, a form check). */
  invalid?: boolean;
  /** Show the limit / problem under the field while it is invalid (default true). */
  showLimit?: boolean;
  name?: string;
  id?: string;
  ariaLabel?: string;
  testId?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Extra classes of the <input>. */
  className?: string;
  step?: number;
  style?: CSSProperties;
}

const shown = (v: number | null | undefined, decimals?: number, zeroAsEmpty?: boolean) =>
  v == null || !isFinite(v) || (zeroAsEmpty && v === 0) ? '' : decimals != null ? String(+v.toFixed(decimals)) : String(v);

/** The draft classified, with the empty field mapped to `emptyValue` when there is one. */
function classify(draft: string, p: Pick<NumberFieldProps, 'min' | 'max' | 'integer' | 'optional' | 'emptyValue'>): NumberDraft {
  const allowEmpty = p.optional !== false;
  const r = parseNumber(draft, { min: p.min, max: p.max, integer: p.integer, allowEmpty: allowEmpty || p.emptyValue != null });
  if (r.kind === 'ok' && r.value === null && !allowEmpty && p.emptyValue != null) return { kind: 'ok', value: p.emptyValue };
  return r;
}

export function NumberField(props: NumberFieldProps) {
  const { value, onChange, decimals, zeroAsEmpty, unit, placeholder, width, invalid, showLimit = true, name, id, ariaLabel, testId, disabled, autoFocus, className, step, style, min, integer } = props;
  const [draft, setDraft] = useState(() => shown(value, decimals, zeroAsEmpty));
  const [focused, setFocused] = useState(false);
  // Edited since focus: only then does blur commit (focus and blur alone never change the value).
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!focused) { setDraft(shown(value, decimals, zeroAsEmpty)); return; }
    // Changed from outside while typing (undo, another input): show the new value unless it is what the draft says.
    const p = classify(draft, props);
    if (!(p.kind === 'ok' && p.value === value)) setDraft(shown(value, decimals, zeroAsEmpty));
  }, [value, focused]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = classify(draft, props);
  const settle = () => {
    const v = !dirty ? value : p.kind === 'ok' ? p.value : p.kind === 'range' ? p.clamped : value;
    if (v !== value) onChange(v);
    setDraft(shown(v, decimals, zeroAsEmpty));
    setDirty(false);
  };
  const bad = p.kind !== 'ok';
  const msg = p.kind === 'ok' ? undefined : p.message;
  return (
    <span className={'numfield' + (unit != null ? ' unit-input' : '')} style={width != null ? { width, ...style } : style}>
      <input
        className={['tnum', className, bad || invalid ? 'invalid' : ''].filter(Boolean).join(' ')}
        inputMode={integer && (min ?? 0) >= 0 ? 'numeric' : 'decimal'}
        value={draft}
        name={name}
        id={id}
        placeholder={placeholder}
        step={step}
        aria-label={ariaLabel}
        aria-invalid={bad || invalid || undefined}
        title={msg}
        data-testid={testId}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => { settle(); setFocused(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') settle(); }}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
          const r = classify(e.target.value, props);
          if (r.kind === 'ok' && r.value !== value) onChange(r.value);
        }}
      />
      {unit != null && <span>{unit}</span>}
      {showLimit && msg &&<small className="numfield-msg" role="status">{msg}</small>}
    </span>
  );
}
