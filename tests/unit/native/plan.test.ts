// The core's planning functions against the website's modules: route edits (map and route fields),
// snapping, local flights, requests, alternates, the fuel load, readiness stages, Fix targets and the
// ATC list's Regenerate.
import { describe, expect, test } from 'vitest';

import { atcAfterRegenerate, atcInput, atcStale, generateAtcList } from '../../../src/data/atc';
import { aerodrome, REF, resolveAerodrome } from '../../../src/data/ref';
import { editorWarningFix, sectionOf } from '../../../src/features/editor/focus';
import {
  addDrawnPoint,
  insertPoint,
  makeLocal,
  movePoint,
  pruneOverrides,
  removeDrawnPoint,
  removePoint,
  renamePoint,
  setAltitudeOverride,
  setRouteEnd,
} from '../../../src/features/editor/map/routeEdit';
import { bestSnap, buildCandidates, findSnap, routeCandidates } from '../../../src/features/editor/map/snap';
import { alternatesFrom } from '../../../src/features/editor/panels/fplOptions';
import { SECTION_STAGE, stageSummary } from '../../../src/features/editor/panels/readiness';
import { planningFix } from '../../../src/features/exports/fix';
import {
  computeFlight,
  focusTarget,
  fplOptions,
  fuelLoad,
  localFlight,
  paperwork,
  readinessStages,
  regenerateAtc,
  requests,
  routeEdit,
  routeInfo,
  setRequest,
  snap,
} from '../../../src/native/core';
import {
  activeRequests,
  type AtcEntry,
  fuelLoad as webFuelLoad,
  isLocalFlight,
  legKey,
  localDuration,
  removeRequest,
  requestRemarks,
  type RoutePoint,
  setRequest as webSetRequest,
  setStopChoice,
  taxiAllowanceOf,
} from '../../../src/shared';
import { AC, ad, API_REF, custom, flight, NOW, PILOT, ROUTE, vfr } from './fixtures';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('routeEdit: the editor’s route edits, with the overrides of legs that are gone dropped', () => {
  const r = ROUTE();
  const k01 = legKey(r[0], r[1]);
  const k12 = legKey(r[1], r[2]);
  const overrides = { [k01]: { altFt: 2500 }, [k12]: { altFt: 3500 } };
  const pt = custom('WP1', 38.1, 23.8);
  const web = (route: RoutePoint[]) => json({ route, legOverrides: pruneOverrides(overrides, route) });

  test('add, insert, remove, rename, removeDrawn', () => {
    expect(routeEdit({ route: r, legOverrides: overrides, op: 'add', point: pt })).toEqual(web(addDrawnPoint(r, pt)));
    expect(routeEdit({ route: r, legOverrides: overrides, op: 'insert', index: 1, point: pt })).toEqual(
      web(insertPoint(r, 1, pt)),
    );
    expect(routeEdit({ route: r, legOverrides: overrides, op: 'remove', uid: r[1].uid })).toEqual(
      web(removePoint(r, r[1].uid)),
    );
    expect(routeEdit({ route: r, legOverrides: overrides, op: 'rename', uid: r[2].uid, name: 'X' })).toEqual(
      web(renamePoint(r, r[2].uid, 'X')),
    );
    expect(routeEdit({ route: r, legOverrides: overrides, op: 'removeDrawn' })).toEqual(web(removeDrawnPoint(r)));
    // as JSON text, as the app calls it
    expect(routeEdit(JSON.stringify({ route: r, op: 'remove', uid: r[1].uid }))).toEqual(
      json({ route: removePoint(r, r[1].uid), legOverrides: {} }),
    );
  });

  test('a new point without a uid gets one; a move to another point gets the uid given', () => {
    const { uid: _u, ...noUid } = pt;
    const out = routeEdit({ route: r, op: 'add', point: noUid });
    expect(out.route).toHaveLength(5);
    expect(out.route[4].uid).toMatch(/^[a-z0-9]{8}$/);
    const to = { kind: 'vfr' as const, refId: 'LGAV/PIKAD', name: 'PIKAD', lat: 38.0, lon: 23.9 };
    expect(
      routeEdit({ route: r, legOverrides: overrides, op: 'move', uid: r[1].uid, point: to, newUid: 'n1' }),
    ).toEqual(web(movePoint(r, r[1].uid, to, () => 'n1')));
  });

  test('setEnd and makeLocal, as the route fields', () => {
    const out = routeEdit({ route: r, op: 'setEnd', end: 'to', aerodrome: 'LGSY', ref: API_REF });
    const expected = setRouteEnd(r, 'to', aerodrome('LGSY')!);
    expect(out.route.slice(0, 3)).toEqual(json(expected.slice(0, 3)));
    expect({ ...out.route[3], uid: '' }).toEqual({ ...expected[3], uid: '' });
    const local = routeEdit({ route: [ad('LGTT'), ad('LGMG')], op: 'makeLocal' });
    expect(isLocalFlight(local.route)).toBe(true);
    expect(local.route[0].refId).toBe(makeLocal([ad('LGTT')])![0].refId);
    expect(() => routeEdit({ route: r, op: 'setEnd', end: 'to', aerodrome: 'NOPE' })).toThrow(/unknown aerodrome/);
  });

  test('setAltitude: the strip’s altitude override', () => {
    expect(routeEdit({ route: r, legOverrides: overrides, op: 'setAltitude', key: k01, altFt: null })).toEqual(
      json({ route: r, legOverrides: setAltitudeOverride(overrides, k01, null) }),
    );
  });

  test('routeInfo', () => {
    const trip = [ad('LGTT'), vfr('LGAV/DAPORI'), ad('LGTT')];
    expect(routeInfo({ route: trip })).toEqual({
      roundTrip: true,
      bareRoundTrip: false,
      drawIndex: 2,
      local: false,
      autoWaypointName: 'WP1',
    });
  });
});

