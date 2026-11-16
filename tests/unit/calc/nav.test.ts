// Ported from the v2 tests/unit/nav.test.js (js/nav.js → src/calc/nav.ts).
import { expect, test } from 'vitest';
import * as Nav from '../../../src/calc/nav';
import { sampleAt, type Hourly } from '../../../src/data/weather';
import cards from '../../../data/aircraft/compass-cards.json';

const near = (a: number, b: number, tol: number) =>
  expect(Math.abs(a - b), `expected ${b}±${tol}, got ${a}`).toBeLessThanOrEqual(tol);
const card = (reg: 'SX-ASV' | 'SX-ASG', name = 'Magnetic compass') =>
  cards[reg].find((c) => c.name === name)!.points as [number, number][];

test('course and distance', () => {
  near(Nav.distanceNm({ lat: 37, lon: 23 }, { lat: 38, lon: 23 }), 60.0, 0.2);
  near(Nav.trueCourse({ lat: 37, lon: 23 }, { lat: 38, lon: 23 }), 0, 0.01);
  near(Nav.trueCourse({ lat: 38, lon: 23 }, { lat: 38, lon: 24 }), 89.7, 0.1);
  near(Nav.trueCourse({ lat: 38, lon: 24 }, { lat: 38, lon: 23 }), 270.3, 0.1);
});

test('wind triangle sign convention (-L +R)', () => {
  const w = Nav.windTriangle(90, 100, 360, 20)!;
  near(w.wca, -11.54, 0.01);
  near(w.gs, 97.98, 0.01);
  near(Nav.windTriangle(90, 100, 180, 20)!.wca, 11.54, 0.01);
  const h = Nav.windTriangle(90, 100, 90, 20)!;
  near(h.wca, 0, 1e-9);
  near(h.gs, 80, 1e-9);
  expect(Nav.windTriangle(0, 50, 90, 60)).toBeNull();
});

test('deviation card interpolation', () => {
  const v = card('SX-ASV');
  near(Nav.deviation(v, 0)!, 2, 1e-9);
  near(Nav.deviation(v, 15)!, 1.5, 1e-9);
  near(Nav.deviation(v, 150)!, -2, 1e-9);
  near(Nav.deviation(v, 345)!, 0.5, 1e-9);
  near(Nav.deviation(v, 359)!, 1.9, 1e-9);
  near(Nav.deviation(card('SX-ASG'), 300)!, 3, 1e-9);
});

test('leg computation: VAR 5E subtracts, deviation adds, rounding rules', () => {
  const c = card('SX-ASV');
  const r = Nav.computeLeg({ tc: 92.4, dist: 12.4, tas: 92, wd: 0, ws: 0 }, { variation: 5, card: c, fuelPerHour: 30 });
  expect(r).toMatchObject({
    tc: 92,
    wca: 0,
    th: 92,
    var: -5,
    mh: 87,
    dev: 2,
    ch: 89,
    dist: 12,
    gs: 92,
    ete: 8,
    fuel: 4,
  });
  near(r.minutesExact!, 7.826, 0.001);
  const s = Nav.computeLeg({ tc: 10, dist: 2.4, tas: 80, wd: 0, ws: 0 }, { variation: 5, card: c, fuelPerHour: 30 });
  expect([s.ete, s.fuel]).toEqual([2, 1]);
  expect(
    Nav.computeLeg({ tc: 0, dist: 4, tas: 80, wd: 0, ws: 0 }, { variation: 5, card: c, fuelPerHour: 30 }).fuel,
  ).toBe(2);
  const x = Nav.computeLeg({ tc: 0, dist: 8, tas: 80, wd: 0, ws: 0 }, { variation: 5, card: c, fuelPerHour: 30 });
  expect([x.fuel, x.th, x.mh]).toEqual([3, 0, 355]);
});

