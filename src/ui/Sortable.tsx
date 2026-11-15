// Reordering a vertical list (rows of a table, cards) by a drag handle on the left of each item:
// pointer drag on the handle, or Alt+↑/↓ from anywhere in the item (the handle itself also takes
// plain ↑/↓). The caller keeps the order and applies onMove(from, to), e.g. with moveAt().
//
//   const s = useSortable({ count: rows.length, onMove: (a, b) => set(moveAt(rows, a, b)) });
//   rows.map((r, i) => <tr key={r.id} {...s.itemProps(i)}><td><DragHandle {...s.handleProps(i)} /></td>…</tr>)
import { forwardRef, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from './Icon';

export interface SortableOptions {
  count: number;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
}

/** The index a pointer at `y` drops on, given the items' vertical extents (top, bottom), in order. */
export function dropIndex(y: number, rects: readonly { top: number; bottom: number }[], from: number): number {
  let to = from;
  for (let i = 0; i < rects.length; i++) {
    const mid = (rects[i].top + rects[i].bottom) / 2;
    if (i < from && y < mid) return i;
    if (i > from && y > mid) to = i;
  }
  return to;
}

export function useSortable({ count, onMove, disabled }: SortableOptions) {
  const items = useRef<(HTMLElement | null)[]>([]);
  const handles = useRef<(HTMLElement | null)[]>([]);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragRef = useRef<{ from: number; to: number; id: number } | null>(null);
  const focusAfter = useRef<number | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // After a keyboard move, keep the focus on the moved item's handle.
  useEffect(() => {
    if (focusAfter.current == null) return;
    handles.current[focusAfter.current]?.focus();
    focusAfter.current = null;
  });

  const move = useCallback((from: number, to: number, refocus: boolean) => {
    if (to < 0 || to >= count || to === from) return;
    if (refocus) focusAfter.current = to;
    onMoveRef.current(from, to);
  }, [count]);

  const keyMove = (i: number, e: KeyboardEvent, needAlt: boolean) => {
    if (disabled || (needAlt && !e.altKey)) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    move(i, e.key === 'ArrowUp' ? i - 1 : i + 1, true);
  };

  const rects = () => items.current.slice(0, count).map((el) => {
    const r = el?.getBoundingClientRect();
    return { top: r?.top ?? 0, bottom: r?.bottom ?? 0 };
  });

  /** Props of item i (merges `className` with the drag state classes). */
  const itemProps = (i: number, className?: string) => ({
    ref: (el: HTMLElement | null) => { items.current[i] = el; },
    'data-sort-index': i,
    className: [className, drag && (drag.from === i ? 'sort-dragging' : drag.to === i ? (drag.to < drag.from ? 'sort-over-before' : 'sort-over-after') : '')].filter(Boolean).join(' ') || undefined,
    onKeyDown: (e: KeyboardEvent) => keyMove(i, e, true),
  });

  const handleProps = (i: number) => ({
    ref: (el: HTMLElement | null) => { handles.current[i] = el; },
    disabled: disabled || count < 2,
    onKeyDown: (e: KeyboardEvent) => keyMove(i, e, false),
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (disabled || count < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
      dragRef.current = { from: i, to: i, id: e.pointerId };
      setDrag({ from: i, to: i });
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.id !== e.pointerId) return;
      const to = dropIndex(e.clientY, rects(), d.from);
      if (to !== d.to) { d.to = to; setDrag({ from: d.from, to }); }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.id !== e.pointerId) return;
      dragRef.current = null;
      setDrag(null);
      move(d.from, d.to, false);
    },
    onPointerCancel: () => { dragRef.current = null; setDrag(null); },
  });

  return { itemProps, handleProps, dragging: drag?.from ?? null, over: drag?.to ?? null };
}

type HandleProps = Omit<ReturnType<ReturnType<typeof useSortable>['handleProps']>, 'ref'>;

/** The ⠿ handle on the left of a sortable item. Spread handleProps(i) into it. */
export const DragHandle = forwardRef<HTMLButtonElement, HandleProps & { label?: string }>(function DragHandle({ label = 'Reorder', ...rest }, ref) {
  return (
    <button type="button" ref={ref} className="icon sm drag-handle" aria-label={`${label} (Alt+↑/↓)`} title={`${label}: drag, or Alt+↑/↓`} {...rest}>
      <Icon name="grip" size={14} />
    </button>
  );
});
