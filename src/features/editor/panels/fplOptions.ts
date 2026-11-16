// Pure helpers for the flight-plan options the pilot types in the editor (FPL item 16 alternates,
// item 18 RMK/). Unit-tested in tests/unit/screens/screens.test.ts.
import { resolveAerodrome } from '../../../data/ref';

/** Item 16 holds at most two alternates. */
export const MAX_ALTERNATES = 2;

/** What an alternate field stores: the ICAO (or AIP id) of a known aerodrome, else the text upper-cased. */
export function alternateCode(text: string): string {
  const a = resolveAerodrome(text);
  return a ? a.icao || a.id : text.trim().toUpperCase();
}

/** FlightOptions.alternates from the alternate fields: empty ones dropped, duplicates removed, at most two. */
export function alternatesFrom(fields: string[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const c = alternateCode(f);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, MAX_ALTERNATES);
}
