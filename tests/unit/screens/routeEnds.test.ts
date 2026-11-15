import { describe, expect, it } from 'vitest';
import { aerodrome } from '../../../src/data/ref';
import { setRouteEnd } from '../../../src/features/editor/panels/RouteSection';
import type { RoutePoint } from '../../../src/shared';

const pt = (uid: string, name: string): RoutePoint => ({ uid, kind: 'custom', refId: null, name, lat: 38, lon: 23.5 });

describe('route ends (origin / destination fields)', () => {
  const lgav = aerodrome('LGAV')!;
  const lgmg = aerodrome('LGMG')!;
  it('replaces the first or last point and keeps the points between', () => {
    const r = [pt('a', 'A'), pt('b', 'B'), pt('c', 'C')];
    const o = setRouteEnd(r, 'from', lgav);
    expect(o.map((p) => p.name)).toEqual(['LGAV', 'B', 'C']);
    expect(o[0]).toMatchObject({ kind: 'aerodrome', refId: lgav.id, lat: lgav.lat, lon: lgav.lon });
    expect(o[0].uid).not.toBe('a');
    expect(o[1]).toBe(r[1]);
    expect(setRouteEnd(r, 'to', lgmg).map((p) => p.name)).toEqual(['A', 'B', 'LGMG']);
  });
  it('an empty route gets an origin; a one-point route gets a destination', () => {
    expect(setRouteEnd([], 'from', lgav).map((p) => p.name)).toEqual(['LGAV']);
    expect(setRouteEnd([], 'to', lgav)).toEqual([]);
    expect(setRouteEnd([pt('a', 'A')], 'to', lgmg).map((p) => p.name)).toEqual(['A', 'LGMG']);
  });
});
