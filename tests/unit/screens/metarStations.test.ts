import { describe, expect, test } from 'vitest';

import { REF } from '../../../src/data/ref';
import {
  AREA_RADIUS_NM,
  METAR_LEAD_MS,
  metarBoxShown,
  metarStations,
} from '../../../src/features/editor/panels/metarStations';

const ad = (icao: string) => REF.aerodromes.find((a) => a.icao === icao)!;

describe('METAR box', () => {
  test('the route aerodromes first, then those near it in the order the route passes them', () => {
    const route = [ad('LGTT'), ad('LGSY')];
    const s = metarStations(route, route, REF.aerodromes);
    expect(s.slice(0, 2).map((x) => [x.icao, x.role])).toEqual([
      ['LGTT', 'departure'],
      ['LGSY', 'destination'],
    ]);
    const area = s.slice(2);
    expect(area.every((x) => x.role === 'area' && x.offRouteNm! <= AREA_RADIUS_NM)).toBe(true);
    // LGAV lies by Tatoi, LGSK far off the route
    expect(area.map((x) => x.icao)).toContain('LGAV');
    expect(area.map((x) => x.icao)).not.toContain('LGSK');
    expect(area.map((x) => x.icao)).not.toContain('LGKA');
  });

  test('a stop is listed between the ends; an aerodrome repeated on the route once', () => {
    const route = [ad('LGTT'), ad('LGMG'), ad('LGTT')];
    const s = metarStations(route, route, REF.aerodromes);
    expect(s.filter((x) => x.role !== 'area').map((x) => [x.icao, x.role])).toEqual([
      ['LGTT', 'departure'],
      ['LGMG', 'stop'],
    ]);
  });

  test('shown from 6 h before take-off to 1 h after landing', () => {
    const t = Date.UTC(2026, 10, 17, 9);
    const l = t + 2 * 3600e3;
    expect(metarBoxShown('2026-11-17', t, l, t - METAR_LEAD_MS - 60e3)).toBe(false);
    expect(metarBoxShown('2026-11-17', t, l, t - METAR_LEAD_MS + 60e3)).toBe(true);
    expect(metarBoxShown('2026-11-17', t, l, l + 30 * 60e3)).toBe(true);
    expect(metarBoxShown('2026-11-17', t, l, l + 2 * 3600e3)).toBe(false);
    // no block start: the day decides
    expect(metarBoxShown('2026-11-17', NaN, NaN, t)).toBe(true);
    expect(metarBoxShown('2026-11-20', NaN, NaN, t)).toBe(false);
    expect(metarBoxShown('', NaN, NaN, t)).toBe(false);
  });
});
