// Client NOTAM helpers (src/data/notams.ts), the map areas (editor/map/notamLayer.ts) and the
// briefing export model (exports/briefing/model.ts).
import { describe, expect, test } from 'vitest';
import {
  circleRing, fmtNotamLevel, hasNotamArea, notamLimits, notamsPath, notamSubject, notamValidity, notamWhere, visibleNotams,
} from '../../../src/data/notams';
import { distanceNm } from '../../../src/calc';
import { mapNotams } from '../../../src/features/editor/map/notamLayer';
import { briefingModel } from '../../../src/features/exports/briefing/model';
import { emptyFlightDoc, type RoutePoint } from '../../../src/shared';
import type { Notam, NotamBriefing } from '../../../src/shared/briefing';

const T = Date.parse('2026-11-16T09:00:00Z');
function notam(over: Partial<Notam> = {}): Notam {
  return {
    key: 'A1234/26', type: 'N', refers: null, itemA: ['LGGG'], fir: 'LGGG', qcode: 'QRTCA',
    subject: 'Temporary restricted area', condition: 'Activated', traffic: 'IV', purpose: 'BO', scope: 'W',
    lowerFt: 0, upperFt: 2500, center: { lat: 38.2, lon: 23.9 }, radiusNm: 5,
    from: T - 3600e3, to: T + 6 * 3600e3, estimated: false, schedule: null,
    text: 'TEMPO RESTRICTED AREA ACTIVATED.', lowerText: null, upperText: null,
    raw: 'A1234/26 NOTAMN\nQ) LGGG/QRTCA/IV/BO/W/000/025/3812N02354E005\nE) TEMPO RESTRICTED AREA ACTIVATED.',
    relevant: true, reasons: ['on the route (leg 1)'], legIndex: 0,
    ...over,
  };
}
function briefing(list: Notam[], over: Partial<NotamBriefing> = {}): NotamBriefing {
  const relevantCount = list.filter((n) => n.relevant).length;
  return {
    status: 'ok', source: 'autorouter', message: null, fetched: T - 600e3,
    window: { from: T - 3600e3, to: T + 3 * 3600e3 }, params: { maxAltFt: 4500, corridorNm: 10, marginMin: 60 },
    locations: ['LGTT', 'LGMG', 'LGGG'], notams: list, relevantCount, hiddenCount: list.length - relevantCount, ...over,
  };
}

describe('NOTAM texts', () => {
  test('API path with the optional parameters', () => {
    expect(notamsPath('f 1')).toBe('flights/f%201/notams');
    expect(notamsPath('f1', { maxAltFt: 4499.6, corridorNm: 5, refresh: true })).toBe('flights/f1/notams?maxAltFt=4500&corridorNm=5&refresh=1');
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
  test('only Q-line circles below 999 NM get an area', () => {
    expect(hasNotamArea(notam())).toBe(true);
    expect(hasNotamArea(notam({ radiusNm: 999 }))).toBe(false);
    expect(hasNotamArea(notam({ center: null }))).toBe(false);
    expect(hasNotamArea(notam({ radiusNm: null }))).toBe(false);
    const marks = mapNotams([notam(), notam({ key: 'B/26', radiusNm: 999 }), notam({ key: 'C/26', relevant: false, radiusNm: 2 })]);
    expect(marks.map((m) => [m.key, m.relevant, m.radiusNm])).toEqual([['A1234/26', true, 5], ['C/26', false, 2]]);
  });
});

describe('briefing export model', () => {
  const pt = (uid: string, name: string, lat: number, lon: number): RoutePoint => ({ uid, kind: 'aerodrome', refId: name, name, lat, lon });
  const doc = { ...emptyFlightDoc('2026-11-16'), route: [pt('a', 'LGTT', 38.1, 23.78), pt('b', 'LGMG', 37.98, 23.39)] };
  test('relevant decoded with the leg; hidden with the reason', () => {
    const m = briefingModel({ doc, title: 'LGTT – LGMG', briefing: briefing([notam(), notam({ key: 'A2/26', relevant: false, reasons: ['IFR only'], legIndex: null })]) });
    expect(m.status).toBe('ok');
    expect(m.route).toBe('LGTT – LGMG');
    expect(m.relevant).toHaveLength(1);
    expect(m.relevant[0]).toMatchObject({ key: 'A1234/26', subject: 'Temporary restricted area: activated', limits: 'SFC – 2500 ft', leg: 'leg 1 LGTT – LGMG' });
    expect(m.relevant[0].raw).toContain('Q) LGGG/QRTCA');
    expect(m.hidden).toEqual([expect.objectContaining({ key: 'A2/26', reasons: 'IFR only', leg: null })]);
    expect(m.filter).toBe('lower limit at or below 4500 ft · within 10 NM of the route');
    expect(m.source).toBe('autorouter (EAD), fetched 2026-11-16 08:50Z');
  });
  test('not configured: the server message, no lists', () => {
    const m = briefingModel({ doc, title: 't', briefing: briefing([], { status: 'not-configured', source: null, fetched: null, message: 'NOTAMs are not available yet.' }) });
    expect(m.status).toBe('not-configured');
    expect(m.message).toBe('NOTAMs are not available yet.');
    expect(m.relevant).toEqual([]);
    expect(briefingModel({ doc, title: 't', briefing: null }).status).toBe('loading');
  });
});
