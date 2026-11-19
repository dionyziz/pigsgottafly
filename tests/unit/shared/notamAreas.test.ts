import { describe, expect, test } from 'vitest';

import { areasToRoute, parseNotamAreas } from '../../../src/shared/notamAreas';

describe('NOTAM areas from item E', () => {
  test('a polygon: coordinates one after the other, the closing point dropped', () => {
    const a = parseNotamAreas(
      'A TEMPO RESTRICTED AREA IS ESTABLISHED WI ATHINAI FIR AS FLW: 1. AREA: 373855N - 0240146E - 374039N 0240418E - ' +
        '374720N 0240510E - 373855N 0240146E (LAVRIO) - LGR63 AFFECTED',
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'polygon' });
    if (a[0].kind !== 'polygon') return;
    expect(a[0].points).toHaveLength(3);
    expect(a[0].points[0].lat).toBeCloseTo(37 + 38 / 60 + 55 / 3600, 5);
    expect(a[0].points[0].lon).toBeCloseTo(24 + 1 / 60 + 46 / 3600, 5);
  });
  test('circles: radius before or after the centre, in NM or metres', () => {
    expect(
      parseNotamAreas('PJE WILL TAKE PLACE WI: 2NM RADIUS CENTERED ON 380626N 0234558E (DEKELIA/TATOI AD).'),
    ).toEqual([
      { kind: 'circle', center: { lat: expect.closeTo(38.1072, 3), lon: expect.closeTo(23.7661, 3) }, radiusNm: 2 },
    ]);
    const after = parseNotamAreas('1. LATERAL LIMITS: CENTERED ON 375323N 0234405E AND CIRCLE 1 NM\nRADIUS.');
    expect(after).toMatchObject([{ kind: 'circle', radiusNm: 1 }]);
    const m = parseNotamAreas('UAV FLT WI 500M RADIUS CENTRED ON 375323N 0234405E');
    expect(m[0].kind === 'circle' && m[0].radiusNm).toBeCloseTo(0.27, 2);
  });
  test('a corridor: a line with "x NM EITHER SIDE"; several areas in one NOTAM', () => {
    const a = parseNotamAreas(
      '1ST ROUTE: 361713N0283517E 353559N0275257E 360326N0271753E\n1NM EITHER SIDE OF THE LINE\n' +
        '1ST AREA: 360759N0272341E 360130N0271501E 360102N0265846E 360748N0265111E 360759N0272341E',
    );
    expect(a.map((x) => x.kind)).toEqual(['line', 'polygon']);
    expect(a[0]).toMatchObject({ halfWidthNm: 1 });
  });
  test('lone positions (obstacles) are not areas; shapes far outside the Q-line circle are dropped', () => {
    expect(parseNotamAreas('PTOLEMAIS CHIMNEY 402847.92N 0214339.82E OBST LGT U/S.')).toEqual([]);
    expect(
      parseNotamAreas(
        'MOBILE CRANE ERECTED PSN 375258.81N 234336.07E (ELLINIKON) ELEV 260M AGL, PSN 375237.69N 0234401.16E',
      ),
    ).toEqual([]);
    const text = 'AREA: 350000N 0250000E - 350000N 0251000E - 345000N 0251000E';
    expect(parseNotamAreas(text, { center: { lat: 35, lon: 25.1 }, radiusNm: 10 })).toHaveLength(1);
    expect(parseNotamAreas(text, { center: { lat: 38, lon: 23.7 }, radiusNm: 5 })).toEqual([]);
  });
});

describe('distance from the areas to the route', () => {
  const route = [
    { lat: 38, lon: 23 },
    { lat: 38, lon: 24 },
    { lat: 39, lon: 24 },
  ];
  test('a route crossing a polygon, or a leg starting inside it: 0, with the leg', () => {
    const box = {
      kind: 'polygon' as const,
      points: [
        { lat: 38.4, lon: 23.9 },
        { lat: 38.4, lon: 24.1 },
        { lat: 38.6, lon: 24.1 },
        { lat: 38.6, lon: 23.9 },
      ],
    };
    expect(areasToRoute([box], route)).toEqual({ dist: 0, leg: 1 });
  });
  test('circle and corridor: the gap to their edge', () => {
    const c = areasToRoute([{ kind: 'circle', center: { lat: 37.8, lon: 23.5 }, radiusNm: 5 }], route);
    expect(c.dist).toBeCloseTo(7, 1);
    expect(c.leg).toBe(0);
    const l = areasToRoute(
      [
        {
          kind: 'line',
          points: [
            { lat: 38.5, lon: 24.5 },
            { lat: 38.6, lon: 24.5 },
          ],
          halfWidthNm: 2,
        },
      ],
      route,
    );
    expect(l.dist).toBeCloseTo(30 * Math.cos((38 * Math.PI) / 180) - 2, 1);
    expect(areasToRoute([], route).dist).toBe(Infinity);
  });
});
