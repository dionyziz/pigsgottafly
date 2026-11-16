// Segmented control: one of a few options, side by side (the map's base map, a filter). One outer
// border, even 1px dividers (the buttons overlap by their border), rounded only at the outer ends; the
// pressed option's border is the accent on all four sides. Buttons with aria-pressed; ←/→ move between them.
import type { KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> { value: T; label: string; title?: string; testId?: string }

export function SegmentedControl<T extends string>({ value, options, onChange, label, sm, testId, className }: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name of the group. */
  label?: string;
  sm?: boolean;
  testId?: string;
  className?: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(`button[data-value="${next.value}"]`);
    btn?.focus();
  };
  return (
    <div className={'segmented' + (sm ? ' sm' : '') + (className ? ' ' + className : '')} role="group" aria-label={label} data-testid={testId} onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} data-value={o.value} title={o.title} data-testid={o.testId}
          tabIndex={o.value === value ? 0 : -1} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
