// @vitest-environment jsdom
// The aircraft page's autosave: edits within the delay coalesce into one save, edits made while a
// save is in flight go in the next one, nothing is saved while disabled (errors), a failure waits for
// retry, and leaving the page saves what is pending.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAutosave } from '../../../src/features/hangar/useAutosave';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(initial: { v: string; enabled?: boolean }) {
  const calls: string[] = [];
  const pending: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  const save = vi.fn((v: string) => {
    calls.push(v);
    return new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  });
  const hook = renderHook(
    ({ v, enabled = true }: { v: string; enabled?: boolean }) => useAutosave({ value: v, enabled, save, delay: 800 }),
    { initialProps: initial },
  );
  return { calls, pending, hook };
}

describe('useAutosave', () => {
  test('edits within the delay coalesce into one save', async () => {
    const { calls, pending, hook } = setup({ v: 'a' });
    expect(hook.result.current.status).toBe('idle');
    hook.rerender({ v: 'ab' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    hook.rerender({ v: 'abc' });
    expect(hook.result.current.status).toBe('pending');
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(calls).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(calls).toEqual(['abc']);
    expect(hook.result.current.status).toBe('saving');
    await act(async () => {
      pending[0].resolve();
    });
    expect(hook.result.current.status).toBe('saved');
    expect(hook.result.current.dirty).toBe(false);
  });

  test('one save at a time: edits made meanwhile go in the next', async () => {
    const { calls, pending, hook } = setup({ v: '1' });
    hook.rerender({ v: '2' });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    hook.rerender({ v: '3' });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(calls).toEqual(['2']);
    await act(async () => {
      pending[0].resolve();
    });
    expect(hook.result.current.status).toBe('pending');
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(calls).toEqual(['2', '3']);
    await act(async () => {
      pending[1].resolve();
    });
    expect(hook.result.current.status).toBe('saved');
  });

  test('disabled (errors): nothing is saved until enabled again', async () => {
    const { calls, pending, hook } = setup({ v: 'x' });
    hook.rerender({ v: '', enabled: false });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(calls).toEqual([]);
    expect(hook.result.current.dirty).toBe(true);
    hook.rerender({ v: 'y', enabled: true });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(calls).toEqual(['y']);
    await act(async () => {
      pending[0].resolve();
    });
  });

  test('a failure waits for retry; flush saves at once', async () => {
    const { calls, pending, hook } = setup({ v: 'a' });
    hook.rerender({ v: 'b' });
    act(() => {
      hook.result.current.flush();
    });
    expect(calls).toEqual(['b']);
    await act(async () => {
      pending[0].reject(new Error('down'));
    });
    expect(hook.result.current.status).toBe('failed');
    expect((hook.result.current.error as Error).message).toBe('down');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(calls).toEqual(['b']);
    act(() => {
      hook.result.current.retry();
    });
    expect(calls).toEqual(['b', 'b']);
    await act(async () => {
      pending[1].resolve();
    });
    expect(hook.result.current.status).toBe('saved');
    expect(hook.result.current.error).toBe(null);
  });

  test('leaving the page saves what is pending', async () => {
    const { calls, hook } = setup({ v: 'a' });
    hook.rerender({ v: 'b' });
    hook.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toEqual(['b']);
  });
});
