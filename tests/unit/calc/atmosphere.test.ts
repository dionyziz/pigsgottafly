// Pressure altitude, ISA temperature, density altitude: against the ICAO standard atmosphere table
// (pressure ↔ height) and hand-computed values of the MD 4.4 density-altitude rule.
import { expect, test } from 'vitest';
import { pressureAltitudeFt, isaTempC, densityAltitudeFt } from '../../../src/calc';

const M_TO_FT = 1 / 0.3048;

test('pressure altitude follows the ICAO standard atmosphere', () => {
  // ICAO Doc 7488 standard atmosphere: pressure level → geopotential height.
  const table: [number, number][] = [
    [1013.25, 0],
    [1000, 110.9],
    [950, 540.5],
    [900, 988.5],
    [850, 1457.4],
  ];
  for (const [hpa, m] of table) expect(Math.abs(pressureAltitudeFt(0, hpa) - m * M_TO_FT)).toBeLessThan(5); // table heights to ~1 m
  // Elevation adds on; high pressure gives a negative pressure altitude.
  expect(pressureAltitudeFt(861, 1013.25)).toBeCloseTo(861, 9);
  expect(pressureAltitudeFt(861, 1003.25) - 861).toBeGreaterThan(270);
  expect(pressureAltitudeFt(861, 1003.25) - 861).toBeLessThan(278); // ≈ 27.4 ft/hPa near sea level
  expect(pressureAltitudeFt(0, 1030)).toBeLessThan(-450);
});

test('pressure altitude stays within 3.5 % of the club rule (27 ft/hPa from 1013) + 7 ft', () => {
  for (let qnh = 985; qnh <= 1040; qnh += 0.5) {
    const club = 27 * (1013 - qnh);
    expect(Math.abs(pressureAltitudeFt(0, qnh) - club)).toBeLessThanOrEqual(0.035 * Math.abs(club) + 7);
  }
});

test('ISA temperature and density altitude (PA + 120 ft/°C above ISA)', () => {
  expect(isaTempC(0)).toBe(15);
  expect(isaTempC(5000)).toBeCloseTo(5.1, 9);
  expect(densityAltitudeFt(0, 15)).toBeCloseTo(0, 9);
  expect(densityAltitudeFt(0, 25)).toBeCloseTo(1200, 9);
  // PA 2000 ft, ISA 11.04 °C; 30 °C → +18.96 °C → +2275.2 ft
  expect(densityAltitudeFt(2000, 30)).toBeCloseTo(2000 + 120 * 18.96, 6);
  // Cold: below PA.
  expect(densityAltitudeFt(1000, -5)).toBeCloseTo(1000 + 120 * (-5 - 13.02), 6);
});
