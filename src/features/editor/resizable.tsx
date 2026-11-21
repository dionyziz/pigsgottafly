// Resizable editor panels: a drag handle (mouse, touch, pen; arrow keys when focused; double-click
// resets) that sets one panel's size in px, remembered per browser in localStorage.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ResizableOpts {
  key: string;
  /** 'x': the handle moves left/right and sets a width; 'y': up/down and sets a height. */
  axis: 'x' | 'y';
  /** +1: dragging right/down grows the panel (handle on its right/bottom edge); -1: the opposite. */
  dir: 1 | -1;
  min: number;
  /** Largest size: px, or a function of the window size (evaluated on each drag and window resize). */
  max: number | (() => number);
  /** null = the panel's own CSS size until the pilot drags. */
  initial: number | null;
  /** Released with the edge dragged below this size (px): onCollapse() instead of a new size. */
  collapseBelow?: number;
  onCollapse?: () => void;
}

const read = (key: string): number | null => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const write = (key: string, v: number | null) => {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(v)));
  } catch {
    /* ignore */
  }
};

export function useResizable(o: ResizableOpts) {
  const { max } = o;
  const maxOf = useCallback(() => (typeof max === 'function' ? max() : max), [max]);
  const clamp = useCallback((v: number) => Math.max(o.min, Math.min(maxOf(), v)), [o.min, maxOf]);
  const [size, setSize] = useState<number | null>(() => {
    const v = read(o.key) ?? o.initial;
    return v == null ? null : v;
  });
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  // Keep a remembered size inside the limits when the window shrinks.
  useEffect(() => {
    const onResize = () => setSize((s) => (s == null ? s : clamp(s)));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const commit = useCallback(
    (v: number | null) => {
      setSize(v);
      write(o.key, v);
    },
    [o.key],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = panelRef.current;
    const start = o.axis === 'x' ? e.clientX : e.clientY;
    const startSize =
      size ?? (el ? (o.axis === 'x' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height) : o.min);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    // a panel at its CSS size takes an explicit size first (one render), so its CSS limits stop applying
    if (size == null) setSize(startSize);
    // While dragging, the size goes straight to the element's style once per frame: no React render per
    // pointer move (nothing in the panels re-renders, and the map resizes its canvas in the same frame,
    // see RouteMap). The state and localStorage take the final size on release.
    let last = startSize;
    let raw = startSize;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const t = panelRef.current;
      if (t) t.style[o.axis === 'x' ? 'width' : 'height'] = `${last}px`;
    };
    const move = (ev: PointerEvent) => {
      const d = ((o.axis === 'x' ? ev.clientX : ev.clientY) - start) * o.dir;
      raw = startSize + d;
      last = clamp(raw);
      if (o.onCollapse && o.collapseBelow != null)
        panelRef.current?.classList.toggle('will-collapse', raw < o.collapseBelow);
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (raf) cancelAnimationFrame(raf);
      panelRef.current?.classList.remove('will-collapse');
      setDragging(false);
      if (o.onCollapse && o.collapseBelow != null && raw < o.collapseBelow) {
        // collapsed: the panel keeps the width it had for when it opens again
        last = startSize;
        apply();
        commit(startSize);
        o.onCollapse();
        return;
      }
      apply();
      commit(last);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const grow = o.axis === 'x' ? (o.dir === 1 ? 'ArrowRight' : 'ArrowLeft') : o.dir === 1 ? 'ArrowDown' : 'ArrowUp';
    const shrink = o.axis === 'x' ? (o.dir === 1 ? 'ArrowLeft' : 'ArrowRight') : o.dir === 1 ? 'ArrowUp' : 'ArrowDown';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    const el = panelRef.current;
    const cur =
      size ?? (el ? (o.axis === 'x' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height) : o.min);
    commit(clamp(cur + (e.key === grow ? 1 : -1) * (e.shiftKey ? 80 : 20)));
  };

  const orientation: 'vertical' | 'horizontal' = o.axis === 'x' ? 'vertical' : 'horizontal';
  const handleProps = {
    role: 'separator' as const,
    tabIndex: 0,
    'aria-orientation': orientation,
    'aria-valuemin': o.min,
    'aria-valuenow': size == null ? undefined : Math.round(size),
    title: 'Drag to resize · double-click to reset',
    className: `resize-handle ${o.axis}${dragging ? ' dragging' : ''}`,
    onPointerDown,
    onKeyDown,
    onDoubleClick: () => commit(o.initial),
  };
  return { size, dragging, panelRef, handleProps };
}
