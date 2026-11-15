// Small immutable array helpers.

/** A copy of `list` with the item at `from` moved to index `to` (clamped to the list). */
export function moveAt<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const t = Math.max(0, Math.min(out.length - 1, to));
  if (t === from) return out;
  const [x] = out.splice(from, 1);
  out.splice(t, 0, x);
  return out;
}
