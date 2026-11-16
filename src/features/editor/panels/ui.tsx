// Small building blocks of the editor panel: collapsible sections and key/value rows. NumberInput,
// Chip and Icon moved to src/ui (NumberField, Chip, Icon) and are re-exported here for the old
// imports.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseNumber } from '../../../shared/number';
import { Chip as UiChip, Collapsible, Icon as UiIcon, NumberField, type ChipTone, type IconName } from '../../../ui';
import { findFocusTarget, focusAndHighlight, focusParam } from '../../../app/focusParam';
import { onEditorFocus, sectionOf } from '../focus';

/** Where the editor remembers which boxes are collapsed (id → true). */
export const SECTIONS_STORE = 'pgf.editor.sections';

/**
 * Opens a box for a focus request and focuses the field: a ?focus= deep link on load (an export
 * warning) or focusInEditor() (a warning's fix in the editor). The remembered state is not changed.
 */
export function useFocusRequest(matches: (key: string) => boolean) {
  const [req, setReq] = useState<{ key: string; n: number } | null>(() => {
    const k = focusParam();
    return k && matches(k) ? { key: k, n: 0 } : null;
  });
  useEffect(() => onEditorFocus((key) => { if (matches(key)) setReq((r) => ({ key, n: (r?.n ?? 0) + 1 })); }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!req) return;
    let tries = 0;
    let timer = 0;
    // the box opens on this render; its body (and data still loading) may take a moment
    const attempt = () => {
      const el = ref.current ? findFocusTarget(ref.current, req.key) : null;
      if (el) { focusAndHighlight(el); setReq(null); return; }
      if (++tries < 40) timer = window.setTimeout(attempt, 100); else setReq(null);
    };
    timer = window.setTimeout(attempt, 50);
    return () => window.clearTimeout(timer);
  }, [req]);
  return { ref, open: !!req };
}

/** A panel section with a header that collapses it (a click anywhere on the header; remembered on this device). */
export function Section({ id, title, badge, actions, summary, children }: {
  id: string;
  title: string;
  /** Shown next to the title (also when collapsed): a short summary or a status chip. */
  badge?: ReactNode;
  /** Buttons on the right of the header (shown when open). */
  actions?: ReactNode;
  /** Shown under the header when collapsed. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const { ref, open } = useFocusRequest((key) => sectionOf(key) === id);
  return (
    <Collapsible id={id} title={title} badge={badge} actions={actions} summary={summary} store={SECTIONS_STORE}
      openWhen={open} sectionRef={ref} className="ep-section">
      {children}
    </Collapsible>
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
