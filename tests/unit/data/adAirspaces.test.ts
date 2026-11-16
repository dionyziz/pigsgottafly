// Aerodrome CTRs and ATZs (tools/parse_ad_airspace.py → src/data/ref/ad-airspaces.json): sanity checks over
// every record, and spot checks of values read by hand off AD 2.17 / AD 1.6.N.17 (AIRAC 09/26).
import { describe, expect, test } from 'vitest';

import { distanceNm } from '../../../src/calc/nav';
import { AD_AIRSPACES, AERODROMES, REF } from '../../../src/data/ref';
import { fromAd, limitFt, pointInRing } from '../../../src/features/editor/map/airspace';

const adById = new Map(AERODROMES.map((a) => [a.id, a]));
const z = (id: string) => AD_AIRSPACES.find((r) => r.id === id)!;

describe('aerodrome airspace data: every record', () => {
  test('is in the client reference bundle', () => {
    expect(REF.adAirspaces).toBe(AD_AIRSPACES);
    expect(AD_AIRSPACES.length).toBeGreaterThanOrEqual(85);
  });
  test('belongs to a known aerodrome, one record per kind', () => {
    const ids = new Set<string>();
    for (const r of AD_AIRSPACES) {
      expect(adById.has(r.aerodromeId), r.id).toBe(true);
      expect(r.id).toBe(`${r.aerodromeId}-${r.kind}`);
      expect(ids.has(r.id), r.id).toBe(false);
      ids.add(r.id);
      expect(r.name.endsWith(r.kind), r.id).toBe(true);
      expect(r.mil).toBe(/\bMIL\b/.test(r.name));
    }
  });
  test('has exactly one geometry, near its aerodrome', () => {
    for (const r of AD_AIRSPACES) {
      expect(!!r.circle !== !!r.polygon, r.id).toBe(true);
      const ad = adById.get(r.aerodromeId)!;
      if (r.circle) {
        expect(r.circle.radiusNm, r.id).toBeGreaterThan(1);
        expect(r.circle.radiusNm, r.id).toBeLessThanOrEqual(20);
        // the published centre is the ARP or close to it (LGPA: the ATZ centre is 0.96 NM from the AD 2.2 ARP)
        expect(distanceNm(r.circle, ad), r.id).toBeLessThan(1);
      } else {
        const ring = r.polygon!;
        expect(ring.length, r.id).toBeGreaterThanOrEqual(5);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        for (const [lat, lon] of ring) expect(distanceNm({ lat, lon }, ad), r.id).toBeLessThan(30);
      }
    }
  });
  test('vertical limits from the surface to a readable upper limit; a class', () => {
    for (const r of AD_AIRSPACES) {
      expect(r.lower, r.id).toBe('SFC');
      const up = limitFt(r.upper).ft;
      expect(up, `${r.id} ${r.upper}`).toBeGreaterThanOrEqual(1000);
      expect(up, `${r.id} ${r.upper}`).toBeLessThanOrEqual(14000);
      expect(['D', 'G'], r.id).toContain(r.class);
    }
  });
  test('the aerodrome lies inside its zone', () => {
    for (const r of AD_AIRSPACES) {
      // LGIR CTR: "Points (a) and (b) are joined by an arc of circle lying East" — read literally, the
      // CTR is the sector east/south-east of the IRA arc, which leaves the ARP in the ATZ only.
      if (r.id === 'LGIR-CTR') continue;
      const ad = adById.get(r.aerodromeId)!;
      const info = fromAd(r)!;
      expect(pointInRing(ad.lon, ad.lat, info.ring), r.id).toBe(true);
    }
  });
  test('call signs with frequencies where the AIP lists the unit', () => {
    const withFreq = AD_AIRSPACES.filter((r) => r.units.some((u) => u.freqs.length > 0));
    expect(withFreq.length / AD_AIRSPACES.length).toBeGreaterThan(0.9);
  });
});

