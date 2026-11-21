import type { MouseEvent } from 'react';

import { Icon } from './Icon';

/** Rounded search field with the magnifier. `sm` is the narrower list-page variant. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  sm,
  testId,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Accessible name (default: the placeholder). */
  label?: string;
  sm?: boolean;
  testId?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={'searchbox' + (sm ? ' sm' : '')}>
      <Icon name="search" />
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label ?? placeholder}
        data-testid={testId}
        autoFocus={autoFocus}
      />
    </div>
  );
}

const INTERACTIVE = 'button, a, input, select, textarea, label, .menu, .menu-wrap, [data-row-ignore]';

/**
 * onClick for a clickable table row or card: ignores clicks on the controls inside it (buttons,
 * links, inputs, menus) and the end of a text selection.
 */
export function rowClick<E extends Element = HTMLElement>(fn: (e: MouseEvent<E>) => void) {
  return (e: MouseEvent<E>) => {
    const t = e.target as Element | null;
    const row = e.currentTarget as Element;
    const hit = t?.closest(INTERACTIVE);
    if (hit && hit !== row && row.contains(hit)) return;
    const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
    if (sel && !sel.isCollapsed && sel.toString().trim() && row.contains(sel.anchorNode)) return;
    fn(e);
  };
}
