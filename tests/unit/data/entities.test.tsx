// @vitest-environment jsdom
// The React side of the data layer: useEntity, useAsync's refetch options, request sequencing, and
// the session pilot that follows profile changes made anywhere (the stale "missing licence number").
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { api } from '../../../src/data/api';
import { invalidate, onInvalidate, putEntity, useEntity } from '../../../src/data/entities';
import { __resetEntityStoreForTests, CHANNEL_NAME, registerFetcher, revalidate } from '../../../src/data/entityStore';
import { useAsync } from '../../../src/data/useAsync';
import { latestOnly, sequencer } from '../../../src/data/sequence';
import { AuthGate } from '../../../src/app/AuthGate';
import { useSession } from '../../../src/app/session';
import type { Passenger, Pilot, SessionResponse } from '../../../src/shared';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => { resolve = a; });
  return { promise, resolve };
}

const pilot = (over: Partial<Pilot> = {}): Pilot => ({ id: 'p1', fullName: 'A. Pilot', licenceNo: '', email: 'a@b', ...over }) as Pilot;
const pax = (name: string) => ({ id: name, fullName: name }) as Passenger;

beforeEach(() => {
  // re-register the API fetchers after a reset (entities.ts registers them on import)
  __resetEntityStoreForTests({ channel: true });
  registerFetcher('pilot', () => api.me.get());
  registerFetcher('passengers', () => api.passengers.list());
  registerFetcher('aircraft', () => api.aircraft.list());
  registerFetcher('operators', () => api.operators.list());
  registerFetcher('waypoints', () => api.waypoints.list());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
afterAll(() => __resetEntityStoreForTests());

describe('useEntity', () => {
  function List({ id }: { id: string }) {
    const { data, loading } = useEntity('passengers');
    return <p data-testid={id}>{loading ? 'loading' : data!.map((p) => p.fullName).join(',')}</p>;
  }

  it('shares one copy between components and refetches after a mutation', async () => {
    let rows = [pax('Anna')];
    const list = vi.spyOn(api.passengers, 'list').mockImplementation(async () => rows);
    render(<><List id="a" /><List id="b" /></>);
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('Anna'));
    expect(screen.getByTestId('b').textContent).toBe('Anna');
    expect(list).toHaveBeenCalledTimes(1);

    // a create through the API layer invalidates 'passengers'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(pax('Bob')), { status: 201 })));
    rows = [pax('Anna'), pax('Bob')];
    await act(async () => { await api.passengers.create({ fullName: 'Bob' } as never); });
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('Anna,Bob'));
    expect(screen.getByTestId('b').textContent).toBe('Anna,Bob');
    vi.unstubAllGlobals();
  });

  it('keeps showing the cached copy while it refetches', async () => {
    const d = deferred<Passenger[]>();
    vi.spyOn(api.passengers, 'list').mockResolvedValueOnce([pax('Anna')]).mockReturnValueOnce(d.promise);
    render(<List id="a" />);
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('Anna'));
    act(() => invalidate('passengers', { broadcast: false }));
    expect(screen.getByTestId('a').textContent).toBe('Anna');
    await act(async () => d.resolve([pax('Zoe')]));
    expect(screen.getByTestId('a').textContent).toBe('Zoe');
  });

  it('refetches when another tab says the list changed', async () => {
    vi.spyOn(api.passengers, 'list').mockResolvedValueOnce([pax('Anna')]).mockResolvedValueOnce([pax('Anna'), pax('Cleo')]);
    render(<List id="a" />);
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('Anna'));
    const other = new BroadcastChannel(CHANNEL_NAME);
    other.postMessage({ v: 1, type: 'invalidate', keys: ['passengers'], from: 'tab-2' });
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('Anna,Cleo'));
    other.close();
  });

  it('a hidden tab waits until it is shown', async () => {
    const list = vi.spyOn(api.passengers, 'list').mockResolvedValueOnce([pax('Anna')]).mockResolvedValueOnce([pax('Dora')]);
    render(<List id="a" />);
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('Anna'));
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => invalidate('passengers', { broadcast: false }));
    expect(list).toHaveBeenCalledTimes(1);
    vis.mockReturnValue('visible');
    act(() => revalidate());
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('Dora'));
  });
});

describe('what a mutation invalidates', () => {
  // every key the server derives from the changed record: operators list their aircraft, aircraft
  // print their operator's name, a removed share or aircraft clears the pilot's default
  const cases: [string, () => Promise<unknown>, string[]][] = [
    ['aircraft create', () => api.aircraft.create({} as never), ['aircraft', 'pilot', 'operators']],
    ['aircraft update', () => api.aircraft.update('a1', {}), ['aircraft', 'operators']],
    ['aircraft remove', () => api.aircraft.remove('a1'), ['aircraft', 'pilot', 'operators']],
    ['aircraft share add', () => api.shares.add('a1', 'x@y', 'view'), ['aircraft', 'operators']],
    ['aircraft share remove', () => api.shares.remove('a1', 'p2'), ['aircraft', 'operators', 'pilot']],
    ['operator create', () => api.operators.create({} as never), ['operators']],
    ['operator update', () => api.operators.update('o1', {}), ['operators', 'aircraft']],
    ['operator remove', () => api.operators.remove('o1'), ['operators', 'aircraft']],
    ['operator share setRole', () => api.operatorShares.setRole('o1', 'p2', 'edit'), ['operators']],
    ['operator share remove', () => api.operatorShares.remove('o1', 'p2'), ['operators', 'aircraft']],
    ['operator file remove', () => api.operatorFiles.remove('o1', 'f1'), ['operators']],
    ['passenger remove', () => api.passengers.remove('x'), ['passengers', 'flights']],
  ];
  for (const [what, call, keys] of cases) {
    it(what, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
      const seen: string[] = [];
      const off = onInvalidate(['pilot', 'passengers', 'aircraft', 'operators', 'waypoints', 'flights'], (k) => { seen.push(k); });
      await call();
      off();
      vi.unstubAllGlobals();
      expect([...new Set(seen)].sort()).toEqual([...keys].sort());
    });
  }
});

