// After a new deploy, a page still running the previous build asks for code chunks that no longer
// exist ("error loading dynamically imported module" / "Failed to fetch dynamically imported module").
// Reload once to pick up the new build; a guard stops a reload loop if the chunk is really missing.
// While that reload is on its way, ErrorBoundary shows the loading screen for any error (the failed
// lazy import surfaces as a chunk error, or in some browsers as some other error), never "Something
// went wrong".
export const STALE_RELOAD_KEY = 'pgf.staleReload';
/** At most one stale-build reload per this long (a chunk that is really missing must not loop). */
export const RELOAD_GUARD_MS = 60_000;
/** How long after starting the reload an error is still taken to be the stale build's. */
export const RELOAD_PENDING_MS = 10_000;

/** Indirection so tests can observe the reload (jsdom cannot navigate). */
export const nav = { reload: (): void => window.location.reload(), now: (): number => Date.now() };

/** When this page started a stale-build reload (0: never). */
let reloadStartedAt = 0;

export function isChunkLoadError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS/i.test(m);
}

/** Reloads the page once per minute at most; returns whether it is reloading. */
export function reloadForNewBuild(): boolean {
  const now = nav.now();
  try {
    const last = Number(sessionStorage.getItem(STALE_RELOAD_KEY) || 0);
    if (now - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(STALE_RELOAD_KEY, String(now));
  } catch {
    /* storage unavailable: reload anyway */
  }
  reloadStartedAt = now;
  nav.reload();
  return true;
}

/**
 * Whether this page started a stale-build reload within the last RELOAD_PENDING_MS (the time stamp
 * reloadForNewBuild wrote under STALE_RELOAD_KEY, as this page wrote it: the freshly loaded page, which
 * finds the key set by its predecessor, is not reloading).
 */
export function staleReloadPending(): boolean {
  return reloadStartedAt > 0 && nav.now() - reloadStartedAt < RELOAD_PENDING_MS;
}

/** Milliseconds left of the pending window (0 when not pending). */
export function staleReloadPendingFor(): number {
  return staleReloadPending() ? RELOAD_PENDING_MS - (nav.now() - reloadStartedAt) : 0;
}

/** For tests: forget this page's reload. */
export function resetStaleBuildState(): void {
  reloadStartedAt = 0;
}

export function installStaleBuildReload(): void {
  // Vite fires this when a preload of a lazy chunk fails. Do NOT preventDefault: that makes the lazy
  // import resolve to undefined, React throws a generic error and the ErrorBoundary would flash
  // "Something went wrong" before the reload lands (Firefox). Letting the chunk error propagate
  // shows the loading screen instead.
  window.addEventListener('vite:preloadError', () => {
    reloadForNewBuild();
  });
}
