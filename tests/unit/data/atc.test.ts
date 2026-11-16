// ATC list generation on real routes, against the AIRAC reference data.
import { describe, expect, test } from 'vitest';

import {
  aerodromeUnits,
  atcEntryLegs,
  atcFreqText,
  atcInput,
  atcLegRelevance,
  endpointAerodrome,
  fisSide,
  generateAtcList,
  regenerateAtcList,
  shortUnit,
} from '../../../src/data/atc';
import { aerodrome, REF, vfrPoint } from '../../../src/data/ref';
import type { RefAirspace } from '../../../src/shared/ref';
import type { AtcEntry, RoutePoint } from '../../../src/shared/types';

const ad = (icao: string): RoutePoint => {
  const a = aerodrome(icao)!;
  return { uid: `u-${icao}`, kind: 'aerodrome', refId: a.id, name: a.icao ?? a.name, lat: a.lat, lon: a.lon };
};
const vfr = (id: string): RoutePoint => {
  const p = vfrPoint(id)!;
  return { uid: `u-${id}`, kind: 'vfr', refId: p.id, name: p.name, lat: p.lat, lon: p.lon };
};
const custom = (name: string, lat: number, lon: number): RoutePoint => ({ uid: `u-${name}`, kind: 'custom', refId: null, name, lat, lon });

function gen(route: RoutePoint[], alts: number[], radius = 2): AtcEntry[] {
  return generateAtcList(atcInput(route, alts, REF, radius));
}
const rows = (list: AtcEntry[]) => list.map((e) => `${e.role}|${e.group}|${e.callsign}|${e.service}|${atcFreqText(e)}`);

describe('helpers', () => {
  test('short unit labels', () => {
    expect(shortUnit('TATOI TOWER')).toBe('TWR');
    expect(shortUnit('ATHINAI APPROACH')).toBe('APP');
    expect(shortUnit('KERKIRA IOANNIS KAPODISTRIAS AIRPORT INFORMATION', 'ATIS')).toBe('ATIS');
    expect(shortUnit('KASTORIA INFORMATION', 'AFIS')).toBe('INFO');
    expect(shortUnit('LYDIA RADIO', 'G/A/G')).toBe('RADIO');
  });

  test('aerodrome units: primary + one backup, merged when frequencies are identical', () => {
    const tt = aerodromeUnits(aerodrome('LGTT')!);
    expect(tt).toHaveLength(1);
    expect(tt[0].freqs).toEqual(['122.650', '118.500']); // RGA 122.100 dropped: one backup only
    const sy = aerodromeUnits(aerodrome('LGSY')!);
    expect(sy).toHaveLength(1); // TWR and APP share 123.200 / 122.100
    expect(sy[0].labels).toEqual(['TWR', 'APP']);
    const av = aerodromeUnits(aerodrome('LGAV')!);
    expect(av.map((u) => u.labels.join('/'))).toEqual(['ATIS', 'DEL', 'GND', 'TWR', 'INFO']);
    expect(av.find((u) => u.labels[0] === 'TWR')!.freqs).toEqual(['136.275', '118.625']); // two primaries
    expect(av.find((u) => u.labels[0] === 'GND')!.freqs).toEqual(['121.755', '121.955']);
  });

  test('endpoint aerodrome: by reference, else nearest within 2 NM', () => {
    expect(endpointAerodrome(ad('LGTT'), REF.aerodromes)!.id).toBe('LGTT');
    expect(endpointAerodrome(custom('NEAR', 38.115, 23.79), REF.aerodromes)!.id).toBe('LGTT');
    expect(endpointAerodrome(custom('SEA', 37.5, 24.5), REF.aerodromes)).toBeNull();
  });

  test('FIS sector side (ENR 2.1 boundary)', () => {
    const b = REF.fis.boundary;
    expect(fisSide(aerodrome('LGTS')!, b)).toBe('north'); // Thessaloniki
    expect(fisSide(aerodrome('LGSY')!, b)).toBe('north');
    expect(fisSide(aerodrome('LGIR')!, b)).toBe('south'); // Iraklion
    expect(fisSide(aerodrome('LGKR')!, b)).toBe('south'); // west of the boundary's start
    expect(fisSide(aerodrome('LGRP')!, b)).toBe('south'); // east of its end
  });
});

