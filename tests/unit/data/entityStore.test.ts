// The entity cache and invalidation bus (src/data/entityStore.ts): request sequencing, invalidation,
// cross-tab broadcasts, focus revalidation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetEntityStoreForTests, CHANNEL_NAME, clearEntities, getEntity, invalidate, loadEntity, onInvalidate, putEntity,
  registerFetcher, revalidate, subscribeEntity,
} from '../../../src/data/entityStore';

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

let clock = 1000;
beforeEach(() => { clock = 1000; __resetEntityStoreForTests({ now: () => clock }); });
afterEach(() => __resetEntityStoreForTests());

describe('entity cache', () => {
  it('loads once for concurrent callers and stores the answer', async () => {
    const fetch = vi.fn(async () => ['a']);
    registerFetcher('passengers', fetch);
    const [x, y] = await Promise.all([loadEntity('passengers'), loadEntity('passengers')]);
    expect(x).toEqual(['a']);
    expect(y).toBe(x);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getEntity('passengers')).toMatchObject({ data: ['a'], stale: false, fetching: false, at: 1000 });
  });

  it('keeps only the newest answer: a slow older request never overwrites a newer one', async () => {
    const calls: ReturnType<typeof deferred<string[]>>[] = [];
    registerFetcher('passengers', () => { const d = deferred<string[]>(); calls.push(d); return d.promise; });
    const first = loadEntity('passengers');
    const second = loadEntity('passengers', { force: true });
    calls[1].resolve(['new']);
    await second;
    calls[0].resolve(['old']);
    await expect(first).resolves.toEqual(['new']);
    expect(getEntity('passengers').data).toEqual(['new']);
  });

  it('a value put while a request is in flight wins over that request', async () => {
    const d = deferred<string[]>();
    registerFetcher('waypoints', () => d.promise);
    const p = loadEntity('waypoints');
    putEntity('waypoints', ['local']);
    d.resolve(['server-before']);
    await p;
    expect(getEntity('waypoints').data).toEqual(['local']);
  });

  it('a failed refetch keeps the data; a failed first load reports the error', async () => {
    let fail = false;
    registerFetcher('aircraft', async () => { if (fail) throw new Error('down'); return ['SX-ASV']; });
    await loadEntity('aircraft');
    fail = true;
    await expect(loadEntity('aircraft', { force: true })).resolves.toEqual(['SX-ASV']);
    expect(getEntity('aircraft')).toMatchObject({ data: ['SX-ASV'], error: expect.any(Error) });
    clearEntities();
    await expect(loadEntity('aircraft')).rejects.toThrow('down');
    expect(getEntity('aircraft').data).toBeUndefined();
  });

  it('notifies subscribers with a new snapshot object on every change', async () => {
    registerFetcher('pilot', async () => ({ id: 'p1' }));
    const seen: unknown[] = [];
    const off = subscribeEntity('pilot', () => seen.push(getEntity('pilot')));
    await loadEntity('pilot');
    off();
    putEntity('pilot', { id: 'p1', x: 1 });
    expect(seen.length).toBe(2); // fetching, then data
    expect(seen[0]).not.toBe(seen[1]);
  });
});

describe('invalidation', () => {
  it('refetches a key that is on screen; only marks it stale otherwise', async () => {
    const fetch = vi.fn(async () => ['x']);
    registerFetcher('passengers', fetch);
    await loadEntity('passengers');
    invalidate('passengers');
    expect(getEntity('passengers').stale).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const off = subscribeEntity('passengers', () => {});
    invalidate('passengers');
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getEntity('passengers').stale).toBe(false);
    off();
  });

  it('calls onInvalidate listeners for their keys only', () => {
    const seen: string[] = [];
    const off = onInvalidate(['aircraft', 'flights'], (k) => seen.push(k));
    invalidate(['passengers', 'aircraft']);
    invalidate('flights');
    off();
    invalidate('flights');
    expect(seen).toEqual(['aircraft', 'flights']);
  });

  it('focus refetches data older than 5 s that is on screen', async () => {
    const fetch = vi.fn(async () => ({ id: 'p' }));
    registerFetcher('pilot', fetch);
    const off = subscribeEntity('pilot', () => {});
    await loadEntity('pilot');
    clock += 1000;
    revalidate();
    expect(fetch).toHaveBeenCalledTimes(1);
    clock += 5000;
    revalidate();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    off();
  });
});

describe('other tabs (BroadcastChannel)', () => {
  it('tells the other tabs what changed, and follows theirs', async () => {
    __resetEntityStoreForTests({ now: () => clock, channel: true });
    const other = new BroadcastChannel(CHANNEL_NAME);
    try {
      const got: unknown[] = [];
      other.onmessage = (e) => got.push(e.data);
      invalidate(['passengers']);
      putEntity('pilot', { id: 'p1' }, { broadcast: true });
      putEntity('pilot', { id: 'p1', quiet: true });
      await vi.waitFor(() => expect(got.length).toBe(2));
      expect(got[0]).toMatchObject({ v: 1, type: 'invalidate', keys: ['passengers'] });
      expect(got[1]).toMatchObject({ keys: ['pilot'] });

      const fetch = vi.fn(async () => ({ id: 'p1', licenceNo: 'GR.FCL.PPL.1' }));
      registerFetcher('pilot', fetch);
      const off = subscribeEntity('pilot', () => {});
      const heard: string[] = [];
      const off2 = onInvalidate('pilot', (k) => heard.push(k));
      other.postMessage({ v: 1, type: 'invalidate', keys: ['pilot', 'bogus'], from: 'another-tab' });
      await vi.waitFor(() => expect(getEntity('pilot').data).toMatchObject({ licenceNo: 'GR.FCL.PPL.1' }));
      expect(heard).toEqual(['pilot']);
      off(); off2();
    } finally {
      other.close();
    }
  });
});
