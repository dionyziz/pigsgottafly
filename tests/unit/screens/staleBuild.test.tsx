// @vitest-environment jsdom
// After a deploy, a page on the old build reloads once onto the new one (src/app/staleBuild.ts). The
// failed lazy import must never flash "Something went wrong" while the reload is on its way (Firefox:
// vite:preloadError used to be preventDefault-ed, so the import resolved to undefined and React threw
// a generic error).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  installStaleBuildReload,
  isChunkLoadError,
  nav,
  reloadForNewBuild,
  resetStaleBuildState,
  RELOAD_GUARD_MS,
  RELOAD_PENDING_MS,
  staleReloadPending,
  STALE_RELOAD_KEY,
} from '../../../src/app/staleBuild';
import { ErrorBoundary } from '../../../src/app/ErrorBoundary';

let t = 1_700_000_000_000;
let reloads = 0;
beforeEach(() => {
  t += 24 * 3600e3;
  reloads = 0;
  nav.now = () => t;
  nav.reload = () => {
    reloads++;
  };
  sessionStorage.clear();
  resetStaleBuildState();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Boom({ error }: { error: Error }): never {
  throw error;
}

describe('stale build reload', () => {
  test('chunk errors are recognised (Chrome, Firefox, Safari, CSS)', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(
      true,
    );
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/assets/a.js'))).toBe(
      true,
    );
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
    expect(isChunkLoadError(new TypeError("can't access property 'default', n is undefined"))).toBe(false);
  });

  test('reloads once per minute at most; pending for 10 s after the reload starts', () => {
    expect(staleReloadPending()).toBe(false);
    expect(reloadForNewBuild()).toBe(true);
    expect(reloads).toBe(1);
    expect(sessionStorage.getItem(STALE_RELOAD_KEY)).toBe(String(t));
    expect(staleReloadPending()).toBe(true);
    t += RELOAD_PENDING_MS - 1;
    expect(staleReloadPending()).toBe(true);
    expect(reloadForNewBuild()).toBe(false); // the loop guard
    expect(reloads).toBe(1);
    t += 2;
    expect(staleReloadPending()).toBe(false);
    t += RELOAD_GUARD_MS;
    expect(reloadForNewBuild()).toBe(true);
    expect(reloads).toBe(2);
  });

  test('the page loaded by the reload (key already set by its predecessor) is not "reloading"', () => {
    sessionStorage.setItem(STALE_RELOAD_KEY, String(t - 1000));
    expect(staleReloadPending()).toBe(false);
  });

  test('vite:preloadError starts the reload and is NOT prevented (the chunk error propagates)', () => {
    installStaleBuildReload();
    const ev = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(ev);
    expect(reloads).toBe(1);
    expect(ev.defaultPrevented).toBe(false);
  });

  test('ErrorBoundary: a chunk error shows the loading screen and reloads', () => {
    render(
      <ErrorBoundary>
        <Boom error={new TypeError('error loading dynamically imported module: https://x/assets/Editor.js')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(reloads).toBe(1);
  });

  test('ErrorBoundary: any error while a reload is pending shows the loading screen, not the error', () => {
    expect(reloadForNewBuild()).toBe(true); // vite:preloadError
    render(
      <ErrorBoundary>
        <Boom error={new TypeError("can't access property 'default', n is undefined")} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  test('ErrorBoundary: without a pending reload, an error is shown', () => {
    render(
      <ErrorBoundary>
        <Boom error={new Error('real bug')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('real bug')).toBeTruthy();
    expect(reloads).toBe(0);
  });
});