test('remaining distance/time and totals', () => {
  const rows: Nav.ComputedLeg[] = [
    { tc: 0, dist: 10, ete: 7, fuel: 4 },
    { tc: 0, dist: 20, ete: 13, fuel: 7 },
    { tc: 0, dist: 5, ete: 4, fuel: 2 },
  ];
  const t = Nav.summarize(rows, 4);
  expect(rows.map((r) => r.distRem)).toEqual([25, 5, 0]);
  expect(rows.map((r) => r.ateRem)).toEqual([17, 4, 0]);
  expect(t).toEqual({ dist: 35, ete: 24, tripFuel: 13, fuel: 17 });
  expect([Nav.fmtHmm(4), Nav.fmtHmm(0), Nav.fmtHmm(75), Nav.fmtHdg(0), Nav.fmtHdg(5)]).toEqual([
    '0:04',
    '0:00',
    '1:15',
    '360',
    '005',
  ]);
  expect([
    Nav.fmtHmm(119.6),
    Nav.fmtDuration(104),
    Nav.fmtDuration(10),
    Nav.fmtDuration(0),
    Nav.fmtDuration(119.6),
    Nav.fmtDuration(NaN),
    Nav.fmtDuration(null),
  ]).toEqual(['2:00', '1h44', '0h10', '0h00', '2h00', '', '']);
  expect([
    Nav.fmtAltitude(3000),
    Nav.fmtAltitude(3000, { unit: true }),
    Nav.fmtAltitude(6500),
    Nav.fmtAltitude(9500, { unit: true }),
    Nav.fmtAltitude(NaN),
  ]).toEqual(['3000', '3000 ft', 'FL065', 'FL095', '---']);
  expect([Nav.parseClock('0930'), Nav.parseClock('09:30Z'), Nav.parseClock('24:00')]).toEqual([570, 570, NaN]);
});

test('sunset (NOAA) matches almanac', () => {
  near(Nav.sunsetUtcMinutes('2024-06-21', 51.5074, -0.1278)!, 20 * 60 + 21, 1.5);
  near(Nav.sunsetUtcMinutes('2024-12-21', 37.9838, 23.7275)!, 15 * 60 + 10, 1.5);
});

test('airspace geometry', () => {
  const sq: [number, number][] = [
    [37, 23],
    [38, 23],
    [38, 24],
    [37, 24],
  ];
  expect(Nav.pointInPolygon({ lat: 37.5, lon: 23.5 }, sq)).toBe(true);
  expect(Nav.pointInPolygon({ lat: 36.5, lon: 23.5 }, sq)).toBe(false);
  expect(Nav.segmentEntersPolygon({ lat: 36.5, lon: 23.5 }, { lat: 38.5, lon: 23.5 }, sq)).toBe(true);
  expect(Nav.segmentEntersPolygon({ lat: 36.5, lon: 22 }, { lat: 38.5, lon: 22 }, sq)).toBe(false);
  expect([Nav.parseLevelFt('FL 155'), Nav.parseLevelFt('1000 FT AGL'), Nav.parseLevelFt('UNL')]).toEqual([
    15500,
    1000,
    Infinity,
  ]);
});

test('wind interpolation in height (u/v) and time', () => {
  const hourly = {
    time: ['2026-11-15T09:00', '2026-11-15T10:00'],
    geopotential_height_925hPa: [800, 800],
    wind_speed_925hPa: [10, 10],
    wind_direction_925hPa: [90, 90],
    temperature_925hPa: [10, 10],
    geopotential_height_850hPa: [1500, 1500],
    wind_speed_850hPa: [10, 10],
    wind_direction_850hPa: [180, 180],
    temperature_850hPa: [4, 4],
  } as unknown as Hourly;
  const s = sampleAt(hourly, 1150 / 0.3048, Date.parse('2026-11-15T09:30Z'))!;
  near(s.dirDeg, 135, 0.5);
  near(s.speedKt, 7.07, 0.05);
  near(s.tempC, 7, 0.01);
});
