// Draw attention to named fields of a form (from a "missing …" link or a ?focus= key): every one is
// highlighted until edited and the first is focused, after the dialog's own autofocus. Targets are
// found as for ?focus= (data-focus, then name, then id: src/app/focusParam.ts).
import { type RefObject, useEffect } from 'react';

import { findFocusTarget, focusAndHighlight } from '../app/focusParam';

const FIELD = 'input:not([type=hidden]), select, textarea';

export function useHighlightFields(root: RefObject<HTMLElement | null>, keys: readonly string[], delayMs = 60): void {
  const key = keys.join(',');
  useEffect(() => {
    const el = root.current;
    if (!el || !key) return;
    const targets = key
      .split(',')
      .map((k) => findFocusTarget(el, k))
      .filter((x): x is HTMLElement => !!x);
    targets.slice(1).forEach((t) => {
      const input = t.matches(FIELD) ? t : (t.querySelector<HTMLElement>(FIELD) ?? t);
      input.classList.add('attention');
      input.addEventListener('input', () => input.classList.remove('attention'), { once: true });
    });
    const timer = setTimeout(() => {
      if (targets[0]) focusAndHighlight(targets[0]);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [root, key, delayMs]);
}