describe('snap: the map’s snapping, with MapLibre’s Web Mercator at a zoom', () => {
  const world = (z: number) => 512 * 2 ** z;
  const project = (z: number) => (lon: number, lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return { x: ((lon + 180) / 360) * world(z), y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world(z) };
  };
  const tt = aerodrome('LGTT')!;

  test('a tap near an aerodrome snaps to it, as RouteMap’s snapAt', () => {
    for (const zoom of [8, 10, 12]) {
      const at = { lat: tt.lat + 0.0005, lon: tt.lon + 0.0005 };
      const out = snap({ ref: API_REF, route: [], lat: at.lat, lon: at.lon, zoom, newUid: 'u1' });
      const p = project(zoom);
      const cands = buildCandidates(REF.aerodromes, REF.vfrPoints, []);
      const web = bestSnap(findSnap(p(at.lon, at.lat), routeCandidates([]), p), findSnap(p(at.lon, at.lat), cands, p));
      expect(out.hit?.cand).toEqual(json(web?.cand));
      expect(out.hit?.distPx).toBeCloseTo(web!.distPx, 6);
      expect(out.point).toMatchObject({ uid: 'u1', kind: 'aerodrome', refId: tt.id, name: 'LGTT' });
    }
  });

  test('the route’s own points; nothing in reach; layers hide what they hide', () => {
    const own = custom('MINE', 37.5, 24.5);
    expect(snap({ route: [own], lat: 37.5, lon: 24.5, zoom: 10 }).hit?.cand).toMatchObject({ name: 'MINE' });
    expect(snap({ route: [], lat: 36.2, lon: 26.9, zoom: 12 })).toEqual({ hit: null, point: null });
    const near = { lat: tt.lat, lon: tt.lon };
    expect(snap({ ...near, zoom: 10, layers: { aerodromes: false } }).hit?.cand.kind).not.toBe('aerodrome');
  });
});

