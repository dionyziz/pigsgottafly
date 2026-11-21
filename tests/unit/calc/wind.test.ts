// Runway wind components and runway selection from the wind.
import { expect, test } from 'vitest';

import { runwayWind, selectRunway, windComponents } from '../../../src/calc';
import type { RefRunway } from '../../../src/shared';

const rwy = (designator: string, extra: Partial<RefRunway> = {}): RefRunway => ({
  aerodromeId: 'TEST',
  designator,
  reciprocal: '',
  headingMagDeg: parseInt(designator, 10) * 10,
  headingTrueDeg: null,
  lengthM: 1000,
  widthM: 30,
  surface: 'ASPH',
  toraM: 1000,
  todaM: 1000,
  asdaM: 1000,
  ldaM: 1000,
  slopePct: 0,
  thresholdElevFt: null,
  ...extra,
});

test('components: head, tail, cross side, calm', () => {
  // 30° off the nose from the right: head = 20 cos 30°, cross = 20 sin 30°.
  expect(windComponents(30, 60, 20)).toMatchObject({ crossFrom: 'R' });
  expect(windComponents(30, 60, 20).headwindKt).toBeCloseTo(17.3205, 4);
  expect(windComponents(30, 60, 20).crosswindKt).toBeCloseTo(10, 9);
  expect(windComponents(30, 0, 20)).toMatchObject({ crossFrom: 'L' });
  // Across north: RWY 35 with wind 010.
  expect(windComponents(350, 10, 10).headwindKt).toBeCloseTo(10 * Math.cos(Math.PI / 9), 9);
  expect(windComponents(350, 10, 10).crossFrom).toBe('R');
  // Tailwind is negative.
  expect(windComponents(30, 210, 10).headwindKt).toBeCloseTo(-10, 9);
  expect(windComponents(30, 210, 10).crosswindKt).toBeCloseTo(0, 9);
  // Beam wind.
  expect(windComponents(30, 120, 15).headwindKt).toBeCloseTo(0, 9);
  expect(windComponents(30, 120, 15).crosswindKt).toBeCloseTo(15, 9);
  expect(windComponents(30, 60, 0)).toEqual({ headwindKt: 0, crosswindKt: 0, crossFrom: '' });
});

test('true wind is converted to magnetic with the variation (E positive)', () => {
  // Wind 035 true, variation 5° E → 030 magnetic: straight down RWY 03.
  const w = runwayWind(rwy('03'), { dirTrueDeg: 35, speedKt: 12 }, 5);
  expect(w.headwindKt).toBeCloseTo(12, 9);
  expect(w.crosswindKt).toBeCloseTo(0, 9);
});

test('selectRunway: most headwind; ties → longer; calm → preferred or first', () => {
  const runways = [rwy('03', { toraM: 1100, ldaM: 1100 }), rwy('21', { toraM: 1200, ldaM: 1150 })];
  expect(selectRunway(runways, { dirTrueDeg: 200, speedKt: 10 }, 0)!.runway.designator).toBe('21');
  expect(selectRunway(runways, { dirTrueDeg: 20, speedKt: 10 }, 0)!.runway.designator).toBe('03');
  // Variation: 125 true with 5° E = 120 magnetic: exactly across (both 0 head) → tie → longer (21).
  expect(selectRunway(runways, { dirTrueDeg: 125, speedKt: 10 }, 5)!.runway.designator).toBe('21');
  expect(selectRunway(runways, null, 0)!.runway.designator).toBe('03');
  expect(selectRunway(runways, { dirTrueDeg: 0, speedKt: 0 }, 0, '21')!.runway.designator).toBe('21');
  expect(selectRunway([], { dirTrueDeg: 0, speedKt: 10 }, 0)).toBeNull();
  // Two parallel pairs: picks the best direction.
  const lgav = [rwy('03R'), rwy('21L'), rwy('03L'), rwy('21R', { toraM: 4000, ldaM: 4000 })];
  const ch = selectRunway(lgav, { dirTrueDeg: 210, speedKt: 15 }, 0)!;
  expect(ch.runway.designator).toBe('21R');
  expect(ch.wind.headwindKt).toBeCloseTo(15, 9);
});
