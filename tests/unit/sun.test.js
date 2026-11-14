const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'sun.js'), 'utf8');
const SUN = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const idx = (m, d) => [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].slice(0, m - 1).reduce((a, b) => a + b, 0) + d - 1;
const hm = (x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;

test('GEN 2.7 tables: all 45 aerodromes, every day', () => {
  assert.equal(Object.keys(SUN).length, 45);
  for (const [k, t] of Object.entries(SUN)) {
    assert.equal(t.ss.length, 366, k);
    assert.ok(t.ss.every((x) => Number.isInteger(x)), k);
  }
});
test('values as printed in the AIP', () => {
  assert.equal(hm(SUN.LGMG.ss[idx(1, 1)]), '15:17');
  assert.equal(hm(SUN.LGMG.ss[idx(3, 31)]), '16:49');
  assert.equal(hm(SUN.LGMG.ss[idx(6, 3)]), '17:45');
  assert.equal(hm(SUN.LGMG.tw[idx(1, 1)]), '15:47');
  assert.equal(hm(SUN.LGAL.ss[idx(11, 29)]), '14:50');
  assert.equal(hm(SUN.LGAL.ss[idx(11, 30)]), '14:50', 'AIP misprint (15:16) replaced by its neighbours');
});
