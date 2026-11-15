// Resizable editor panels: a drag handle (mouse, touch, pen; arrow keys when focused; double-click
// resets) that sets one panel's size in px, remembered per browser in localStorage.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ResizableOpts {
  /** localStorage key. */
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
}

const read = (key: string): number | null => {
  try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
};
const write = (key: string, v: number | null) => {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, String(Math.round(v))); } catch { /* ignore */ }
};

export function useResizable(o: ResizableOpts) {
  const maxOf = useCallback(() => (typeof o.max === 'function' ? o.max() : o.max), [o.max]);
  const clamp = useCallback((v: number) => Math.max(o.min, Math.min(maxOf(), v)), [o.min, maxOf]);
  const [size, setSize] = useState<number | null>(() => { const v = read(o.key) ?? o.initial; return v == null ? null : v; });
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  // Keep a remembered size inside the limits when the window shrinks.
  useEffect(() => {
    const onResize = () => setSize((s) => (s == null ? s : clamp(s)));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const commit = useCallback((v: number | null) => { setSize(v); write(o.key, v); }, [o.key]);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = panelRef.current;
    const start = o.axis === 'x' ? e.clientX : e.clientY;
    const startSize = size ?? (el ? (o.axis === 'x' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height) : o.min);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    let last = startSize;
    const move = (ev: PointerEvent) => {
      const d = ((o.axis === 'x' ? ev.clientX : ev.clientY) - start) * o.dir;
      last = clamp(startSize + d);
      setSize(last);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDragging(false);
      write(o.key, last);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const grow = o.axis === 'x' ? (o.dir === 1 ? 'ArrowRight' : 'ArrowLeft') : (o.dir === 1 ? 'ArrowDown' : 'ArrowUp');
    const shrink = o.axis === 'x' ? (o.dir === 1 ? 'ArrowLeft' : 'ArrowRight') : (o.dir === 1 ? 'ArrowUp' : 'ArrowDown');
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    const el = panelRef.current;
    const cur = size ?? (el ? (o.axis === 'x' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height) : o.min);
    commit(clamp(cur + (e.key === grow ? 1 : -1) * (e.shiftKey ? 80 : 20)));
  };

  const handleProps = {
    role: 'separator' as const,
    tabIndex: 0,
    'aria-orientation': (o.axis === 'x' ? 'vertical' : 'horizontal') as 'vertical' | 'horizontal',
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