describe('real routes', () => {
  test('LGTT-LGSY via KIMI at 4500 ft', () => {
    const list = gen([ad('LGTT'), vfr('LGSY/KIMI'), ad('LGSY')], [4500, 4500]);
    expect(rows(list)).toEqual([
      'departure|LGTT DEKELIA / TATOI|TATOI TOWER|TWR|122.650 / 118.500',
      'destination|LGSY SKIROS|SKIROS TOWER / APPROACH|TWR/APP|123.200 / 122.100',
      'airspace|ATHINAI TMA|ATHINAI TMA INFORMATION|INFO|124.025 / 131.175',
      'airspace|ATHINAI TMA|ATHINAI APPROACH|APP|126.575 / 130.025',
      'airspace|TANAGRA MTMA|TANAGRA APPROACH|APP|120.250',
      'fis|FIS|MAKEDONIA INFORMATION|INFO|130.925 / 130.700',
    ]);
    // the SKIROS MTMA is entered too, but SKIROS APPROACH 123.200 is already listed with the destination
    expect(list.filter((e) => e.group === 'SKIROS MTMA')).toEqual([]);
    expect(list[2].remark).toContain("1000' AGL–FL 245");
    // ids are the generator keys: stable across regenerations
    expect(list.map((e) => e.id)).toEqual(list.map((e) => e.sourceKey));
    expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
    expect(list[0].sourceKey).toBe('ad:LGTT:TATOI TOWER');
  });

  test('LGTT-LGKR direct at 5500 ft: en-route Tanagra zone, both FIS sectors, Preveza MTMA', () => {
    const list = gen([ad('LGTT'), ad('LGKR')], [5500]);
    expect(rows(list)).toEqual([
      'departure|LGTT DEKELIA / TATOI|TATOI TOWER|TWR|122.650 / 118.500',
      'enroute|LGTG TANAGRA|TANAGRA TOWER / APPROACH|TWR/APP|120.250 / 122.100',
      'destination|LGKR KERKIRA / IOANNIS KAPODISTRIAS|KERKIRA IOANNIS KAPODISTRIAS AIRPORT INFORMATION|ATIS|126.355',
      'destination|LGKR KERKIRA / IOANNIS KAPODISTRIAS|KERKIRA GROUND|GND|121.705',
      'destination|LGKR KERKIRA / IOANNIS KAPODISTRIAS|KERKIRA TOWER|TWR|120.855 / 122.100',
      'destination|LGKR KERKIRA / IOANNIS KAPODISTRIAS|KERKIRA APPROACH|APP|122.355 / 118.080',
      'airspace|ATHINAI TMA|ATHINAI TMA INFORMATION|INFO|124.025 / 131.175',
      'airspace|ATHINAI TMA|ATHINAI APPROACH|APP|126.575 / 130.025',
      'airspace|ANCHIALOS MTMA|ALMIROS APPROACH|APP|120.350',
      'airspace|PREVEZA MTMA|AKTION APPROACH|APP|120.450',
      'fis|FIS|MAKEDONIA / ATHINAI INFORMATION|INFO|130.925 / 130.700',
    ]);
    // TANAGRA MTMA is entered, but its unit is the en-route Tanagra row
    expect(list.some((e) => e.group === 'TANAGRA MTMA')).toBe(false);
  });

  test('LGTT-LGKR above the Preveza MTMA (FL 125) drops it', () => {
    const list = gen([ad('LGTT'), ad('LGKR')], [13500]);
    expect(list.some((e) => e.group === 'PREVEZA MTMA')).toBe(false);
    expect(list.some((e) => e.group === 'ANCHIALOS MTMA')).toBe(true); // UNL
  });

  test('LGMG local: aerodrome once, TMA at 1500 ft, nothing below 1000 ft', () => {
    const route = [ad('LGMG'), custom('ZOFRI', 38.15, 23.25), ad('LGMG')];
    const list = gen(route, [1500, 1500]);
    expect(rows(list)).toEqual([
      'departure|LGMG MEGARA|MEGARA TOWER|TWR|130.875 / 122.100',
      'airspace|ATHINAI TMA|ATHINAI TMA INFORMATION|INFO|124.025 / 131.175',
      'airspace|ATHINAI TMA|ATHINAI APPROACH|APP|126.575 / 130.025',
      'fis|FIS|MAKEDONIA INFORMATION|INFO|130.925 / 130.700',
    ]);
    expect(list[0].remark).toBe('Departure and destination');
    const low = gen(route, [900, 900]);
    expect(low.some((e) => e.role === 'airspace')).toBe(false);
    // unknown altitude: airspace listed regardless of level
    expect(gen(route, [NaN, NaN]).some((e) => e.group === 'ATHINAI TMA')).toBe(true);
  });

  test('LGTT-LGMG: Elefsis is passed (en-route, within radius), in route order', () => {
    const list = gen([ad('LGTT'), ad('LGMG')], [2500]);
    expect(list.map((e) => `${e.role}:${e.group.split(' ')[0]}`).slice(0, 3)).toEqual([
      'departure:LGTT',
      'enroute:LGEL',
      'destination:LGMG',
    ]);
  });

  test('en-route radius: an aerodrome off the route is listed only within the radius', () => {
    // a leg passing ~3 NM east of Megara's reference point (zone 3 NM)
    const route = [custom('A', 37.85, 23.43), custom('B', 38.1, 23.43)];
    const near = (r: number) => gen(route, [3000], r).some((e) => e.group.startsWith('LGMG'));
    expect(near(2)).toBe(false);
    expect(near(5)).toBe(true);
  });

  test('custom endpoints far from aerodromes give no aerodrome rows; empty route gives nothing', () => {
    const list = gen([custom('A', 37.5, 24.5), custom('B', 37.6, 24.7)], [3500]);
    expect(list.some((e) => e.role === 'departure' || e.role === 'destination')).toBe(false);
    expect(list.at(-1)!.role).toBe('fis');
    expect(gen([], [])).toEqual([]);
  });

  test('airspace vertical limits are respected (synthetic volume)', () => {
    const box: RefAirspace = {
      id: 'TEST-1', name: 'TEST TMA', kind: 'TMA', class: 'C', sector: '', lower: '3000 FT', upper: 'FL 065',
      polygon: [[37, 24], [37, 25], [38, 25], [38, 24]],
      units: [{ callsign: 'TEST APPROACH', freqs: ['119.000', '120.000', '121.000'], hours: 'H24' }], note: '', source: '',
    };
    const input = (alt: number) => ({ ...atcInput([custom('A', 37.5, 23.5), custom('B', 37.5, 24.5)], [alt], REF, 2), airspaces: [box] });
    expect(generateAtcList(input(2500)).some((e) => e.group === 'TEST TMA')).toBe(false);
    const hit = generateAtcList(input(4500)).find((e) => e.group === 'TEST TMA')!;
    expect(hit.primary).toBe('119.000');
    expect(hit.backups).toEqual(['120.000']);
    expect(hit.remark).toBe("3000'–FL 065; H24");
    expect(generateAtcList(input(7500)).some((e) => e.group === 'TEST TMA')).toBe(false);
  });
});

