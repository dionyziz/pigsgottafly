// Looking at an earlier version of an aircraft (GET /api/aircraft/:id/revisions/:rev): which of its
// differences from the current aircraft are fields of the form and which are files, and where in the
// form each field is, to highlight it.
import type { AircraftLogChange } from '../../shared/sharing';

/** Changes of the photo and documents ('photo', 'documents.<id>'): listed, but not in the form. */
export const isFileChange = (c: AircraftLogChange) => c.path === 'photo' || c.path.startsWith('documents.');

export function splitChanges(changes: AircraftLogChange[]): {
  fields: AircraftLogChange[];
  files: AircraftLogChange[];
} {
  return { fields: changes.filter((c) => !isFileChange(c)), files: changes.filter(isFileChange) };
}

/**
 * The element of the form a path is about: inputs are named by their path (name="fuel.usableL"),
 * lists and tables carry data-path; a path with no element of its own (a summarized table such as
 * 'performance.takeoff.table') falls back to its parent path.
 */
export function pathTarget(root: ParentNode, path: string): HTMLElement | null {
  const parts = path ? path.split('.') : [];
  for (let n = parts.length; n > 0; n--) {
    const p = parts.slice(0, n).join('.').replace(/["\\]/g, '');
    const el =
      root.querySelector<HTMLElement>(`[name="${p}"], [data-path="${p}"]`) ??
      root.querySelector<HTMLElement>(`[name^="${p}."], [data-path^="${p}."]`);
    if (el) return el;
  }
  return null;
}

export const CHANGED_CLASS = 'rev-changed';

/** Marks the form's fields that differ (their label, else the element); returns the undo. */
export function markChanged(root: ParentNode, changes: AircraftLogChange[]): () => void {
  const marked = new Set<HTMLElement>();
  for (const c of splitChanges(changes).fields) {
    const el = pathTarget(root, c.path);
    if (!el) continue;
    const box = el.closest<HTMLElement>('label.field') ?? el;
    box.classList.add(CHANGED_CLASS);
    marked.add(box);
  }
  return () => marked.forEach((el) => el.classList.remove(CHANGED_CLASS));
}
