// A box with a header that opens and closes it. The whole header is the toggle (a click anywhere,
// or Enter/Space when focused); the buttons in `actions` do not toggle. The open state is
// remembered on this device (localStorage `store`, a map id → collapsed).
import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useEffectEvent, useRef, useState } from 'react';

import { Icon } from './Icon';

const DEFAULT_STORE = 'pgf.collapsed';

function readStore(store: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(store) || '{}') || {};
  } catch {
    return {};
  }
}
function writeStore(store: string, id: string, collapsed: boolean) {
  try {
    const all = readStore(store);
    if (collapsed) all[id] = true;
    else delete all[id];
    localStorage.setItem(store, JSON.stringify(all));
  } catch {
    /* storage unavailable: not remembered */
  }
}

/** Open state of a collapsible box, remembered under `store`[id]. `openNow()` opens it without remembering. */
export function useCollapsed(
  id: string,
  { store = DEFAULT_STORE, defaultCollapsed = false }: { store?: string; defaultCollapsed?: boolean } = {},
) {
  const [collapsed, setCollapsed] = useState(() => readStore(store)[id] ?? defaultCollapsed);
  const toggle = () =>
    setCollapsed((c) => {
      writeStore(store, id, !c);
      return !c;
    });
  const openNow = () => setCollapsed(false);
  return { collapsed, toggle, openNow };
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [data-no-toggle]';

export function Collapsible({
  id,
  title,
  badge,
  actions,
  children,
  store,
  defaultCollapsed,
  openWhen,
  className,
  testId,
  sectionRef,
  summary,
}: {
  id: string;
  title: ReactNode;
  /** Next to the title, also when collapsed: a short summary or a status chip. */
  badge?: ReactNode;
  /** Buttons on the right of the header (shown when open); clicks on them do not toggle. */
  actions?: ReactNode;
  children: ReactNode;
  /** localStorage key of the remembered state (default 'pgf.collapsed'). */
  store?: string;
  defaultCollapsed?: boolean;
  /** When this becomes true the box opens (not remembered): a ?focus= deep link into it. */
  openWhen?: boolean;
  className?: string;
  testId?: string;
  sectionRef?: Ref<HTMLElement>;
  /** Shown instead of the body when collapsed (e.g. verdict · runway · TODR/TODA). */
  summary?: ReactNode;
}) {
  const { collapsed, toggle, openNow } = useCollapsed(id, { store, defaultCollapsed });
  const was = useRef(false);
  const followOpenWhen = useEffectEvent(() => {
    if (openWhen && !was.current && collapsed) openNow();
    was.current = !!openWhen;
  });
  useEffect(() => followOpenWhen(), [openWhen]);
  const onClick = (e: React.MouseEvent<HTMLElement>) => {
    const hit = (e.target as Element).closest(INTERACTIVE);
    if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) return;
    toggle();
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };
  return (
    <section
      ref={sectionRef}
      className={'collapsible' + (collapsed ? ' collapsed' : '') + (className ? ' ' + className : '')}
      data-testid={testId ?? `section-${id}`}
    >
      <header
        className="collapsible-head"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onClick}
        onKeyDown={onKey}
      >
        <Icon name="caret" size={12} className="collapsible-caret" />
        <span className="collapsible-title">{title}</span>
        {badge && <span className="collapsible-badge">{badge}</span>}
        <span className="spacer" />
        {!collapsed && actions && (
          <span
            className="collapsible-actions"
            data-no-toggle
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {actions}
          </span>
        )}
      </header>
      {collapsed ? (
        summary ? (
          <div className="collapsible-summary">{summary}</div>
        ) : null
      ) : (
        <div className="collapsible-body">{children}</div>
      )}
    </section>
  );
}
