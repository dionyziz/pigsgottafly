// The map's hover tooltip and click popover frames, shared by the airspace, NOTAM and aerodrome details:
// MapTip follows the cursor; MapPopover opens at a click, stays inside the map and has a close button;
// PopItem + useAccordion make its list of items, one open at a time.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CloseButton } from '../../../ui';

/** Cursor tooltip (pointer-events none). */
export function MapTip({ x, y, testId, children }: { x: number; y: number; testId: string; children: ReactNode }) {
  return <div className="pgf-air-tip" style={{ left: x + 16, top: y + 14 }} data-testid={testId}>{children}</div>;
}

/** Click details, placed beside (x, y) and kept inside the map. */
export function MapPopover({ x, y, label, testId, onClose, children }: {
  x: number; y: number; label: string; testId: string; onClose(): void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 12, top: y + 12 });
  // after every render: the content may have grown (an item opened, raw text shown)
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const W = parent.clientWidth, H = parent.clientHeight, w = el.offsetWidth, h = el.offsetHeight;
    let left = x + 12, top = y + 12;
    if (left + w > W - 8) left = Math.max(8, x - 12 - w);
    if (top + h > H - 8) top = Math.max(8, H - 8 - h);
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  });
  return (
    <div ref={ref} className="pgf-air-pop" style={pos} role="dialog" aria-label={label} data-testid={testId} onMouseDown={(e) => e.stopPropagation()}>
      <CloseButton onClick={onClose} className="pgf-air-x" size={10} />
      {children}
    </div>
  );
}

/** Which item of a popover is open ('' = none); the first one to start with. */
export function useAccordion(first: string | undefined) {
  const [open, setOpen] = useState(first ?? '');
  return { open, isOpen: (k: string) => open === k, toggle: (k: string) => setOpen((o) => (o === k ? '' : k)), setOpen };
}

/** One item of a popover: a header (a toggle when `onToggle` is given) and, when open, its body. */
export function PopItem({ open, onToggle, head, children, testId, data }: {
  open: boolean;
  onToggle?(): void;
  head: ReactNode;
  children?: ReactNode;
  testId?: string;
  /** data-* attributes of the section (data-id, data-key). */
  data?: Record<string, string>;
}) {
  const attrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => ['data-' + k, v]));
  return (
    <section className={'pgf-air-sec' + (open ? ' is-open' : '')} data-testid={testId} {...attrs}>
      {onToggle
        ? <button type="button" className="pgf-air-h" onClick={onToggle} aria-expanded={open}>{head}</button>
        : <div className="pgf-air-h">{head}</div>}
      {open && children}
    </section>
  );
}
