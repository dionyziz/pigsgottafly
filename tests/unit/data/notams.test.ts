// Client NOTAM helpers (src/data/notams.ts), the map areas (editor/map/notamLayer.ts) and the
// briefing export model (exports/briefing/model.ts).
import { describe, expect, test } from 'vitest';

import { distanceNm } from '../../../src/calc';
import {
  circleRing,
  fmtNotamLevel,
  groupNotams,
  hasNotamArea,
  isAerodromeNotam,
  notamLimits,
  notamRings,
  notamSourcesLine,
  notamsPath,
  onlyFromAutorouter,
  notamSubject,
  notamValidity,
  notamWhere,
  visibleNotams,
} from '../../../src/data/notams';
import { mapNotams } from '../../../src/features/editor/map/notamLayer';
import { briefingModel } from '../../../src/features/exports/briefing/model';
import { emptyFlightDoc, type RoutePoint } from '../../../src/shared';
import type { Notam, NotamBriefing } from '../../../src/shared/briefing';

const T = Date.parse('2026-11-16T09:00:00Z');
function notam(over: Partial<Notam> = {}): Notam {
  return {
    key: 'A1234/26',
    type: 'N',
    refers: null,
    itemA: ['LGGG'],
    fir: 'LGGG',
    qcode: 'QRTCA',
    subject: 'Temporary restricted area',
    condition: 'Activated',
    traffic: 'IV',
    purpose: 'BO',
    scope: 'W',
    lowerFt: 0,
    upperFt: 2500,
    center: { lat: 38.2, lon: 23.9 },
    radiusNm: 5,
    from: T - 3600e3,
    to: T + 6 * 3600e3,
    estimated: false,
    schedule: null,
    text: 'TEMPO RESTRICTED AREA ACTIVATED.',
    lowerText: null,
    upperText: null,
    raw: 'A1234/26 NOTAMN\nQ) LGGG/QRTCA/IV/BO/W/000/025/3812N02354E005\nE) TEMPO RESTRICTED AREA ACTIVATED.',
    relevant: true,
    reasons: ['on the route (leg 1)'],
    legIndex: 0,
    ...over,
  };
}
function briefing(list: Notam[], over: Partial<NotamBriefing> = {}): NotamBriefing {
  const relevantCount = list.filter((n) => n.relevant).length;
  return {
    status: 'ok',
    source: 'autorouter',
    message: null,
    fetched: T - 600e3,
    window: { from: T - 3600e3, to: T + 3 * 3600e3 },
    params: { maxAltFt: 4500, corridorNm: 10, marginMin: 60 },
    locations: ['LGTT', 'LGMG', 'LGGG'],
    notams: list,
    relevantCount,
    hiddenCount: list.length - relevantCount,
    ...over,
  };
}

