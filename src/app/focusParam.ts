// "?focus=<key>" deep links: a warning elsewhere links to the page that fixes it, and the field is
// scrolled to, focused and highlighted (.attention, src/app/styles.css) until it is edited.
// Targets: an element with data-focus="<key>" (its first input, select or textarea is focused), else
// an input with name="<key>", else an element with id="<key>" (a section, highlighted).
import { useEffect } from 'react';

/** The ?focus= value of the current URL ('' when none). */
export function focusParam(): string {
  if (typeof window === 'undefined') return '';
  try {
    return new URLSearchParams(window.location.search).get('focus') ?? '';
  } catch {
    return '';
  }
}

const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

export function findFocusTarget(root: ParentNode, key: string): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(`[data-focus="${esc(key)}"]`) ??
    root.querySelector<HTMLElement>(`[name="${esc(key)}"]`) ??
    root.querySelector<HTMLElement>(`#${esc(key)}`)
  );
}

const FIELD =
  'input:not([type=hidden]):not([type=checkbox]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Scrolls to the element, focuses its input and highlights it until it is edited. */
export function focusAndHighlight(el: HTMLElement): void {
  const input = el.matches(FIELD) ? el : el.querySelector<HTMLElement>(FIELD);
  const target = input ?? el;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('attention');
  if (input) {
    const clear = () => target.classList.remove('attention');
    input.addEventListener('input', clear, { once: true });
    input.addEventListener('change', clear, { once: true });
    input.focus({ preventScroll: true });
    if (input instanceof HTMLInputElement && /^(text|search|tel|)$/.test(input.type)) input.select();
  } else {
    window.setTimeout(() => target.classList.remove('attention'), 4000);
  }
}

/**
 * Once `enabled`, waits (up to 4 s, for data still loading) for the ?focus= target inside `root`
 * to render, then focuses and highlights it. Runs once per key.
 */
export function useFocusParam(root: () => ParentNode | null, enabled = true, key = focusParam()): void {
  useEffect(() => {
    if (!enabled || !key) return;
    let tries = 0;
    let timer = 0;
    const attempt = () => {
      const r = root();
      const el = r ? findFocusTarget(r, key) : null;
      if (el) {
        focusAndHighlight(el);
        return;
      }
      if (++tries < 40) timer = window.setTimeout(attempt, 100);
    };
    timer = window.setTimeout(attempt, 50);
    return () => window.clearTimeout(timer);
  }, [enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
