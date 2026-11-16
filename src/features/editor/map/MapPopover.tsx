// The map's hover tooltip and click popover frames, shared by the airspace, NOTAM and aerodrome details:
// MapTip follows the cursor; MapPopover opens at a click and has a close button; both stay inside the
// map (flipped left / up near its right / bottom edge);
// PopItem + useAccordion make its list of items, one open at a time.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CloseButton } from '../../../ui';

/** Margin kept between a tooltip or popover and the edges of the map. */
const EDGE = 8;

/**
 * Where a box of size w × h goes beside the point (x, y) inside a W × H area: below right of it,
 * flipped to the left / above when it would cross the right / bottom edge, and never outside the area.
 */
export function placeBeside(
  x: number,
  y: number,
  w: number,
  h: number,
  W: number,
  H: number,
  gap: { x: number; y: number },
): { left: number; top: number } {
  let left = x + gap.x,
    top = y + gap.y;
  if (left + w > W - EDGE) left = x - gap.x - w;
  if (top + h > H - EDGE) top = y - gap.y - h;
  left = Math.max(EDGE, Math.min(left, W - EDGE - w));
  top = Math.max(EDGE, Math.min(top, H - EDGE - h));
  return { left, top };
}

/**
 * Keeps an absolutely placed element (a child of the map) beside (x, y) and fully inside the map,
 * after every render (its content may have grown). Sets left/top directly: no extra render.
 */
export function useInsideMap(x: number, y: number, gap: { x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current,
      parent = el?.offsetParent as HTMLElement | null;
    if (!el) return;
    const W = parent?.clientWidth ?? Infinity,
      H = parent?.clientHeight ?? Infinity;
    const { left, top } = placeBeside(x, y, el.offsetWidth, el.offsetHeight, W, H, gap);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });
  return ref;
}

const TIP_GAP = { x: 16, y: 14 };
const POP_GAP = { x: 12, y: 12 };

/** Cursor tooltip (pointer-events none), kept inside the map. */
export function MapTip({
  x,
  y,
  testId,
  className,
  children,
}: {
  x: number;
  y: number;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useInsideMap(x, y, TIP_GAP);
  return (
    <div
      ref={ref}
      className={className ?? 'pgf-air-tip'}
      style={{ left: x + TIP_GAP.x, top: y + TIP_GAP.y }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** Click details, placed beside (x, y) and kept inside the map. */
export function MapPopover({
  x,
  y,
  label,
  testId,
  onClose,
  children,
}: {
  x: number;
  y: number;
  label: string;
  testId: string;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useInsideMap(x, y, POP_GAP);
  return (
    <div
      ref={ref}
      className="pgf-air-pop"
      style={{ left: x + POP_GAP.x, top: y + POP_GAP.y }}
      role="dialog"
      aria-label={label}
      data-testid={testId}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <CloseButton onClick={onClose} className="pgf-air-x" size={10} />
      {children}
    </div>
  );
}

/** Which item of a popover is open ('' = none); the first one to start with. */
export function useAccordion(first: string | undefined) {
  const [open, setOpen] = useState(first ?? '');
  return {
    open,
    isOpen: (k: string) => open === k,
    toggle: (k: string) => setOpen((o) => (o === k ? '' : k)),
    setOpen,
  };
}

/** One item of a popover: a header (a toggle when `onToggle` is given) and, when open, its body. */
export function PopItem({
  open,
  onToggle,
  head,
  children,
  testId,
  data,
}: {
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
      {onToggle ? (
        <button type="button" className="pgf-air-h" onClick={onToggle} aria-expanded={open}>
          {head}
        </button>
      ) : (
        <div className="pgf-air-h">{head}</div>
      )}
      {open && children}
    </section>
  );
}