describe('NOTAM texts', () => {
  test('API path with the optional parameters', () => {
    expect(notamsPath('f 1')).toBe('flights/f%201/notams');
    expect(notamsPath('f1', { maxAltFt: 4499.6, corridorNm: 5, refresh: true })).toBe(
      'flights/f1/notams?maxAltFt=4500&corridorNm=5&refresh=1',
    );
  });
  test('validity, limits, subject, place', () => {
    expect(notamValidity(notam())).toBe('2026-11-16 08:00Z – 2026-11-16 15:00Z');
    expect(notamValidity(notam({ to: null }))).toBe('2026-11-16 08:00Z – PERM');
    expect(notamValidity(notam({ estimated: true }))).toBe('2026-11-16 08:00Z – 2026-11-16 15:00Z EST');
    expect(notamLimits(notam())).toBe('SFC – 2500 ft');
    expect(notamLimits(notam({ lowerFt: 9500, upperFt: 99900 }))).toBe('FL095 – UNL');
    expect(notamLimits(notam({ lowerText: 'GND', upperText: '3000FT AMSL' }))).toBe('GND – 3000FT AMSL');
    expect(fmtNotamLevel(0, true)).toBe('0 ft');
    expect(notamSubject(notam())).toBe('Temporary restricted area: activated');
    expect(notamSubject(notam({ condition: null }))).toBe('Temporary restricted area');
    expect(notamSubject(notam({ subject: null }))).toBe('QRTCA');
    expect(notamWhere(notam({ itemA: ['LGAV', 'LGMG'] }))).toBe('LGAV LGMG');
    expect(notamWhere(notam({ itemA: [] }))).toBe('LGGG');
  });
  test('show all: relevant only by default', () => {
    const b = briefing([notam(), notam({ key: 'A2/26', relevant: false, reasons: ['ends before the flight'] })]);
    expect(visibleNotams(b, false).map((n) => n.key)).toEqual(['A1234/26']);
    expect(visibleNotams(b, true)).toHaveLength(2);
    expect(visibleNotams(null, true)).toEqual([]);
  });
  test('the sources line: those that answered, then those that did not', () => {
    expect(
      notamSourcesLine({
        source: 'autorouter',
        sources: [
          { id: 'autorouter', label: 'autorouter', status: 'ok', count: 3, message: null },
          { id: 'notamify', label: 'Notamify', status: 'ok', count: 2, message: null },
        ],
      }),
    ).toEqual({ from: 'autorouter, Notamify', failed: [] });
    expect(
      notamSourcesLine({
        source: 'autorouter',
        sources: [
          { id: 'autorouter', label: 'autorouter', status: 'ok', count: 3, message: null },
          { id: 'notamify', label: 'Notamify', status: 'timeout', count: 0, message: 'no answer in 25 s' },
        ],
      }),
    ).toEqual({ from: 'autorouter', failed: ['Notamify timed out'] });
    // stored before there were several sources
    expect(notamSourcesLine({ source: 'autorouter' })).toEqual({ from: 'autorouter', failed: [] });
    expect(notamSourcesLine({ source: null })).toEqual({ from: '', failed: [] });
  });
});

describe('NOTAM areas on the map', () => {
  test('circle ring: closed, every vertex at the radius (great circle)', () => {
    const c = { lat: 38.2, lon: 23.9 };
    const ring = circleRing(c, 5, 36);
    expect(ring).toHaveLength(37);
    expect(ring[0]).toEqual(ring[36]);
    for (const [lon, lat] of ring) expect(distanceNm(c, { lat, lon })).toBeCloseTo(5, 2);
    // first vertex due north
    expect(ring[0][0]).toBeCloseTo(23.9, 5);
    expect(ring[0][1]).toBeGreaterThan(38.2);
  });
  test('only Q-line circles below FIR size get an area', () => {
    expect(hasNotamArea(notam())).toBe(true);
    expect(hasNotamArea(notam({ radiusNm: 999 }))).toBe(false);
    expect(hasNotamArea(notam({ radiusNm: 341 }))).toBe(false);
    expect(hasNotamArea(notam({ center: null }))).toBe(false);
    expect(hasNotamArea(notam({ radiusNm: null }))).toBe(false);
    const marks = mapNotams([
      notam(),
      notam({ key: 'B/26', radiusNm: 999 }),
      notam({ key: 'C/26', relevant: false, radiusNm: 2 }),
    ]);
    expect(marks.map((m) => [m.key, m.relevant, m.rings.length])).toEqual([
      ['A1234/26', true, 1],
      ['C/26', false, 1],
    ]);
    expect(marks[1].sizeNm).toBeLessThan(marks[0].sizeNm);
  });
  test('aerodrome NOTAMs are not drawn; the list groups them by aerodrome, then the airspace ones', () => {
    const ad = (key: string, icao: string) => notam({ key, itemA: [icao], radiusNm: 5 });
    const list = [ad('A1/26', 'LGTT'), notam({ key: 'A2/26' }), ad('A3/26', 'LGMG'), ad('A4/26', 'LGTT')];
    list.push(notam({ key: 'A5/26', itemA: ['LTBB', 'LGGG'] }));
    expect(isAerodromeNotam(list[0])).toBe(true);
    expect(isAerodromeNotam(list[1])).toBe(false);
    expect(isAerodromeNotam(list[4])).toBe(false);
    expect(mapNotams(list).map((m) => m.key)).toEqual(['A2/26', 'A5/26']);
    expect(groupNotams(list).map((g) => [g.icao, g.notams.map((n) => n.key)])).toEqual([
      ['LGTT', ['A1/26', 'A4/26']],
      ['LGMG', ['A3/26']],
      [null, ['A2/26', 'A5/26']],
    ]);
    expect(groupNotams([])).toEqual([]);
    // the departure and the destination always come first, even with no NOTAM (once for a round trip)
    expect(groupNotams(list, ['LGMG', 'LGTT', 'LGTT']).map((g) => [g.icao, g.notams.length])).toEqual([
      ['LGMG', 1],
      ['LGTT', 2],
      [null, 2],
    ]);
    expect(groupNotams([], ['LGTT', 'LGSO']).map((g) => [g.icao, g.notams.length])).toEqual([
      ['LGTT', 0],
      ['LGSO', 0],
    ]);
  });
  test('the areas the text describes replace the Q-line circle', () => {
    const square = notamRings(
      notam({
        radiusNm: 300,
        areas: [
          {
            kind: 'polygon',
            points: [
              { lat: 38, lon: 23 },
              { lat: 38.1, lon: 23 },
              { lat: 38.1, lon: 23.1 },
            ],
          },
        ],
      }),
    );
    expect(square).toEqual([
      [
        [23, 38],
        [23, 38.1],
        [23.1, 38.1],
        [23, 38],
      ],
    ]);
    // a corridor: a disc per point and a band per segment
    const line = notamRings(
      notam({
        areas: [
          {
            kind: 'line',
            points: [
              { lat: 36, lon: 27 },
              { lat: 36.5, lon: 27 },
            ],
            halfWidthNm: 1,
          },
        ],
      }),
    );
    expect(line).toHaveLength(3);
    expect(line[2][0][1]).toBeCloseTo(36, 5);
    expect(Math.abs(line[2][0][0] - 27) * 60 * Math.cos((36 * Math.PI) / 180)).toBeCloseTo(1, 2);
  });
});

