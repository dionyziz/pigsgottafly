// Where a faxed flight plan goes, by departure aerodrome. AIP Greece GEN 3.1.5.3: from an aerodrome
// without an ATS reporting office the plan is submitted by fax or telephone to the nearest one; in
// practice (AOPA Hellas, 2025) that is Athens Central AIS, fax +30 210 35 32 635, 24 hours. An
// aerodrome with its own ARO that takes plans by fax gets a row here. The plan's DLA and CNL go to
// the number the plan went to (flight_filings.fax_to), not to whatever this table says later.
import type { FaxDestination } from '../../../src/shared/fax.js';

export const ATHENS_AIS: FaxDestination = { number: '+302103532635', unit: 'Athens Central AIS' };

/** Overrides by departure ICAO; every other departure goes to the default unit. */
export const FAX_ROUTES: Record<string, FaxDestination> = {};

/** E.164: '+' and 8–15 digits. */
export const isE164 = (n: string) => /^\+[1-9]\d{7,14}$/.test(n);

/**
 * The unit a plan departing `adep` is faxed to. FAX_AIS_NUMBER replaces the default unit's number
 * (e.g. a test fax machine); `routes` replaces the table (tests).
 */
export function faxDestination(
  adep: string,
  env: NodeJS.ProcessEnv = process.env,
  routes: Record<string, FaxDestination> = FAX_ROUTES,
): FaxDestination {
  const own = routes[adep.toUpperCase()];
  if (own) return own;
  const n = (env.FAX_AIS_NUMBER || '').replace(/[\s()-]/g, '');
  return { ...ATHENS_AIS, number: isE164(n) ? n : ATHENS_AIS.number };
}
