const test = require('node:test');
const assert = require('node:assert/strict');
const Nav = require('../../js/nav.js');
const AIRCRAFT = require('../../js/aircraft.js');
const Weather = require('../../js/weather.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}±${tol}, got ${a}`);

test('Windy URL parsing', () => {
  const r = Nav.parseWindyUrl('https://www.windy.com/route-planner/vfr/37.9814,23.3661;38.1086,23.7833;38.3397,23.5647?2026-11-15-09');
  assert.equal(r.points.length, 3);
  assert.deepEqual(r.points[0], { lat: 37.9814, lon: 23.3661 });
  assert.equal(r.date, '2026-11-15');
  assert.equal(r.hour, 9);
  const d = Nav.parseWindyUrl('https://www.windy.com/distance/vfr/37.9,23.3;38.1,23.7?radar,37.9,23.5,9');
  assert.equal(d.points.length, 2);
  assert.equal(d.date, null);
  assert.equal(Nav.parseWindyUrl('https://www.windy.com/?37.9,23.5,8'), null);
  assert.equal(Nav.parseWindyUrl('37.9,23.3;38.1,23.7').points.length, 2);
  const back = Nav.parseWindyUrl(Nav.windyUrl(r.points, '2026-11-15', 9));
  assert.deepEqual(back.points, r.points);
});

test('course and distance', () => {
  // 1 degree of latitude = 60 NM, due north
  near(Nav.distanceNm({ lat: 37, lon: 23 }, { lat: 38, lon: 23 }), 60.0, 0.2);
  near(Nav.trueCourse({ lat: 37, lon: 23 }, { lat: 38, lon: 23 }), 0, 0.01);
  near(Nav.trueCourse({ lat: 38, lon: 23 }, { lat: 38, lon: 24 }), 89.7, 0.1);
  near(Nav.trueCourse({ lat: 38, lon: 24 }, { lat: 38, lon: 23 }), 270.3, 0.1);
});

test('wind triangle sign convention (-L +R)', () => {
  const w = Nav.windTriangle(90, 100, 360, 20); // wind from the left
  near(w.wca, -11.54, 0.01);
  near(w.gs, 97.98, 0.01);
  const r = Nav.windTriangle(90, 100, 180, 20); // wind from the right
  near(r.wca, 11.54, 0.01);
  const h = Nav.windTriangle(90, 100, 90, 20); // headwind
  near(h.wca, 0, 1e-9); near(h.gs, 80, 1e-9);
  assert.equal(Nav.windTriangle(0, 50, 90, 60), null);
});

test('deviation card interpolation', () => {
  const v = AIRCRAFT['SX-ASV'].cards['Magnetic compass'].points;
  near(Nav.deviation(v, 0), 2, 1e-9);
  near(Nav.deviation(v, 15), 1.5, 1e-9);
  near(Nav.deviation(v, 150), -2, 1e-9);
  near(Nav.deviation(v, 345), 0.5, 1e-9); // between 330 (-1) and 360 (+2)
  near(Nav.deviation(v, 359), 1.9, 1e-9);
  const g = AIRCRAFT['SX-ASG'].cards['Magnetic compass'].points;
  near(Nav.deviation(g, 300), 3, 1e-9);
});

test('leg computation: VAR 5E subtracts, deviation adds, rounding rules', () => {
  const card = AIRCRAFT['SX-ASV'].cards['Magnetic compass'].points;
  const r = Nav.computeLeg({ tc: 92.4, dist: 12.4, tas: 92, wd: 0, ws: 0 }, { variation: 5, card, fuelPerHour: 30 });
  assert.equal(r.tc, 92);
  assert.equal(r.wca, 0);
  assert.equal(r.th, 92);
  assert.equal(r.var, -5);
  assert.equal(r.mh, 87);
  assert.equal(r.dev, 2); // 87 is between 060 (+2) and 090 (+2)
  assert.equal(r.ch, 89);
  assert.equal(r.dist, 12);
  assert.equal(r.gs, 92);
  near(r.minutesExact, 7.826, 0.001);
  assert.equal(r.ete, 8);
  assert.equal(r.fuel, 4); // 7.83 min * 0.5 = 3.91 -> rounded up
  const s = Nav.computeLeg({ tc: 10, dist: 2.4, tas: 80, wd: 0, ws: 0 }, { variation: 5, card, fuelPerHour: 30 });
  assert.equal(s.ete, 2); // 2 NM / 80 kt = 1.5 min -> rounds to 2
  assert.equal(s.fuel, 1);
  const e = Nav.computeLeg({ tc: 0, dist: 4, tas: 80, wd: 0, ws: 0 }, { variation: 5, card, fuelPerHour: 30 });
  assert.equal(e.fuel, 2); // exactly 3 min -> 1.5 L -> 2
  const x = Nav.computeLeg({ tc: 0, dist: 8, tas: 80, wd: 0, ws: 0 }, { variation: 5, card, fuelPerHour: 30 });
  assert.equal(x.fuel, 3); // exactly 6 min -> 3 L, no spurious round-up
  assert.equal(x.th, 0); assert.equal(x.mh, 355);
});

test('remaining distance/time and totals', () => {
  const rows = [{ dist: 10, ete: 7, fuel: 4 }, { dist: 20, ete: 13, fuel: 7 }, { dist: 5, ete: 4, fuel: 2 }];
  const t = Nav.summarize(rows, 4);
  assert.deepEqual(rows.map((r) => r.distRem), [25, 5, 0]);
  assert.deepEqual(rows.map((r) => r.ateRem), [17, 4, 0]);
  assert.deepEqual(t, { dist: 35, ete: 24, tripFuel: 13, fuel: 17 });
  assert.equal(Nav.fmtHmm(4), '0:04');
  assert.equal(Nav.fmtHmm(0), '0:00');
  assert.equal(Nav.fmtHmm(75), '1:15');
  assert.equal(Nav.fmtHdg(0), '360');
  assert.equal(Nav.fmtHdg(5), '005');
});

test('sunset (NOAA) matches almanac', () => {
  // London, 21 Jun 2024: sunset 21:21 BST = 20:21 UTC
  near(Nav.sunsetUtcMinutes('2024-06-21', 51.5074, -0.1278), 20 * 60 + 21, 1.5);
  // Athens, 21 Dec 2024: sunset 17:10 EET = 15:10 UTC
  near(Nav.sunsetUtcMinutes('2024-12-21', 37.9838, 23.7275), 15 * 60 + 10, 1.5);
});

test('airspace geometry', () => {
  const sq = [[37, 23], [38, 23], [38, 24], [37, 24]];
  assert.ok(Nav.pointInPolygon({ lat: 37.5, lon: 23.5 }, sq));
  assert.ok(!Nav.pointInPolygon({ lat: 36.5, lon: 23.5 }, sq));
  assert.ok(Nav.segmentEntersPolygon({ lat: 36.5, lon: 23.5 }, { lat: 38.5, lon: 23.5 }, sq));
  assert.ok(!Nav.segmentEntersPolygon({ lat: 36.5, lon: 22 }, { lat: 38.5, lon: 22 }, sq));
  assert.equal(Nav.parseLevelFt('FL 155'), 15500);
  assert.equal(Nav.parseLevelFt('1000 FT AGL'), 1000);
  assert.equal(Nav.parseLevelFt('UNL'), Infinity);
});

test('wind interpolation in height (u/v) and time', () => {
  const hourly = {
    time: ['2026-11-15T09:00', '2026-11-15T10:00'],
    geopotential_height_925hPa: [800, 800], wind_speed_925hPa: [10, 10], wind_direction_925hPa: [90, 90], temperature_925hPa: [10, 10],
    geopotential_height_850hPa: [1500, 1500], wind_speed_850hPa: [10, 10], wind_direction_850hPa: [180, 180], temperature_850hPa: [4, 4],
  };
  const s = Weather.sampleAt(hourly, 1150 / 0.3048, Date.parse('2026-11-15T09:30Z'));
  near(s.dir, 135, 0.5);          // halfway between E and S
  near(s.spd, 7.07, 0.05);        // vector average
  near(s.temp, 7, 0.01);
});
