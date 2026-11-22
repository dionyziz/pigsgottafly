// How an aerodrome becomes a route point. One rule for the new-flight page, the editor (route
// fields, map snapping, labels) and the server's home route: the ICAO code, else the last part of
// the name ('Kalamaki / Megara Field' → 'Megara Field' for an ICAO-less airstrip).
import { uid } from './constants.js';
import type { RefAerodrome } from './ref.js';
import type { RoutePoint } from './types.js';

/** The name a route point, a label or a list shows for an aerodrome. */
export function aerodromeName(a: Pick<RefAerodrome, 'icao' | 'name'>): string {
  return a.icao || a.name.split('/').pop()!.trim() || a.name;
}

/** A new route point at an aerodrome (fresh uid). */
export function aerodromePoint(a: Pick<RefAerodrome, 'id' | 'icao' | 'name' | 'lat' | 'lon'>): RoutePoint {
  return { uid: uid(), kind: 'aerodrome', refId: a.id, name: aerodromeName(a), lat: a.lat, lon: a.lon };
}

export type AerodromeFinder<A> = (idOrIcao: string | null | undefined) => A | undefined;

/**
 * Lookups over a list of aerodromes: by id or ICAO (`find`), and what a typed text names (`resolve`:
 * exact id/ICAO, else a unique name match). The website binds them to the reference data it ships
 * (src/data/ref); the native core to GET /api/ref/bundle.
 */
export function aerodromeIndex<A extends Pick<RefAerodrome, 'id' | 'icao' | 'name'>>(
  list: readonly A[],
): { find: AerodromeFinder<A>; resolve: (text: string) => A | undefined } {
  const byId = new Map(list.map((a) => [a.id, a]));
  const byIcao = new Map(list.filter((a) => a.icao).map((a) => [a.icao as string, a]));
  const find: AerodromeFinder<A> = (idOrIcao) => {
    if (!idOrIcao) return undefined;
    const k = idOrIcao.toUpperCase();
    return byId.get(k) ?? byIcao.get(k);
  };
  const resolve = (text: string) => {
    const t = text.trim();
    if (!t) return undefined;
    const exact = find(t);
    if (exact) return exact;
    const u = t.toUpperCase();
    const byName = list.filter((a) => a.name.toUpperCase() === u);
    return byName.length === 1 ? byName[0] : undefined;
  };
  return { find, resolve };
}
