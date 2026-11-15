// Dropdown menu behind a button (⋮ on rows). Closes on an outside click, Escape or a choice;
// ↑/↓ move between the items.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a separator above this item. */
  separator?: boolean;
  testId?: string;
}

export function Menu({ items, label, trigger, className, testId = 'row-menu' }: {
  items: MenuItem[];
  /** Accessible name of the button. */
  label: string;
  /** Button content (default ⋮). */
  trigger?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? []);
    if (!all.length) return;
    e.preventDefault();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % all.length : (i <= 0 ? all.length - 1 : i - 1);
    all[next].focus();
  };
  return (
    <div className={'menu-wrap' + (className ? ' ' + className : '')} ref={ref} onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
      <button ref={btn} type="button" className="icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} title={label}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} data-testid={testId}>
        {trigger ?? <Icon name="kebab" size={18} />}
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it) => (
            <div key={it.label} style={{ display: 'contents' }}>
              {it.separator && <hr />}
              <button type="button" role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.disabled} data-testid={it.testId}
                onClick={(e) => { e.preventDefault(); setOpen(false); it.onSelect(); }}>{it.label}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** ⋮ button with a dropdown menu. */
export function KebabMenu({ items, label = 'More actions', testId }: { items: MenuItem[]; label?: string; testId?: string }) {
  return <Menu items={items} label={label} className="kebab" testId={testId} />;
}
