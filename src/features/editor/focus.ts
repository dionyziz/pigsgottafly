// Focus a field of the editor in place: a warning's fix (navlog strip, Documents) opens the panel and
// the section holding that field, then scrolls to it, focuses and highlights it — the same as a
// ?focus=<key> deep link (src/app/focusParam.ts), without a page load.
import type { WarningFix } from '../../ui';
import { EDITOR_FOCUS_SECTION, type EditorFocus, fixLink, planningFix } from '../exports/fix';

/** A focus key, or 'route' (the route ends) for a flight fix without a field. */
export type EditorFocusKey = EditorFocus | 'route';

/** The panel section (Section id) holding a focus key. */
export function sectionOf(key: string): string | undefined {
  return key === 'route' ? 'route' : EDITOR_FOCUS_SECTION[key as EditorFocus];
}

const listeners = new Set<(key: EditorFocusKey) => void>();

/** Open the section holding `key` and focus its field. */
export function focusInEditor(key: EditorFocusKey): void {
  for (const fn of [...listeners]) fn(key);
}

export function onEditorFocus(fn: (key: EditorFocusKey) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The fix of a planning warning seen in the editor: a field of this flight is focused in place; the
 * aircraft and the profile are links.
 */
export function editorWarningFix(text: string, aircraftId: string | null): WarningFix | null {
  const f = planningFix(text);
  if (!f) return null;
  if (f.kind === 'flight') {
    const key: EditorFocusKey = f.focus ?? 'route';
    return { label: 'Fix', onFix: () => focusInEditor(key) };
  }
  const l = fixLink(f, { aircraftId });
  return l ? { label: l.label, to: l.to } : null;
}
