// Runway reference data (tools/parse_runways.py → tools/runways.json → tools/build_ref.ts): sanity checks
// over every runway direction, and spot checks of values read by hand off the eAIP PDFs (AIRAC 09/26).
import { describe, expect, test } from 'vitest';
import { AERODROMES, RUNWAYS, runwaysOf } from '../../../src/data/ref';
import { distanceNm, norm180, trueCourse } from '../../../src/calc/nav';
import { magneticVariation } from '../../../src/calc/wmm';
import type { RefRunwayFull } from '../../../tools/build_ref_runways';
import { connect } from '../../../api/_lib/db';
import { migrate, MIGRATIONS } from '../../../api/_lib/migrate';
import runways005 from '../../../api/_lib/migrations/005_ref_runways_2609';

const RW = RUNWAYS as RefRunwayFull[];
const rw = (ad: string, d: string) => RW.find((r) => r.aerodromeId === ad && r.designator === d)!;
const opposite = (r: RefRunwayFull) => rw(r.aerodromeId, r.reciprocal);
const name = (r: RefRunwayFull) => `${r.aerodromeId} ${r.designator}`;
const adById = new Map(AERODROMES.map((a) => [a.id, a]));
const thr = (r: RefRunwayFull) => ({ lat: r.thrLat!, lon: r.thrLon! });

