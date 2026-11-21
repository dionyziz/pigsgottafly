// PGF.progress: the active leg along a route (legs advance as the waypoints are passed; the track
// tells the two directions of an out-and-back apart), the next waypoint, cross-track, ETE/ETA, the
// planned altitude and heading, the frequencies, off the route and past the last waypoint.
import { describe, expect, test } from 'vitest';

import { distanceNm, trueCourse } from '../../../src/calc';
import { destination } from '../../../src/features/editor/map/airspace';
import { computeFlight, progress } from '../../../src/native/core';
import { alongCross } from '../../../src/native/progress';
import type { LatLon } from '../../../src/shared';
import { AC, ad, API_REF, custom, flight, NOW, PILOT, ROUTE } from './fixtures';

const f = flight(ROUTE());
const computed = computeFlight({ flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, weather: {}, now: NOW });

/** The point a fraction along leg k (great circle), moved sideways (NM, + right of the course). */
function along(c: typeof computed, k: number, frac: number, sideNm = 0): LatLon {
  const L = c.legs[k];
  const course = trueCourse(L.from, L.to);
  const [lon, lat] = destination(L.from.lat, L.from.lon, course, distanceNm(L.from, L.to) * frac);
  if (!sideNm) return { lat, lon };
  const [lon2, lat2] = destination(lat, lon, trueCourse({ lat, lon }, L.to) + 90, sideNm);
  return { lat: lat2, lon: lon2 };
}
const at = (c: typeof computed, p: LatLon, extra: Record<string, unknown> = {}, lastLegIndex?: number) =>
  progress({ flight: f, computed: c, position: { ...p, time: NOW, ...extra }, lastLegIndex });

describe('progress along LGTT → DAPORI → KORINTHOS → LGMG', () => {
  test('half way along the first leg: the next waypoint, distance, bearing, ETE and the leg’s plan', () => {
    const p = at(computed, along(computed, 0, 0.5));
    const leg = computed.navlog!.legs[0];
    expect(p.legIndex).toBe(0);
    expect(p.toWaypoint).toMatchObject({ index: 1, name: f.route[1].name });
    expect(p.distNm).toBeCloseTo(computed.legs[0].distNm / 2, 1);
    expect(Math.abs(p.crossTrackNm!)).toBeLessThan(0.01);
    expect(p.legFraction).toBeCloseTo(0.5, 2);
    expect(p.bearingDeg).toBeCloseTo(trueCourse(along(computed, 0, 0.5), f.route[1]), 6);
    expect(p.gsSource).toBe('navlog');
    expect(p.gsKt).toBe(leg.gs);
    expect(p.eteMin).toBeCloseTo((p.distNm! / leg.gs!) * 60, 9);
    expect(p.eta).toBeCloseTo(NOW + p.eteMin! * 60000, 0);
    expect(p.plannedAltFt).toBe(leg.altFt);
    expect(p.plannedHdg).toBe(leg.mh);
    expect(p.offRoute).toBe(false);
    expect(p.arrived).toBe(false);
    const rest = computed.legs.slice(1).reduce((s, l) => s + l.distNm, 0);
    expect(p.remainingNm).toBeCloseTo(p.distNm! + rest, 6);
  });

  test('the GPS groundspeed gives the ETE when flying; the navlog’s while taxiing', () => {
    const fast = at(computed, along(computed, 0, 0.5), { gsKt: 120 });
    expect(fast).toMatchObject({ gsKt: 120, gsSource: 'gps' });
    expect(fast.eteMin).toBeCloseTo((fast.distNm! / 120) * 60, 9);
    expect(at(computed, along(computed, 0, 0.5), { gsKt: 5 }).gsSource).toBe('navlog');
  });

  test('legs advance as the waypoints are passed', () => {
    expect(at(computed, along(computed, 0, 0.85)).legIndex).toBe(0);
    expect(at(computed, along(computed, 0, 0.95)).legIndex).toBe(1);
    expect(at(computed, along(computed, 1, 0.3)).legIndex).toBe(1);
    expect(at(computed, along(computed, 2, 0.5)).toWaypoint?.name).toBe('LGMG');
  });

  const track = (k: number) => trueCourse(computed.legs[k].from, computed.legs[k].to);

  test('off the route: more than 2 NM from the leg, signed right of the course', () => {
    // south of DAPORI → KORINTHOS (left of its course; the route's last leg runs north of it)
    const left = at(computed, along(computed, 1, 0.5, -3), { trackDeg: track(1) });
    expect(left.legIndex).toBe(1);
    expect(left.crossTrackNm).toBeCloseTo(-3, 1);
    expect(left.offRoute).toBe(true);
    const right = at(computed, along(computed, 1, 0.5, 1.5), { trackDeg: track(1) });
    expect(right.legIndex).toBe(1);
    expect(right.crossTrackNm).toBeCloseTo(1.5, 1);
    expect(right.offRoute).toBe(false);
  });

  test('past the last waypoint: the last leg, arrived', () => {
    // beyond LGMG the first leg (LGTT → DAPORI) passes close by: the track, or the leg shown last, tells
    const beyond = along(computed, 2, 1.2);
    for (const p of [at(computed, beyond, { trackDeg: track(2) }), at(computed, beyond, {}, 2)]) {
      expect(p.legIndex).toBe(2);
      expect(p.toWaypoint?.name).toBe('LGMG');
      expect(p.arrived).toBe(true);
      expect(p.legFraction).toBeGreaterThan(1);
    }
    expect(at(computed, beyond).legIndex).toBe(0); // nearest, with nothing else to go by
  });

  test('the frequency here and the next one ahead', () => {
    const start = at(computed, along(computed, 0, 0.05));
    expect(start.freq?.group).toMatch(/^LGTT/);
    expect(start.nextFreq).not.toBeNull();
    expect(start.nextFreq!.primary + start.nextFreq!.callsign).not.toBe(start.freq!.primary + start.freq!.callsign);
    const end = at(computed, along(computed, 2, 0.95));
    expect(end.freq?.group).toMatch(/^LGMG/);
    const mid = at(computed, along(computed, 1, 0.5));
    expect(mid.freq).not.toBeNull();
    expect(mid.freq!.primary).toMatch(/^\d{3}\.\d+$/);
  });

  test('JSON in, JSON out', () => {
    const p = progress(
      JSON.stringify({ computed, position: { ...along(computed, 0, 0.5), time: new Date(NOW).toISOString() } }),
    );
    expect(p.legIndex).toBe(0);
    expect(p.eta).toBeCloseTo(NOW + p.eteMin! * 60000, 0);
  });
});

