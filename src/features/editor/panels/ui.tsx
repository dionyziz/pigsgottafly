// Small building blocks of the editor panel: collapsible sections (Collapsible that opens on a focus
// request) and key/value rows.
import { type ReactNode, use, useEffect, useEffectEvent, useRef, useState } from 'react';

import { findFocusTarget, focusAndHighlight, focusParam } from '../../../app/focusParam';
import { Collapsible } from '../../../ui';
import { onEditorFocus, sectionOf } from '../focus';
import { EditorContext } from '../state';

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
  const onFocusRequest = useEffectEvent((key: string) => {
    if (matches(key)) setReq((r) => ({ key, n: (r?.n ?? 0) + 1 }));
  });
  useEffect(() => onEditorFocus((key) => onFocusRequest(key)), []);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!req) return;
    let tries = 0;
    let timer = 0;
    // the box opens on this render; its body (and data still loading) may take a moment
    const attempt = () => {
      // a whole section: open, and scrolled to
      if (req.key.startsWith('section:') && ref.current) {
        ref.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
        setReq(null);
        return;
      }
      const el = ref.current ? findFocusTarget(ref.current, req.key) : null;
      if (el) {
        focusAndHighlight(el);
        setReq(null);
        return;
      }
      if (++tries < 40) timer = window.setTimeout(attempt, 100);
      else setReq(null);
    };
    timer = window.setTimeout(attempt, 50);
    return () => window.clearTimeout(timer);
  }, [req]);
  return { ref, open: !!req };
}

/** A panel section with a header that collapses it (a click anywhere on the header; remembered on this device). */
export function Section({
  id,
  title,
  badge,
  actions,
  summary,
  edits = true,
  children,
}: {
  id: string;
  title: string;
  /**
   * The section changes the flight (default). In a read-only editor (a flight shared as a viewer) its
   * controls are disabled and its header actions hidden; a section that only reads (briefing,
   * documents) says false and stays usable.
   */
  edits?: boolean;
  /** Shown next to the title (also when collapsed): a short summary or a status chip. */
  badge?: ReactNode;
  /** Buttons on the right of the header (shown when open). */
  actions?: ReactNode;
  /** Shown under the header when collapsed. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const { ref, open } = useFocusRequest((key) => sectionOf(key) === id);
  const readOnly = edits && !!use(EditorContext)?.readOnly;
  return (
    <Collapsible
      id={id}
      title={title}
      badge={badge}
      actions={readOnly ? undefined : actions}
      summary={summary}
      store={SECTIONS_STORE}
      openWhen={open}
      sectionRef={ref}
      className="ep-section"
    >
      {readOnly ? (
        <fieldset className="ep-readonly" disabled>
          {children}
        </fieldset>
      ) : (
        children
      )}
    </Collapsible>
  );
}

/** A label/value line of computed figures. */
export function KV({
  k,
  v,
  sub,
  tone,
  testId,
}: {
  k: ReactNode;
  v: ReactNode;
  sub?: ReactNode;
  tone?: 'warn' | 'danger' | 'ok' | 'muted';
  testId?: string;
}) {
  return (
    <div className={'ep-kv' + (tone ? ' ' + tone : '')} data-testid={testId}>
      <span className="k">{k}</span>
      <span className="v">
        {v}
        {sub && <span className="sub">{sub}</span>}
      </span>
    </div>
  );
}
