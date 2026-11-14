const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Nav = require('../../js/nav.js');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'aip.js'), 'utf8');
const AIP = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const ad = (icao) => AIP.aerodromes.find((a) => a.icao === icao);

test('aerodrome data is complete', () => {
  assert.ok(AIP.aerodromes.length >= 80);
  for (const a of AIP.aerodromes) {
    assert.ok(a.lat > 34 && a.lat < 42 && a.lon > 19 && a.lon < 30, `${a.id} position`);
    if (!a.water) assert.ok(a.runways.length > 0, `${a.id} runways`);
    for (const r of a.runways) assert.match(r, /^\d{2}[LRC]?(\/\d{2}[LRC]?)?$/, `${a.id} runway ${r}`);
    for (const f of a.freqs) {
      const v = +f.mhz;
      assert.ok(v >= 118 && v <= 136.975 && v !== 121.5, `${a.id} ${f.mhz}`);
    }
  }
});

test('spot checks against the AIP text', () => {
  assert.deepEqual(ad('LGMG').runways, ['08R/26L']);
  assert.equal(ad('LGMG').elevFt, 12);
  assert.equal(ad('LGMG').freqs.find((f) => f.role === 'primary').mhz, '130.875');
  assert.deepEqual(ad('LGAV').runways.sort(), ['03L/21R', '03R/21L']);
  assert.equal(ad('LGAV').freqs.find((f) => f.callsign.includes('ATIS') || f.service === 'ATIS').mhz, '136.125');
  assert.equal(ad('LGKA').elevFt, 2167);
  assert.equal(ad('LGTT').freqs.find((f) => f.role === 'secondary').mhz, '118.500');
  assert.deepEqual(ad('LGTS').runways, ['10/28', '16/34']);
});

test('each TMA / MTMA contains its aerodrome', () => {
  const exp = {
    LGAV: 'ATHINAI TMA', LGMG: 'ATHINAI TMA', LGIR: 'IRAKLION TMA', LGST: 'IRAKLION TMA', LGKP: 'IRAKLION TMA',
    LGKV: 'KAVALA TMA', LGTS: 'MAKEDONIA TMA', LGMK: 'MIKONOS TMA', LGMT: 'MITILINI TMA', LGRP: 'RODOS TMA',
    LGSM: 'SAMOS TMA', LGSR: 'SANTORINI TMA', LGSK: 'SKIATHOS TMA', LGIO: 'IOANNINA TMA', LGKR: 'KERKIRA TMA',
    LGHI: 'CHIOS TMA', LGLM: 'LIMNOS TMA', LGKO: 'KOS TMA', LGAL: 'ALEXANDROUPOLIS TMA', LGBL: 'ANCHIALOS MTMA',
    LGAD: 'ANDRAVIDA MTMA', LGKL: 'KALAMATA MTMA', LGLR: 'LARISSA MTMA', LGPZ: 'PREVEZA MTMA', LGSY: 'SKIROS MTMA',
    LGSA: 'SOUDA MTMA', LGTG: 'TANAGRA MTMA',
  };
  for (const [icao, name] of Object.entries(exp)) {
    const vols = AIP.airspace.filter((v) => v.name === name);
    assert.ok(vols.length, name);
    assert.ok(vols.some((v) => Nav.pointInPolygon(ad(icao), v.polygon)), `${icao} inside ${name}`);
  }
  // and something clearly outside Greece's TMAs (open sea west of Peloponnese at 36N 20E) is in none of the TMAs
  assert.ok(!AIP.airspace.filter((v) => v.kind === 'TMA').some((v) => Nav.pointInPolygon({ lat: 36, lon: 20 }, v.polygon)));
});

test('FIS units', () => {
  assert.deepEqual(AIP.fis.units.map((u) => u.callsign), ['ATHINAI INFORMATION', 'MAKEDONIA INFORMATION']);
  for (const u of AIP.fis.units) assert.deepEqual(u.freqs, ['130.925', '130.700', '119.750']);
});