describe('aerodrome airspace data: read off the AIP', () => {
  test('LGTT (AD 1.6.5.17): DEKELIA TATOI MIL ATZ, 6 NM, SFC to 5000 FT, class D, TATOI TOWER', () => {
    const r = z('LGTT-ATZ');
    expect(r.name).toBe('DEKELIA TATOI MIL ATZ');
    expect(r.circle).toEqual({ lat: 38.108611, lon: 23.783333, radiusNm: 6 });
    expect([r.lower, r.upper, r.class]).toEqual(['SFC', '5000 FT', 'D']);
    expect(r.units[0].callsign).toBe('TATOI TOWER');
    expect(r.units[0].freqs[0]).toBe('122.650');
    expect(z('LGTT-CTR')).toBeUndefined();
  });
  test('LGLR is a MIL CTR of 10 NM and a MIL ATZ of 7 NM (not two ATZs)', () => {
    expect([z('LGLR-CTR').circle?.radiusNm, z('LGLR-CTR').upper]).toEqual([10, '5000 FT']);
    expect([z('LGLR-ATZ').circle?.radiusNm, z('LGLR-ATZ').upper]).toEqual([7, '2000 FT']);
  });
  test('LGAV CTR is the published quadrilateral, not a circle; ATZ 5 NM to 3000 FT', () => {
    const r = z('LGAV-CTR');
    expect(r.circle).toBeUndefined();
    expect(r.polygon).toEqual([[37.75, 23.633333], [38.166667, 24.033333], [38.166667, 24.3], [37.666667, 23.816667], [37.75, 23.633333]]);
    expect(r.upper).toBe('7000 FT');
    expect(r.units.map((u) => u.callsign)).toEqual(['ATHINAI APPROACH', 'ATHINAI TMA INFORMATION']);
    expect([z('LGAV-ATZ').circle?.radiusNm, z('LGAV-ATZ').upper]).toEqual([5, '3000 FT']);
  });
  test('LGTG and LGSY: MIL CTR 10 NM + MIL ATZ 5 NM with their own upper limits', () => {
    expect([z('LGTG-CTR').upper, z('LGTG-ATZ').upper]).toEqual(['5000 FT', '2000 FT']);
    expect([z('LGSY-CTR').upper, z('LGSY-ATZ').upper]).toEqual(['4000 FT', '3000 FT']);
    expect(z('LGSY-CTR').units[0].callsign).toBe('SKIROS APPROACH');
  });
  test('FL upper limits and class G ATZs', () => {
    expect(z('LGKR-CTR').upper).toBe('FL 100');
    expect(z('LGKA-CTR').upper).toBe('FL 140');
    expect(z('LGNX-ATZ').class).toBe('G');
    expect(z('LGPA-CTR').afis).toBe(true);
  });
  test('arcs follow the published radius around their centre', () => {
    const arcOk = (id: string, centre: { lat: number; lon: number }, nm: number, minVertices: number) => {
      const near = z(id).polygon!.filter(([lat, lon]) => Math.abs(distanceNm({ lat, lon }, centre) - nm) < 0.05);
      expect(near.length, id).toBeGreaterThanOrEqual(minVertices);
    };
    arcOk('LGEL-CTR', { lat: 38.068381, lon: 23.553586 }, 5, 20);
    arcOk('LGPA-CTR', { lat: 37.010278, lon: 25.128056 }, 13, 20);
    arcOk('LGKV-CTR', { lat: 40.913889, lon: 24.619722 }, 12, 60);
    arcOk('LGST-CTR', { lat: 35.218622, lon: 26.106764 }, 25, 20);
    arcOk('LGST-CTR', { lat: 35.218622, lon: 26.106764 }, 10, 20);
    arcOk('LGIR-CTR', { lat: 35.340744, lon: 25.185144 }, 10, 20);
  });
  test('Rodos Maritsa publishes no lateral limits of its own (inside the LGRP ATZ)', () => {
    expect(z('LGRD-ATZ')).toBeUndefined();
  });
});
