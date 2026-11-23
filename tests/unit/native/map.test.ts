// The core's Map tab functions against the website's map modules: the details boxes of a tap, a route
// point's menu, the route's sources while editing, the drawing band, custom point names and the layers.
import { describe, expect, test } from 'vitest';

import { aipUrl } from '../../../src/data/aipLinks';
import { aerodrome, REF } from '../../../src/data/ref';
import { adDayInfo, adHandlingLine, adHoursLine } from '../../../src/features/editor/adDay';
import { airspaceInfos, airspacesAt, fmtVertical } from '../../../src/features/editor/map/airspace';
import {
  midpointFeatures,
  navaidFreqText,
  routeLineFeatures,
  routePointFeatures,
} from '../../../src/features/editor/map/features';
import { aerodromeVfrCharts, vfrChartIndex, vfrPointCharts } from '../../../src/features/editor/map/vfrCharts';
import { calcAdEffects } from '../../../src/features/editor/panels/flightCalc';
import { drawBand, mapInfo, mapLayers, pointMenu, routeFeatures, waypointName } from '../../../src/native/core';
import { DEFAULT_MAP_LAYERS, DEFAULT_STOP_MIN, requestAllowed } from '../../../src/shared';
import { ad, API_REF, briefing, custom, DATE, notam, ROUTE, vfr } from './fixtures';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('mapInfo: what a tap shows, as RouteMap’s details box', () => {
  const tt = aerodrome('LGTT')!;

  test('the aerodrome under the finger, with its hours of the flight’s day and the NOTAMs', () => {
    const b = briefing([notam()]);
    const out = mapInfo({ ref: API_REF, lat: tt.lat, lon: tt.lon, zoom: 10, notams: b, date: DATE });
    const info = adDayInfo(tt, DATE, calcAdEffects(b));
    expect(out.aerodrome).toMatchObject({
      id: tt.id,
      title: `${tt.icao} · ${tt.name}`,
      hoursLine: adHoursLine(info),
      handlingLine: adHandlingLine(info),
      source: { ref: tt.source, url: aipUrl(tt.source) },
      airac: REF.airac.id,
    });
    const idx = vfrChartIndex(REF.aerodromes, REF.vfrPoints);
    expect(out.aerodrome?.charts).toEqual(json(aerodromeVfrCharts(idx, tt)));
    expect(out.aerodrome?.rows[0]).toMatchObject({ text: info.ad?.text });
  });

  test('the airspaces at the place, as the layers show them', () => {
    const at = { lat: 37.95, lon: 23.6 };
    const out = mapInfo({ ref: API_REF, ...at, zoom: 8 });
    const infos = airspaceInfos(REF.airspaces, REF.adAirspaces, REF.areas, REF.fir);
    const web = airspacesAt(infos, at.lon, at.lat);
    expect(out.airspaces.map((a) => a.id)).toEqual(web.map((a) => a.id));
    expect(out.airspaces[0].vertical).toBe(fmtVertical(web[0].lower, web[0].upper));
    const noTma = mapInfo({ ref: API_REF, ...at, zoom: 8, layers: { tma: false } });
    expect(noTma.airspaces.some((a) => a.type === 'TMA')).toBe(false);
  });

  test('a navaid within 9 px; a NOTAM area holding the place; nothing far away', () => {
    const n = REF.navaids!.find((x) => x.sources.includes('ENR 4.1'))!;
    const out = mapInfo({ ref: API_REF, lat: n.lat, lon: n.lon, zoom: 10 });
    expect(out.navaid).toMatchObject({ id: n.id, freq: navaidFreqText(n), title: `${n.ident} · ${n.name}` });
    const b = briefing([notam()]);
    const hit = mapInfo({ ref: API_REF, lat: 38.2, lon: 23.9, zoom: 9, notams: b, route: ROUTE() });
    expect(hit.notams.map((x) => x.key)).toEqual(['A1234/26']);
    expect(hit.notams[0].leg).toMatch(/^1: LGTT → /);
    expect(
      mapInfo({ ref: API_REF, lat: 38.2, lon: 23.9, zoom: 9, notams: b, layers: { notams: false } }).notams,
    ).toEqual([]);
    const sea = mapInfo({ ref: API_REF, lat: 35.0, lon: 28.5, zoom: 10 });
    expect([sea.aerodrome, sea.navaid]).toEqual([null, null]);
  });

  test('one aerodrome by id (a route point’s “Aerodrome hours…”)', () => {
    const out = mapInfo({ ref: API_REF, aerodrome: 'LGTT', date: DATE });
    expect(out.aerodrome?.id).toBe(tt.id);
    expect(out.airspaces).toEqual([]);
  });
});

