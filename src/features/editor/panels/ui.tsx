// Small building blocks of the editor panel: collapsible sections and key/value rows. NumberInput,
// Chip and Icon moved to src/ui (NumberField, Chip, Icon) and are re-exported here for the old
// imports.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseNumber } from '../../../shared/number';
import { Chip as UiChip, Icon as UiIcon, NumberField, type ChipTone, type IconName } from '../../../ui';
import { focusParam, useFocusParam } from '../../../app/focusParam';
import { EDITOR_FOCUS_SECTION, type EditorFocus } from '../../exports/fix';

/**
 * Deep link into the editor (/flights/:id?focus=<EditorFocus>, from a warning on an export): the
 * section holding that input opens (without changing the remembered state), and the input is
 * scrolled to, focused and highlighted. Used by every panel Section.
 */
function useSectionFocus(id: string, collapsed: boolean, open: () => void) {
  const key = focusParam();
  const mine = !!key && EDITOR_FOCUS_SECTION[key as EditorFocus] === id;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (mine && collapsed) open(); }, [mine]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusParam(() => ref.current, mine && !collapsed, key);
  return ref;
}

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
  const ref = useSectionFocus(id, collapsed, () => setCollapsed(false));
  const toggle = () => {
    setCollapsed((c) => {
      const all = loadCollapsed();
      all[id] = !c;
      saveCollapsed(all);
      return !c;
    });
  };
  return (
    <section ref={ref} className={'ep-section' + (collapsed ? ' collapsed' : '')} data-testid={`section-${id}`}>
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

/** The editor's number input: src/ui/NumberField with the editor's prop names. */
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
  return (
    <NumberField value={value} onChange={onCommit} min={min} max={max} step={step} placeholder={placeholder} width={width}
      testId={testId} ariaLabel={ariaLabel} optional={allowEmpty} decimals={decimals} className="ep-num" />
  );
}

export type NumberDraft =
  | { kind: 'ok'; value: number | null }
  /** A number outside [min, max]; `clamped` is the nearest allowed value. */
  | { kind: 'range'; value: number; clamped: number }
  | { kind: 'bad' };

/** Parses what is typed in a NumberInput (src/shared/number parseNumber without the messages). */
export function parseNumberDraft(s: string, { min, max, allowEmpty = true }: { min?: number; max?: number; allowEmpty?: boolean }): NumberDraft {
  const r = parseNumber(s, { min, max, allowEmpty });
  return r.kind === 'bad' ? { kind: 'bad' } : r.kind === 'range' ? { kind: 'range', value: r.value, clamped: r.clamped } : r;
}

export function Chip({ tone, children, title }: { tone?: Extract<ChipTone, 'warn' | 'danger' | 'ok'>; children: ReactNode; title?: string }) {
  return <UiChip tone={tone} title={title}>{children}</UiChip>;
}

export function Icon({ name, size = 16 }: { name: Extract<IconName, 'up' | 'down' | 'x' | 'plus' | 'refresh' | 'undo' | 'redo' | 'edit' | 'external' | 'warn' | 'print'>; size?: number }) {
  return <UiIcon name={name} size={size} className="ep-icon" />;
}
