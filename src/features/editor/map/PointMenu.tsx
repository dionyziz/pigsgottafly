// A route point's context menu (right-click) and the name prompt for custom points.
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import type { MenuItem } from '../../../ui';
import { cleanWaypointName } from './snap';

/** Menu at (x, y) in map coordinates; the items have the shape of the shared Menu's; ↑/↓ move. */
export function PointMenu({
  x,
  y,
  title,
  detail,
  items,
  error,
}: {
  x: number;
  y: number;
  title: string;
  detail: string;
  items: MenuItem[];
  error?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? []);
    if (!all.length) return;
    e.preventDefault();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[e.key === 'ArrowDown' ? (i + 1) % all.length : i <= 0 ? all.length - 1 : i - 1].focus();
  };
  return (
    <div
      ref={ref}
      className="pgf-menu"
      style={{ left: x + 6, top: y + 6 }}
      role="menu"
      data-testid="point-menu"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKey}
    >
      <div className="pgf-menu-h">
        {title}
        <span className="muted"> · {detail}</span>
      </div>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={it.danger ? 'danger' : ''}
          disabled={it.disabled}
          data-testid={it.testId}
          onClick={it.onSelect}
        >
          {it.label}
        </button>
      ))}
      {error && <div className="pgf-menu-err">{error}</div>}
    </div>
  );
}

export interface NamePrompt {
  x: number;
  y: number;
  title: string;
  value: string;
  confirm: (name: string) => void;
  cancel: () => void;
}

export function NameBox({ prompt }: { prompt: NamePrompt }) {
  const [value, setValue] = useState(prompt.value);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const submit = () => {
    const n = cleanWaypointName(value);
    if (!n) {
      setBad(true);
      ref.current?.focus();
      return;
    }
    prompt.confirm(n);
  };
  return (
    <form
      className="pgf-name"
      style={{ left: prompt.x, top: prompt.y }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      data-testid="name-prompt"
    >
      <label htmlFor="pgf-name-input">{prompt.title}</label>
      <div className="pgf-name-row">
        <input
          id="pgf-name-input"
          ref={ref}
          value={value}
          maxLength={24}
          autoComplete="off"
          spellCheck={false}
          className={bad ? 'is-invalid' : ''}
          onChange={(e) => {
            setValue(e.target.value.toUpperCase());
            setBad(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              prompt.cancel();
            }
          }}
        />
        <button type="submit" className="pgf-name-ok">
          OK
        </button>
      </div>
      {bad && <div className="pgf-name-err">Letters, digits, spaces and . / _ -</div>}
    </form>
  );
}