describe('pointMenu: RouteMap’s menu of a route point', () => {
  test('an aerodrome’s requests, as requestAllowed and the flight’s options say', () => {
    const r = ROUTE();
    const options = { aerodromeRequests: [{ pointUid: r[3].uid, kind: 'stop' as const, stopMin: 45 }] };
    const dep = pointMenu({ ref: API_REF, route: r, options, uid: r[0].uid })!;
    expect(dep).toMatchObject({ kindLabel: 'aerodrome', end: 'departure', last: false, aerodromeId: 'LGTT' });
    expect(dep.requests?.tng.allowed).toBe(requestAllowed(r, 0, 'touch-and-go'));
    const dest = pointMenu({ ref: API_REF, route: r, options, uid: r[3].uid })!;
    expect(dest.requests?.stop).toEqual({ on: true, allowed: requestAllowed(r, 3, 'stop'), stopMin: 45 });
    expect(dest).toMatchObject({ end: 'destination', last: true });
    expect(dest.stopMin.default).toBe(DEFAULT_STOP_MIN);
  });

  test('a VFR point’s chart; a custom point; an unknown uid', () => {
    const r = [ad('LGTT'), vfr('LGAV/DAPORI'), custom('WP1', 38, 23.5), ad('LGMG')];
    const idx = vfrChartIndex(REF.aerodromes, REF.vfrPoints);
    const p = pointMenu({ ref: API_REF, route: r, uid: r[1].uid })!;
    expect(p.charts).toEqual(json(vfrPointCharts(idx, { chart: 'LGAV', lat: r[1].lat, lon: r[1].lon })));
    expect(p.requests).toBeNull();
    expect(pointMenu({ ref: API_REF, route: r, uid: r[2].uid })).toMatchObject({
      kind: 'custom',
      kindLabel: 'custom point',
    });
    expect(pointMenu({ ref: API_REF, route: r, uid: 'nope' })).toBeNull();
  });
});

describe('drawing', () => {
  test('routeFeatures: the route’s sources, the middle dots only with handles', () => {
    const r = ROUTE();
    const out = routeFeatures({ route: r, selected: r[1].uid });
    expect(out['route-line']).toEqual(json(routeLineFeatures(r)));
    expect(out['route-points']).toEqual(json(routePointFeatures(r, r[1].uid)));
    expect(out['route-mid']).toEqual(json(midpointFeatures(r)));
    expect(routeFeatures({ route: r, handles: false })['route-mid']).toEqual({
      type: 'FeatureCollection',
      features: [],
    });
  });

  test('drawBand: from the last point to the finger, on to a round trip’s closing point', () => {
    const a = ad('LGTT');
    const target = { lat: 38.3, lon: 23.9 };
    const open = drawBand({ route: [a], target, date: DATE });
    expect(open.band?.geometry.coordinates).toEqual([
      [a.lon, a.lat],
      [target.lon, target.lat],
    ]);
    expect(open.readout).toMatch(/^\d{3}° {2}\d+(\.\d)? NM$/);
    const round = drawBand({ route: [a, vfr('LGAV/DAPORI'), { ...ad('LGTT') }], target, date: DATE });
    expect(round.band?.geometry.coordinates).toHaveLength(3);
    expect(drawBand({ route: [], target })).toEqual({ band: null, readout: null });
  });

  test('waypointName: cleanWaypointName', () => {
    expect(waypointName({ name: ' my  point ' })).toEqual({ name: 'MY POINT' });
    expect(waypointName({ name: 'bad!' })).toEqual({ name: '' });
  });
});

test('mapLayers: the flight’s layers, else the pilot’s, else all; the areas and NOTAM areas counted', () => {
  expect(mapLayers({ ref: API_REF }).layers).toEqual(DEFAULT_MAP_LAYERS);
  expect(mapLayers({ ref: API_REF, pilot: { tma: false } }).layers.tma).toBe(false);
  expect(mapLayers({ ref: API_REF, flight: { base: 'terrain' }, pilot: { tma: false } }).layers).toEqual({
    ...DEFAULT_MAP_LAYERS,
    base: 'terrain',
  });
  const c = mapLayers({ ref: API_REF, notams: briefing([notam()]) }).counts;
  expect(c.prd + c.mil + c.act).toBeGreaterThan(0);
  expect(c.notams).toBe(1);
});

describe('time-limited areas (AIP SUP 39/26 LGD4SW, until 27 NOV 2026), as the website draws them', () => {
  // west of the Peloponnese, inside LGD4SW and LGD2SW
  const at = { lat: 37, lon: 20.5, zoom: 8 };
  const ids = (date: string) => mapInfo({ ref: API_REF, ...at, date }).airspaces.map((a) => a.id);

  test('a tap shows the areas in force on the flight’s day, with until when and the windows left', () => {
    expect(ids('2026-11-23')).toContain('LGD4SW');
    expect(ids('2026-11-23')).not.toContain('LGD2SW'); // its last day was 16 NOV
    expect(ids('2026-11-28')).not.toContain('LGD4SW');
    expect(ids('2026-10-01')).toContain('LGD2SW');
    const card = mapInfo({ ref: API_REF, ...at, date: '2026-11-26' }).airspaces.find((a) => a.id === 'LGD4SW')!;
    expect(card.rows).toContainEqual({ label: 'Valid', text: 'until 27 NOV 2026' });
    expect(card.rows).toContainEqual({ label: 'Windows (UTC)', text: '26 NOV 0830–1030\n27 NOV 0800–1000' });
    // the same as the website's details box for that day
    const web = airspaceInfos(REF.airspaces, REF.adAirspaces, REF.areas, REF.fir, '2026-11-26');
    expect(card.rows.slice(-2)).toEqual(web.find((a) => a.id === 'LGD4SW')!.timeRows);
  });

  test('the layers menu counts the areas in force on the flight’s day', () => {
    const n = (date: string) => mapLayers({ ref: API_REF, date }).counts.prd;
    expect(n('2026-11-23')).toBeGreaterThan(n('2026-11-28'));
    expect(n('2027-06-10')).toBeLessThan(n('2026-11-28'));
  });
});
