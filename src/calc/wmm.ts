// Magnetic variation from the World Magnetic Model (WMM2025 coefficients, valid 2025.0–2030.0).
//
// STUB: returns a fixed 5°E (what the paper navlog used for Greece) until the calc agent implements
// the spherical-harmonic synthesis. The signature is final.
import type { IsoDate } from '../shared/types.js';

/** True while magneticVariation() is the fixed-value stub (UI may show a hint). */
export const WMM_IS_STUB = true;

/**
 * Magnetic declination (variation) in degrees, EAST POSITIVE, at a position, altitude and date.
 * magnetic = true − variation (e.g. TC 090°, 5°E → MC 085°).
 *
 * @param lat  geodetic latitude, degrees
 * @param lon  longitude, degrees (east positive)
 * @param date flight date 'YYYY-MM-DD' (decimal year computed from it) or a Date
 * @param altFt altitude above MSL, ft (default 0)
 */
export function magneticVariation(lat: number, lon: number, date: IsoDate | Date, altFt = 0): number {
  void lat; void lon; void date; void altFt;
  return 5;
}

/** Decimal year of a date, e.g. '2026-07-02' → 2026.5. */
export function decimalYear(date: IsoDate | Date): number {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00Z') : date;
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (d.getTime() - start) / (end - start);
}
