// The one number input. It keeps what is typed while editing and commits every keystroke that
// leaves a valid number (the page updates live; pass a coalesce key to an undoable update so a
// typed number is one undo step). A draft outside [min, max] is never cut to its first digits: the
// field turns red with the limit shown under it and, on blur or Enter, the value is clamped to the
// limit and committed, so the stored value always matches the field. Anything else that is not a
// number goes back to the stored value on blur. Parsing: src/shared/number.ts.
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { type NumberDraft, parseNumber } from '../shared/number';

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
  className?: string;
  step?: number;
  style?: CSSProperties;
  /** A heading: shown with three digits, 0 as 360 ('030', '360'). */
  heading?: boolean;
  /** Commit on Enter or leaving the field only (not while typing); Escape puts the stored value back. */
  commitOnEnter?: boolean;
  /** The value that applies while the field is empty (shown as the placeholder): focusing the empty
   *  field puts it in as text to edit or copy; leaving it unchanged keeps the field empty. */
  fillValue?: number | null;
}

const shown = (v: number | null | undefined, decimals?: number, zeroAsEmpty?: boolean, heading?: boolean) => {
  if (v == null || !isFinite(v) || (zeroAsEmpty && v === 0)) return '';
  const t = decimals != null ? String(+v.toFixed(decimals)) : String(v);
  if (!heading) return t;
  const h = ((v % 360) + 360) % 360 || 360;
  const [i, f] = (decimals != null ? String(+h.toFixed(decimals)) : String(h)).split('.');
  return i.padStart(3, '0') + (f ? `.${f}` : '');
};

/** The draft classified, with the empty field mapped to `emptyValue` when there is one. */
function classify(
  draft: string,
  p: Pick<NumberFieldProps, 'min' | 'max' | 'integer' | 'optional' | 'emptyValue'>,
): NumberDraft {
  const allowEmpty = p.optional !== false;
  const r = parseNumber(draft, {
    min: p.min,
    max: p.max,
    integer: p.integer,
    allowEmpty: allowEmpty || p.emptyValue != null,
  });
  if (r.kind === 'ok' && r.value === null && !allowEmpty && p.emptyValue != null)
    return { kind: 'ok', value: p.emptyValue };
  return r;
}

export function NumberField(props: NumberFieldProps) {
  const {
    value,
    onChange,
    decimals,
    zeroAsEmpty,
    unit,
    placeholder,
    width,
    invalid,
    showLimit = true,
    name,
    id,
    ariaLabel,
    testId,
    disabled,
    autoFocus,
    className,
    step,
    style,
    min,
    integer,
    heading,
    commitOnEnter,
    fillValue,
  } = props;
  const [draft, setDraft] = useState(() => shown(value, decimals, zeroAsEmpty, heading));
  const [focused, setFocused] = useState(false);
  // Edited since focus: only then does blur commit (focus and blur alone never change the value).
  const [dirty, setDirty] = useState(false);
  // Changed from outside while typing (undo, another input): show the new value unless it is what the draft says.
  const syncDraft = useEffectEvent(() => {
    const p = classify(draft, props);
    const filled = value == null && fillValue != null && p.kind === 'ok' && p.value === fillValue;
    if (!focused || !(filled || (p.kind === 'ok' && p.value === value)))
      setDraft(shown(value, decimals, zeroAsEmpty, heading));
  });
  useEffect(() => syncDraft(), [value, focused, decimals, zeroAsEmpty, heading]);

  const p = classify(draft, props);
  // Escape (commitOnEnter): the blur that follows must not commit the draft it just dropped
  const cancelled = useRef(false);
  // the default put in on focus is selected before the next keystroke (focus renders synchronously)
  const inputRef = useRef<HTMLInputElement>(null);
  const selectAll = useRef(false);
  useLayoutEffect(() => {
    if (!selectAll.current) return;
    selectAll.current = false;
    inputRef.current?.select();
  }, [draft]);
  const settle = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    let v = !dirty ? value : p.kind === 'ok' ? p.value : p.kind === 'range' ? p.clamped : value;
    if (value == null && fillValue != null && v === fillValue) v = null;
    if (v !== value) onChange(v);
    setDraft(shown(v, decimals, zeroAsEmpty, heading));
    setDirty(false);
  };
  const bad = p.kind !== 'ok';
  const msg = p.kind === 'ok' ? undefined : p.message;
  return (
    <span
      className={'numfield' + (unit != null ? ' unit-input' : '')}
      style={width != null ? { width, ...style } : style}
    >
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
        ref={inputRef}
        onFocus={() => {
          setFocused(true);
          if (value == null && fillValue != null && !draft) {
            selectAll.current = true;
            setDraft(String(fillValue));
          }
        }}
        onBlur={() => {
          settle();
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') settle();
          if (e.key === 'Escape' && commitOnEnter) {
            setDraft(shown(value, decimals, zeroAsEmpty, heading));
            setDirty(false);
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
          if (commitOnEnter) return;
          const r = classify(e.target.value, props);
          if (r.kind === 'ok' && r.value !== value) onChange(r.value);
        }}
      />
      {unit != null && <span>{unit}</span>}
      {showLimit && msg && (
        <small className="numfield-msg" role="status">
          {msg}
        </small>
      )}
    </span>
  );
}
