// After a new deploy, a page still running the previous build asks for code chunks that no longer
// exist ("error loading dynamically imported module" / "Failed to fetch dynamically imported module").
// Reload once to pick up the new build; a guard stops a reload loop if the chunk is really missing.
const KEY = 'pgf.staleReload';

export function isChunkLoadError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS/i.test(m);
}

/** Reloads the page once per minute at most; returns whether it is reloading. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage unavailable: reload anyway */ }
  window.location.reload();
  return true;
}

export function installStaleBuildReload(): void {
  // Vite fires this when a preload of a lazy chunk fails.
  window.addEventListener('vite:preloadError', (ev) => { if (reloadForNewBuild()) ev.preventDefault(); });
}