describe('runway data: every direction', () => {
  test('one record per listed runway end, paired with its reciprocal', () => {
    const listed = AERODROMES.flatMap((a) => a.runways.flatMap((p) => p.split('/').map((d) => `${a.id} ${d}`)));
    expect(RW.map(name).sort()).toEqual(listed.sort());
    for (const r of RW) {
      const o = opposite(r);
      expect(o, name(r)).toBeTruthy();
      expect(o.reciprocal).toBe(r.designator);
      // the AIP pairs Kalamata Triodhon 15 with 34 (as printed in AD 1.6.10); every other pair is exactly 180° apart
      const off = Math.abs(Math.abs(norm180(parseInt(r.designator) * 10 - parseInt(o.designator) * 10)) - 180);
      expect(off, name(r)).toBe(r.aerodromeId === 'KALAMATA-TRIODHON' ? 10 : 0);
    }
  });

  test('bearings agree with the designators and the reciprocal', () => {
    for (const r of RW) {
      const n = parseInt(r.designator, 10) * 10;
      // runway names keep the variation of the year they were painted: allow 10° (LGTT 03 is 022° MAG today)
      expect(Math.abs(norm180(r.headingMagDeg - n)), `${name(r)} MAG ${r.headingMagDeg}`).toBeLessThanOrEqual(10);
      if (r.headingTrueDeg === null) continue;
      expect(Math.abs(norm180(r.headingTrueDeg - n)), `${name(r)} TRUE ${r.headingTrueDeg}`).toBeLessThanOrEqual(12);
      const o = opposite(r);
      if (o.headingTrueDeg !== null) expect(Math.abs(Math.abs(norm180(r.headingTrueDeg - o.headingTrueDeg)) - 180), name(r)).toBeLessThanOrEqual(0.6);
      if (r.magVarDeg !== null) {
        expect(r.magVarDeg > 3.5 && r.magVarDeg < 7, `${name(r)} var ${r.magVarDeg}`).toBe(true);
        expect(Math.abs(norm180(r.headingTrueDeg - r.magVarDeg - r.headingMagDeg))).toBeLessThan(0.06);
      }
    }
  });

  test('the variation used agrees with the World Magnetic Model within 1°', () => {
    for (const r of RW) {
      if (r.magVarDeg === null) continue;
      const a = adById.get(r.aerodromeId)!;
      expect(Math.abs(r.magVarDeg - magneticVariation(a.lat, a.lon, '2026-10-29')), name(r)).toBeLessThan(1);
    }
  });

  test('published TRUE BRG matches the course between the published thresholds (or a note says it does not)', () => {
    for (const r of RW) {
      const o = opposite(r);
      if (r.headingTrueSource !== 'aip' || r.thrLat === null || o.thrLat === null) continue;
      const diff = Math.abs(norm180(trueCourse(thr(r), thr(o)) - r.headingTrueDeg!));
      if (diff > 1) expect(r.notes.join(' '), name(r)).toMatch(/TRUE BRG/);
      else expect(r.notes, name(r)).toEqual([]);
    }
  });

  test('thresholds lie on the aerodrome and their separation fits the runway length', () => {
    for (const r of RW) {
      if (r.thrLat === null) continue;
      const a = adById.get(r.aerodromeId)!;
      expect(distanceNm(thr(r), a), name(r)).toBeLessThan(2);
      const o = opposite(r);
      if (o.thrLat === null || r.lengthM === null) continue;
      const m = distanceNm(thr(r), thr(o)) * 1852;
      expect(m <= r.lengthM + 5 && m >= r.lengthM * 0.6, `${name(r)} THR-THR ${m.toFixed(0)} M, RWY ${r.lengthM} M`).toBe(true);
    }
  });

  test('dimensions and declared distances are positive and consistent', () => {
    for (const r of RW) {
      const n = name(r);
      if (r.lengthM !== null) expect(r.lengthM > 100 && r.lengthM < 5000, n).toBe(true);
      if (r.widthM !== null) expect(r.widthM >= 10 && r.widthM <= 80, n).toBe(true);
      expect(r.lengthM, n).toBe(opposite(r).lengthM);
      for (const k of ['toraM', 'todaM', 'asdaM', 'ldaM'] as const) {
        const v = r[k];
        if (v === null) { expect(r.gaps, n).toContain(k.replace(/M$/, '').toUpperCase()); continue; }
        expect(v > 0, `${n} ${k}`).toBe(true);
      }
      if (r.lengthM === null) continue;
      if (r.toraM !== null) expect(r.toraM, `${n} TORA`).toBeLessThanOrEqual(r.lengthM);
      if (r.ldaM !== null) expect(r.ldaM, `${n} LDA`).toBeLessThanOrEqual(r.lengthM);
      if (r.toraM !== null && r.todaM !== null) expect(r.todaM >= r.toraM && r.todaM <= r.toraM * 1.5, `${n} TODA`).toBe(true);
      // ASDA may include a stopway (LGTP: 1941 M RWY + 85 M SWY)
      if (r.toraM !== null && r.asdaM !== null) expect(r.asdaM >= r.toraM && r.asdaM <= r.lengthM + 300, `${n} ASDA`).toBe(true);
    }
  });

  test('slopes: plausible, opposite in the two directions, and the AIP sign agrees with the threshold elevations', () => {
    for (const r of RW) {
      const o = opposite(r), n = name(r);
      if (r.slopePct === null) { expect(r.slopeSource, n).toBeNull(); continue; }
      expect(Math.abs(r.slopePct), n).toBeLessThan(2.5);
      if (o.slopePct !== null && r.slopeSource !== 'aip') expect(r.slopePct + o.slopePct, n).toBeCloseTo(0, 6);
      if (r.slopeSource === 'aip' && r.slopePct !== 0 && r.thresholdElevSource === 'aip' && o.thresholdElevSource === 'aip') {
        expect(Math.sign(o.thresholdElevFt! - r.thresholdElevFt!), `${n} slope ${r.slopeText}`).toBe(Math.sign(r.slopePct));
      }
      if (r.slopeSource === 'thr-elevations') expect(r.gaps).toContain('slope');
    }
  });

  test('every record says where it comes from', () => {
    for (const r of RW) {
      expect(r.source.physical, name(r)).toMatch(/^(LG[A-Z]{2} AD 2\.12|AD 1\.6\.\d+\.12) \(/);
      expect(r.source.declared, name(r)).toMatch(/^(LG[A-Z]{2} AD 2\.13|AD 1\.6\.\d+\.13) \(/);
      if (r.headingMagSource !== 'designator') expect(r.source.magVar, name(r)).toMatch(/MAG VAR/);
    }
  });
});

describe('runway data: values read off the AIP PDFs', () => {
  test('LGTT Dekelia/Tatoi (AD 1.6.5.12/13, page AD 1.6.5-3, AMDT 11/24)', () => {
    expect(runwaysOf('LGTT').map((r) => r.designator)).toEqual(['03', '21']);
    expect(rw('LGTT', '03')).toMatchObject({
      headingTrueDeg: 27.46, lengthM: 1868, widthM: 45, surface: 'ASPH', strength: 'LCN 45',
      toraM: 1868, todaM: 1868, asdaM: 1868, ldaM: 1718, thresholdElevFt: 745.3, declaredRemark: 'DTHR 150 M',
      thrLat: 38.102161, thrLon: 23.779239, slopeText: 'NIL', slopeSource: 'thr-elevations',
    });
    expect(rw('LGTT', '21')).toMatchObject({ headingTrueDeg: 207.46, ldaM: 1741, thresholdElevFt: 845.9, declaredRemark: 'DTHR 127 M' });
    // slope is not published; the thresholds (745.3 / 845.9 FT, ~1591 M apart) make RWY 03 ~1.9 % uphill
    expect(rw('LGTT', '03').slopePct).toBeCloseTo(1.92, 2);
    expect(rw('LGTT', '21').slopePct).toBeCloseTo(-1.92, 2);
    // LGTT publishes MAG VAR NIL: the nearest published one (LGEL, 11 NM) is used
    expect(rw('LGTT', '03').headingMagSource).toBe('true-minus-nearby-aip-var');
    expect(rw('LGTT', '03').headingMagDeg).toBeCloseTo(22.2, 1);
  });

  test('LGKR Kerkira (AD 2 LGKR-5)', () => {
    expect(rw('LGKR', '16')).toMatchObject({ headingTrueDeg: 169, lengthM: 2373, widthM: 45, toraM: 2373, todaM: 2373, asdaM: 2373, ldaM: 1963, thresholdElevFt: 6.3 });
    expect(rw('LGKR', '34')).toMatchObject({ headingTrueDeg: 349, ldaM: 2314, thresholdElevFt: 5.91, thrLat: 39.592067, thrLon: 19.914653 });
  });

  test('LGIO Ioannina (AD 2 LGIO-5)', () => {
    expect(rw('LGIO', '14')).toMatchObject({ headingTrueDeg: 141.69, lengthM: 2402, ldaM: 2402, thresholdElevFt: 1549.5, thrLat: 39.705808, thrLon: 20.813233 });
    expect(rw('LGIO', '32')).toMatchObject({ headingTrueDeg: 321.7, ldaM: 2282, thresholdElevFt: 1557.08 });
  });

  test('LGKA Kastoria (AD 2 LGKA-5)', () => {
    expect(rw('LGKA', '12')).toMatchObject({ headingTrueDeg: 125, lengthM: 2698, widthM: 45, toraM: 2698, ldaM: 2516, thresholdElevFt: 2166.08, strength: 'PCN 40/F/C/X/T' });
    expect(rw('LGKA', '30')).toMatchObject({ headingTrueDeg: 305, ldaM: 2698, thresholdElevFt: 2118.91 });
    // MAG VAR 3.50°E JAN 2010 + 0.075°/year → ~4.8°E at AIRAC 09/26
    expect(rw('LGKA', '12').magVarDeg).toBeCloseTo(4.76, 1);
  });

  test('LGKZ Kozani (AD 2 LGKZ-4)', () => {
    expect(rw('LGKZ', '14')).toMatchObject({ headingTrueDeg: 143, lengthM: 1822, widthM: 30, toraM: 1822, ldaM: 1641, thresholdElevFt: 2049.58 });
    expect(rw('LGKZ', '32')).toMatchObject({ headingTrueDeg: 323, ldaM: 1822, thresholdElevFt: 1967.83 });
  });

  test('LGMG Megara (AD 1.6.18): distances published, bearing/thresholds not, slope sign ambiguous', () => {
    expect(rw('LGMG', '08R')).toMatchObject({ lengthM: 1205, widthM: 38, toraM: 1205, todaM: 1205, asdaM: 1205, ldaM: 1205,
      headingTrueDeg: null, headingMagDeg: 80, headingMagSource: 'designator', slopePct: null, slopeText: '- 0.16 %' });
    expect(rw('LGMG', '08R').gaps).toEqual(expect.arrayContaining(['true bearing', 'threshold coordinates', 'slope']));
  });

  test('published slopes and the remark-modified distances', () => {
    expect(rw('LGAL', '07')).toMatchObject({ slopePct: 1.2, slopeSource: 'aip' });
    expect(rw('LGEL', '36')).toMatchObject({ slopePct: 1.22, toraM: 2740, asdaM: 3000, ldaM: 2680 });
    // LGSY prints 0.32 % for both directions; the thresholds (13.55 / 39.13 FT) give the sign
    expect(rw('LGSY', '17')).toMatchObject({ slopePct: 0.32, slopeSource: 'aip-magnitude-thr-sign', ldaM: 2837 });
    expect(rw('LGSY', '35')).toMatchObject({ slopePct: -0.32, ldaM: 2202 });
    // LGBL AD 2.13 remark: take-off 120 M inwards → TORA = TODA = ASDA = 2639 (the table prints 2759)
    expect(rw('LGBL', '08')).toMatchObject({ toraM: 2639, todaM: 2639, asdaM: 2639, ldaM: 2759 });
    expect(rw('LGBL', '08').corrections[0]).toMatch(/printed 2759, used 2639/);
    // LGTP prints '1.941' (thousands separator)
    expect(rw('LGTP', '02')).toMatchObject({ toraM: 1941, asdaM: 2026, headingTrueSource: 'thr-coordinates' });
    expect(rw('LGAV', '03R').intersections.map((i) => i.toraM)).toEqual([3900, 2950, 2500]);
  });
});

test('migration 005 replaces the AIRAC runway rows with the full records', async () => {
  const db = await connect('memory://');
  const list = [...MIGRATIONS.filter((m) => m.name < '005'), { name: '005_ref_runways_2609', sql: runways005 }];
  await migrate(db, list);
  const rows = await db.query<{ doc: RefRunwayFull }>(`SELECT doc FROM ref_runways WHERE airac = '2609' ORDER BY aerodrome_id, designator`);
  expect(rows.length).toBe(RW.length);
  const tt = rows.map((x) => (typeof x.doc === 'string' ? JSON.parse(x.doc) : x.doc)).find((d) => d.aerodromeId === 'LGTT' && d.designator === '03');
  expect(tt).toMatchObject({ ldaM: 1718, toraM: 1868, headingTrueDeg: 27.46 });
  await db.close();
});