describe('local flights and requests', () => {
  test('localFlight', () => {
    const r = [ad('LGTT'), ad('LGTT')];
    expect(localFlight({ route: r, options: { localDurationMin: 90 } })).toMatchObject({
      local: true,
      durationMin: localDuration(r, { localDurationMin: 90 }),
      durationOf: 90,
    });
    expect(localFlight({ route: ROUTE(), options: {} })).toMatchObject({ local: false, durationMin: null });
  });

  test('setRequest: set, remove, choice as the website', () => {
    const list = [{ pointUid: 'a', kind: 'stop' as const, stopMin: 20, landingRunway: '03' }];
    expect(setRequest({ aerodromeRequests: list, pointUid: 'a', kind: 'stop', stopMin: 45 })).toEqual(
      webSetRequest(list, 'a', 'stop', 45),
    );
    expect(setRequest({ aerodromeRequests: list, pointUid: 'a', op: 'remove' })).toEqual(removeRequest(list, 'a'));
    expect(
      setRequest({
        aerodromeRequests: list,
        pointUid: 'a',
        op: 'choice',
        kind: 'stop',
        key: 'surface',
        value: 'grass',
      }),
    ).toEqual(setStopChoice(list, 'a', 'stop', 'surface', 'grass'));
  });

  test('requests: the active ones, what each point may carry, the FPL remarks', () => {
    const r = [ad('LGTT'), ad('LGMG'), vfr('LGAV/DAPORI'), ad('LGTT')];
    const options = { aerodromeRequests: [{ pointUid: r[1].uid, kind: 'touch-and-go' as const }] };
    const out = requests({ route: r, options, ref: API_REF });
    expect(out.active).toEqual(json(activeRequests(r, options)));
    expect(out.allowed[2]).toEqual({ 'touch-and-go': false, stop: false });
    expect(out.remarks).toEqual(requestRemarks(r, options, (p) => aerodrome(p.refId)?.icao ?? null));
    expect(out.remarks).toEqual(['REQUEST TOUCH N GO AT LGMG']);
  });

  test('fplOptions: the alternates as FplSection stores them', () => {
    const fields = [' lgav ', 'EDDF', 'lgav', 'LGMG'];
    expect(fplOptions({ fields, ref: API_REF })).toEqual({
      alternates: alternatesFrom(fields, resolveAerodrome),
      max: 2,
    });
  });

  test('fuelLoad', () => {
    const out = fuelLoad({
      fuel: AC.fuel,
      totalL: 100,
      byType: { AVGAS: 60, MOGAS: 20 },
      options: { taxiAllowanceL: 6 },
    });
    expect(out.load).toEqual(json(webFuelLoad(AC.fuel, 100, { AVGAS: 60, MOGAS: 20 })));
    expect(out.taxiAllowanceL).toBe(taxiAllowanceOf(AC.fuel, { taxiAllowanceL: 6 }));
    expect(fuelLoad({ fuel: AC.fuel, totalL: 50 }).taxiAllowanceL).toBe(AC.fuel.taxiAllowanceL);
  });
});

describe('readiness stages and Fix targets', () => {
  test('readinessStages: stageSummary of each stage', () => {
    const c = computeFlight({ flight: flight(ROUTE(), { aircraftId: null }), pilot: PILOT, ref: API_REF, now: NOW });
    const items = [...c.readiness, ...paperwork({})];
    const out = readinessStages({ items });
    expect(out.map((s) => s.stage)).toEqual(['plan', 'brief', 'file']);
    for (const s of out)
      expect({ state: s.state, open: s.open }).toEqual(stageSummary(items as never, s.stage as never));
    expect(out[0].state).not.toBe('ok');
  });

  test('focusTarget: a field of the flight, or a page elsewhere, as editorWarningFix', () => {
    const t = focusTarget({ text: 'Block start time not set.' });
    expect(t).toMatchObject({ fix: planningFix('Block start time not set.'), focus: 'blockOff', section: 'when' });
    expect(t.stage).toBe(SECTION_STAGE[sectionOf('blockOff')!]);
    const ac = focusTarget({ text: 'W&B: empty mass is not set', aircraftId: 'ac1' });
    expect(ac.link).toEqual(editorWarningFix('W&B: empty mass is not set', 'ac1'));
    expect(focusTarget({ text: 'Strong winds aloft' }).fix).toBeNull();
    expect(focusTarget({ fix: { kind: 'person', key: 'PIC', fields: ['phone'] } }).link?.to).toBe(
      '/passengers?edit=me&fields=phone',
    );
  });
});

describe('regenerateAtc', () => {
  test('the generated list, stale, and doc.atc after Regenerate', () => {
    const f = flight(ROUTE());
    const c = computeFlight({ flight: f, aircraft: AC, pilot: PILOT, ref: API_REF, now: NOW });
    const generated = generateAtcList(atcInput(f.route, c.altitudesFt, REF, 2));
    const fresh = regenerateAtc({ flight: f, altitudesFt: c.altitudesFt, pilot: PILOT, ref: API_REF });
    expect(fresh.generated).toEqual(json(generated));
    expect(fresh).toMatchObject({ stale: false, atc: null });
    const mine: AtcEntry = { ...generated[0], id: 'x', sourceKey: null, group: 'Other', callsign: 'MY UNIT' };
    const edited = [generated[1], mine];
    const out = regenerateAtc({ flight: { ...f, atc: edited }, altitudesFt: c.altitudesFt, pilot: PILOT });
    expect(out.stale).toBe(atcStale(edited, generated));
    expect(out.atc).toEqual(json(atcAfterRegenerate(edited, generated)));
    expect(out.atc!.at(-1)).toMatchObject({ callsign: 'MY UNIT' });
  });
});
