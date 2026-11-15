// Small building blocks of the editor panel: collapsible sections, key/value rows, number inputs
// that keep a draft while typing, and status chips.
import { useEffect, useState, type ReactNode } from 'react';

const LS_KEY = 'pgf.editor.sections';
function loadCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; }
}
function saveCollapsed(v: Record<string, boolean>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

/** A panel section with a header that collapses it (remembered on this device). */
export function Section({ id, title, badge, actions, children }: {
  id: string;
  title: string;
  /** Shown next to the title (also when collapsed): a short summary or a status chip. */
  badge?: ReactNode;
  /** Buttons on the right of the header (shown when open). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => !!loadCollapsed()[id]);
  const toggle = () => {
    setCollapsed((c) => {
      const all = loadCollapsed();
      all[id] = !c;
      saveCollapsed(all);
      return !c;
    });
  };
  return (
    <section className={'ep-section' + (collapsed ? ' collapsed' : '')} data-testid={`section-${id}`}>
      <header className="ep-section-head">
        <button type="button" className="ep-section-toggle" onClick={toggle} aria-expanded={!collapsed}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="ep-caret"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
          <span className="ep-section-title">{title}</span>
        </button>
        {badge && <span className="ep-section-badge">{badge}</span>}
        <span className="spacer" />
        {!collapsed && actions}
      </header>
      {!collapsed && <div className="ep-section-body">{children}</div>}
    </section>
  );
}

/** A label/value line of computed figures. */
export function KV({ k, v, sub, tone, testId }: { k: ReactNode; v: ReactNode; sub?: ReactNode; tone?: 'warn' | 'danger' | 'ok' | 'muted'; testId?: string }) {
  return (
    <div className={'ep-kv' + (tone ? ' ' + tone : '')} data-testid={testId}>
      <span className="k">{k}</span>
      <span className="v">{v}{sub && <span className="sub">{sub}</span>}</span>
    </div>
  );
}

/**
 * Number input that keeps what is typed until it parses; commits null for an empty field.
 * `onCommit` is called on every valid change (pass a coalesce key to the update).
 */
export function NumberInput({ value, onCommit, min, max, step, placeholder, width, testId, ariaLabel, allowEmpty = true, decimals }: {
  value: number | null;
  onCommit(v: number | null): void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  width?: number;
  testId?: string;
  ariaLabel?: string;
  allowEmpty?: boolean;
  decimals?: number;
}) {
  const show = (v: number | null) => (v == null || !isFinite(v) ? '' : decimals != null ? String(+v.toFixed(decimals)) : String(v));
  const [draft, setDraft] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(show(value)); }, [value, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  const parse = (s: string): number | null | undefined => {
    const t = s.trim().replace(',', '.');
    if (!t) return allowEmpty ? null : undefined;
    const n = Number(t);
    if (!isFinite(n)) return undefined;
    if (min != null && n < min) return undefined;
    if (max != null && n > max) return undefined;
    return n;
  };
  const p = parse(draft);
  return (
    <input
      className={'ep-num' + (p === undefined ? ' invalid' : '')}
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      style={width ? { width } : undefined}
      step={step}
      aria-label={ariaLabel}
      data-testid={testId}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setDraft(show(value)); }}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parse(e.target.value);
        if (v !== undefined && v !== value) onCommit(v);
      }}
    />
  );
}

export function Chip({ tone, children, title }: { tone?: 'warn' | 'danger' | 'ok'; children: ReactNode; title?: string }) {
  return <span className={'chip' + (tone ? ' ' + tone : '')} title={title}>{children}</span>;
}

export function Icon({ name, size = 16 }: { name: 'up' | 'down' | 'x' | 'plus' | 'refresh' | 'undo' | 'redo' | 'edit' | 'external' | 'warn' | 'print'; size?: number }) {
  const d: Record<string, string> = {
    up: 'M4 10l4-4 4 4',
    down: 'M4 6l4 4 4-4',
    x: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
    plus: 'M8 3.5v9M3.5 8h9',
    refresh: 'M12.5 6.5A4.75 4.75 0 1 0 12.8 9.5M12.5 3v3.5H9',
    undo: 'M5.5 4 2.5 7l3 3M3 7h6.5a3.5 3.5 0 0 1 0 7H8',
    redo: 'M10.5 4l3 3-3 3M13 7H6.5a3.5 3.5 0 0 0 0 7H8',
    edit: 'M10.5 3.5l2 2L6 12H4v-2z',
    external: 'M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5',
    warn: 'M8 2.5 14 13H2zM8 6.5v3M8 11.2v.1',
    print: 'M4.5 6V2.5h7V6M4.5 11.5H3V6h10v5.5h-1.5M4.5 9.5h7v4h-7z',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="ep-icon">
      <path d={d[name]} />
    </svg>
  );
}