describe('briefing export model', () => {
  const pt = (uid: string, name: string, lat: number, lon: number): RoutePoint => ({
    uid,
    kind: 'aerodrome',
    refId: name,
    name,
    lat,
    lon,
  });
  const doc = { ...emptyFlightDoc('2026-11-16'), route: [pt('a', 'LGTT', 38.1, 23.78), pt('b', 'LGMG', 37.98, 23.39)] };
  test('relevant decoded with the leg; hidden with the reason', () => {
    const m = briefingModel({
      doc,
      title: 'LGTT – LGMG',
      briefing: briefing([notam(), notam({ key: 'A2/26', relevant: false, reasons: ['IFR only'], legIndex: null })]),
    });
    expect(m.status).toBe('ok');
    expect(m.route).toBe('LGTT – LGMG');
    expect(m.relevant).toHaveLength(1);
    expect(m.relevant[0]).toMatchObject({
      key: 'A1234/26',
      subject: 'Temporary restricted area: activated',
      limits: 'SFC – 2500 ft',
      leg: 'leg 1 LGTT – LGMG',
    });
    expect(m.relevant[0].raw).toContain('Q) LGGG/QRTCA');
    expect(m.hiddenCount).toBe(1);
    expect(m.filter).toBe('lower limit at or below 4500 ft · within 10 NM of the route');
    expect(m.source).toBe('EAD, fetched 2026-11-16 08:50Z');
  });
  test('not configured: the server message, no lists', () => {
    const m = briefingModel({
      doc,
      title: 't',
      briefing: briefing([], {
        status: 'not-configured',
        source: null,
        fetched: null,
        message: 'NOTAMs are not available yet.',
      }),
    });
    expect(m.status).toBe('not-configured');
    expect(m.message).toBe('NOTAMs are not available yet.');
    expect(m.relevant).toEqual([]);
    expect(briefingModel({ doc, title: 't', briefing: null }).status).toBe('loading');
  });
});

describe('onlyFromAutorouter', () => {
  test('marks NOTAMs no shared source returned', () => {
    expect(onlyFromAutorouter({ sources: ['autorouter'] })).toBe(true);
    expect(onlyFromAutorouter({ sources: ['autorouter', 'nms'] })).toBe(false);
    expect(onlyFromAutorouter({ sources: ['nms'] })).toBe(false);
    expect(onlyFromAutorouter({ sources: [] })).toBe(false);
    expect(onlyFromAutorouter({})).toBe(false);
  });
});
