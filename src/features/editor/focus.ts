// Works like a ?focus=<key> deep link (src/app/focusParam.ts), without a page load.
import type { WarningFix } from '../../ui';
import { EDITOR_FOCUS_SECTION, type EditorFocus, fixLink, planningFix } from '../exports/fix';

/** 'route' = the route ends (a flight fix without a field); 'section:<id>' opens a whole section. */
export type EditorFocusKey = EditorFocus | 'route' | `section:${string}`;

export function sectionOf(key: string): string | undefined {
  if (key.startsWith('section:')) return key.slice('section:'.length);
  return key === 'route' ? 'route' : EDITOR_FOCUS_SECTION[key as EditorFocus];
}

const listeners = new Set<(key: EditorFocusKey) => void>();

export function focusSection(id: string): void {
  focusInEditor(`section:${id}`);
}

export function focusInEditor(key: EditorFocusKey): void {
  for (const fn of [...listeners]) fn(key);
}

export function onEditorFocus(fn: (key: EditorFocusKey) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A field of this flight is focused in place; the aircraft and the profile are links. */
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