describe('useAsync', () => {
  function Rows({ q, opts }: { q: string; opts?: Parameters<typeof useAsync>[2] }) {
    const { data, loading } = useAsync(() => fetchRows(q), [q], opts);
    return <p data-testid="rows">{loading ? 'loading' : data}</p>;
  }
  let fetchRows: (q: string) => Promise<string>;

  it('a slow answer for old deps never overwrites the newer one', async () => {
    const slow = deferred<string>();
    fetchRows = (q) => (q === 'old' ? slow.promise : Promise.resolve('new'));
    const { rerender } = render(<Rows q="old" />);
    rerender(<Rows q="new" />);
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('new'));
    await act(async () => slow.resolve('old'));
    expect(screen.getByTestId('rows').textContent).toBe('new');
  });

  it('invalidatedBy and refetchOnFocus refetch in the background', async () => {
    let n = 0;
    fetchRows = async () => `v${++n}`;
    render(<Rows q="x" opts={{ invalidatedBy: 'flights', refetchOnFocus: true }} />);
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('v1'));
    act(() => invalidate('flights', { broadcast: false }));
    expect(screen.getByTestId('rows').textContent).toBe('v1'); // no loading flash
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('v2'));
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('v3'));
  });
});

describe('sequencing helpers', () => {
  it('sequencer: only the newest request is current', () => {
    const s = sequencer();
    const a = s.next(), b = s.next();
    expect(a()).toBe(false);
    expect(b()).toBe(true);
    s.cancel();
    expect(b()).toBe(false);
  });
  it('latestOnly: every caller gets the newest answer', async () => {
    const d1 = deferred<number>(), d2 = deferred<number>();
    const f = latestOnly((d: Promise<number>) => d);
    const p1 = f(d1.promise), p2 = f(d2.promise);
    d2.resolve(2);
    d1.resolve(1);
    await expect(p1).resolves.toBe(2);
    await expect(p2).resolves.toBe(2);
  });
});

describe('session pilot freshness', () => {
  function Missing() {
    const { pilot: p, setPilot } = useSession();
    const [n, setN] = useState(0);
    return (
      <>
        <p data-testid="missing">{p.licenceNo ? 'complete' : 'Missing licence number'}</p>
        <button onClick={() => { setPilot({ ...p, phone: String(n) }); setN(n + 1); }}>bump</button>
      </>
    );
  }
  const session = (p: Pilot): SessionResponse => ({ authed: true, mode: 'local', googleClientId: null, pilot: p }) as SessionResponse;

  it('clears the warning when the profile changes through the API layer (same tab)', async () => {
    vi.spyOn(api, 'session').mockResolvedValue(session(pilot()));
    render(<AuthGate><Missing /></AuthGate>);
    await waitFor(() => expect(screen.getByTestId('missing').textContent).toBe('Missing licence number'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(pilot({ licenceNo: 'GR.FCL.PPL.1' })), { status: 200 })));
    await act(async () => { await api.me.update({ licenceNo: 'GR.FCL.PPL.1' }); });
    expect(screen.getByTestId('missing').textContent).toBe('complete');
    vi.unstubAllGlobals();
  });

  it('clears the warning when another tab changes the profile', async () => {
    vi.spyOn(api, 'session').mockResolvedValue(session(pilot()));
    const me = vi.spyOn(api.me, 'get').mockResolvedValue(pilot({ licenceNo: 'GR.FCL.PPL.1' }));
    render(<AuthGate><Missing /></AuthGate>);
    await waitFor(() => expect(screen.getByTestId('missing').textContent).toBe('Missing licence number'));
    const other = new BroadcastChannel(CHANNEL_NAME);
    other.postMessage({ v: 1, type: 'invalidate', keys: ['pilot'], from: 'tab-2' });
    await waitFor(() => expect(screen.getByTestId('missing').textContent).toBe('complete'));
    expect(me).toHaveBeenCalledTimes(1);
    other.close();
  });

  it('setPilot builds on the freshest pilot', async () => {
    vi.spyOn(api, 'session').mockResolvedValue(session(pilot()));
    render(<AuthGate><Missing /></AuthGate>);
    await waitFor(() => screen.getByTestId('missing'));
    // a fresher pilot arrives (e.g. a refetch); a later setPilot from the page keeps it
    act(() => putEntity('pilot', pilot({ licenceNo: 'GR.FCL.PPL.1' })));
    expect(screen.getByTestId('missing').textContent).toBe('complete');
    act(() => screen.getByText('bump').click());
    expect(screen.getByTestId('missing').textContent).toBe('complete');
  });
});
