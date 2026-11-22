// A duration typed as h:mm ('1:30', '1h30', '90' minutes, '130'). Written back as 'h:mm' on blur or
// Enter; text that is not a duration stays as typed, red, and the value is left alone.
import { useEffect, useEffectEvent, useState } from 'react';

import { fmtDurationField, parseDuration } from '../shared/typedInput';

export interface DurationFieldProps {
  /** Minutes. */
  value: number;
  onChange: (min: number) => void;
  min?: number;
  max?: number;
  name?: string;
  ariaLabel?: string;
  testId?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function DurationField({
  value,
  onChange,
  min = 1,
  max = 24 * 60,
  name,
  ariaLabel,
  testId,
  disabled,
  autoFocus,
  className,
}: DurationFieldProps) {
  const shown = fmtDurationField(value);
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);
  // a new value from outside (undo, another tab) replaces the text unless it is what is typed
  const sync = useEffectEvent(() => {
    if (!focused || parseDuration(draft) !== value) setDraft(shown);
  });
  useEffect(() => sync(), [value]);

  const parsed = parseDuration(draft);
  const ok = parsed !== null && parsed >= min && parsed <= max;
  const commit = () => {
    if (!ok) return;
    setDraft(fmtDurationField(parsed));
    if (parsed !== value) onChange(parsed);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      name={name}
      aria-label={ariaLabel}
      aria-invalid={!ok || undefined}
      data-testid={testId}
      className={['tnum duration-field', className, ok ? '' : 'invalid'].filter(Boolean).join(' ')}
      placeholder="h:mm"
      value={draft}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setDraft(e.target.value);
        const m = parseDuration(e.target.value);
        // a complete h:mm is taken at once, so the plan follows while typing
        if (
          m !== null &&
          m >= min &&
          m <= max &&
          /^\d{1,2}\s*[:.h]\s*\d{2}$/.test(e.target.value.trim()) &&
          m !== value
        )
          onChange(m);
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