describe('an out-and-back: LGTT → TURN → LGTT', () => {
  const tt = ad('LGTT');
  const route = [tt, custom('TURN', 38.45, 23.55), { ...ad('LGTT') }];
  const c = computeFlight({ flight: flight(route), aircraft: AC, pilot: PILOT, ref: API_REF, weather: {}, now: NOW });
  const mid = along(c, 0, 0.5);
  const out = trueCourse(route[0], route[1]);

  test('the track tells the outbound leg from the inbound one', () => {
    expect(at(c, mid, { trackDeg: out }).legIndex).toBe(0);
    expect(at(c, mid, { trackDeg: (out + 180) % 360 }).legIndex).toBe(1);
  });
  test('without a track: the earlier leg, unless the app has moved on to the later one', () => {
    expect(at(c, mid).legIndex).toBe(0);
    expect(at(c, mid, {}, 1).legIndex).toBe(1);
  });
  test('inbound near home: to LGTT on the last leg', () => {
    const p = at(c, along(c, 1, 0.8), { trackDeg: (out + 180) % 360 });
    expect(p.legIndex).toBe(1);
    expect(p.toWaypoint?.index).toBe(2);
  });
});

test('alongCross: along and across a leg on the great circle', () => {
  const a = { lat: 38, lon: 23.5 },
    b = { lat: 38, lon: 24.5 };
  const r = alongCross({ lat: 38.1, lon: 24 }, a, b);
  expect(r.cross).toBeLessThan(0); // north of an eastbound leg: left
  expect(r.cross).toBeCloseTo(-6, 0);
  expect(r.along).toBeCloseTo(distanceNm(a, b) / 2, 0);
});

test('no route: nothing to show', () => {
  const empty = computeFlight({ flight: flight([]), pilot: PILOT, ref: API_REF, weather: {}, now: NOW });
  expect(progress({ computed: empty, position: { lat: 38, lon: 23.8, time: NOW } })).toMatchObject({
    legIndex: null,
    toWaypoint: null,
    offRoute: false,
  });
});
