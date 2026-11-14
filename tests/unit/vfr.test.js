const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Nav = require('../../js/nav.js');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'vfr.js'), 'utf8');
const VFR = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const pt = (chart, name) => VFR.points.find((p) => p.chart === chart && p.name === name);

test('every VFR route joins two reporting points of its own chart', () => {
  assert.ok(VFR.routes.length > 200);
  for (const r of VFR.routes) {
    const a = pt(r.chart, r.a), b = pt(r.chart, r.b);
    assert.ok(a && b, `${r.chart} ${r.a}–${r.b}`);
    assert.ok(r.min >= 500 && r.min <= r.max && r.max <= 12000, `${r.chart} ${r.a}–${r.b} altitude`);
    const d = Nav.distanceNm(a, b);
    assert.ok(d > 0.5 && d < 80, `${r.chart} ${r.a}–${r.b} length ${d}`);
  }
});

test('charts covered', () => {
  const charts = new Set(VFR.routes.map((r) => r.chart));
  for (const c of ['LGAV', 'LGBL', 'LGKL', 'LGKO', 'LGKP', 'LGKR', 'LGKV', 'LGMK', 'LGMT', 'LGPA', 'LGRP', 'LGSA', 'LGSK', 'LGSM', 'LGSR', 'LGSY', 'LGTS']) {
    assert.ok(charts.has(c), c);
  }
});

test('spot checks against the AIP charts', () => {
  const r = (c, a, b) => VFR.routes.find((x) => x.chart === c && x.a === a && x.b === b);
  assert.equal(r('LGAV', 'KORINTHOS', 'MEGARA').max, 3500);
  assert.equal(r('LGRP', 'LINDOS', 'NOVEMBER').max, 5500);   // southbound 5500
  assert.equal(r('LGRP', 'NOVEMBER', 'LINDOS').max, 4500);   // northbound 4500
  assert.equal(r('LGRP', 'NOVEMBER', 'LINDOS').oneway, true);
  assert.equal(r('LGSR', 'KARAVOS', 'IRBEG').max, 2500);
  assert.equal(r('LGTS', 'PIKROS', 'LAGADA').max, 3000);
  assert.equal(r('LGKP', 'MOKIS', 'INATOS').max, 6500);
  const varix = pt('LGMK', 'VARIX');
  assert.ok(Math.abs(varix.lat - (37 + 21 / 60 + 50 / 3600)) < 1e-4 && Math.abs(varix.lon - (25 + 2 / 60 + 3 / 3600)) < 1e-4);
});

test('open flightmaps points fill in names for the rest of Greece', () => {
  assert.ok(VFR.points.filter((p) => p.src === 'ofm').length > 100);
  assert.ok(VFR.points.some((p) => p.name === 'PANOMI'));
});
