// How an aerodrome becomes a route point. One rule for the new-flight page, the editor (route
// fields, map snapping, labels) and the server's home route: the ICAO code, else the last part of
// the name ('Kalamaki / Megara Field' → 'Megara Field' for an ICAO-less airstrip).
import { uid } from './constants.js';
import type { RoutePoint } from './types.js';
import type { RefAerodrome } from './ref.js';

/** The name a route point, a label or a list shows for an aerodrome. */
export function aerodromeName(a: Pick<RefAerodrome, 'icao' | 'name'>): string {
  return a.icao || a.name.split('/').pop()!.trim() || a.name;
}

/** A new route point at an aerodrome (fresh uid). */
export function aerodromePoint(a: Pick<RefAerodrome, 'id' | 'icao' | 'name' | 'lat' | 'lon'>): RoutePoint {
  return { uid: uid(), kind: 'aerodrome', refId: a.id, name: aerodromeName(a), lat: a.lat, lon: a.lon };
}