describe('legs each row relates to', () => {
  test('LGTT-KIMI-LGSY: departure on leg 1, destination on leg 2, TMA and FIS by the legs entering them', () => {
    const route = [ad('LGTT'), vfr('LGSY/KIMI'), ad('LGSY')];
    const input = atcInput(route, [4500, 4500], REF, 2);
    const rel = atcLegRelevance(input);
    const list = generateAtcList(input);
    const legsOf = (group: string) => atcEntryLegs(list.find((e) => e.group === group)!, rel);
    expect(legsOf('LGTT DEKELIA / TATOI')).toEqual([0]);
    expect(legsOf('LGSY SKIROS')).toEqual([1]);
    expect(legsOf('ATHINAI TMA')).toContain(0);
    expect(legsOf('FIS')!.length).toBeGreaterThan(0);
    // rows added by hand, and rows the route no longer produces: unknown (every sheet)
    expect(atcEntryLegs({ sourceKey: null }, rel)).toBeNull();
    expect(atcEntryLegs({ sourceKey: 'ad:LGKR:KERKIRA TOWER' }, rel)).toBeNull();
  });
  test('a local flight relates its aerodrome to the first and last legs; a stop to the legs either side', () => {
    const route = [ad('LGTT'), ad('LGMG'), custom('X', 38.3, 23.2), ad('LGTT')];
    const rel = atcLegRelevance(atcInput(route, [3000, 3000, 3000], REF, 2));
    expect(atcEntryLegs({ sourceKey: 'ad:LGTT:TATOI TOWER' }, rel)).toEqual([0, 2]);
    expect(atcEntryLegs({ sourceKey: 'ad:LGMG:MEGARA RADIO' }, rel)).toEqual([0, 1]);
  });
});

describe('regenerate', () => {
  test('keeps rows added by hand; optionally keeps edits of generated rows', () => {
    const gen1 = gen([ad('LGTT'), ad('LGSY')], [4500]);
    const mine: AtcEntry = { id: 'x1', role: 'custom', group: 'Other', callsign: 'OLYMPIC OPS', service: '', primary: '131.500', backups: [], remark: '', sourceKey: null };
    const edited = [{ ...gen1[0], primary: '118.500', backups: [] }, mine];
    expect(regenerateAtcList(null, gen1)).toBe(gen1);
    const fresh = regenerateAtcList(edited, gen1);
    expect(fresh[0].primary).toBe('122.650');
    expect(fresh.at(-1)).toBe(mine);
    expect(fresh).toHaveLength(gen1.length + 1);
    const kept = regenerateAtcList(edited, gen1, true);
    expect(kept[0].primary).toBe('118.500');
    expect(kept.at(-1)).toBe(mine);
  });
});
