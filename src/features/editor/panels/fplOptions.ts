// FPL item 16 alternates and item 18 RMK/ (unit-tested in tests/unit/screens/screens.test.ts).
import type { RefAerodrome } from '../../../shared/ref';

/** Item 16 holds at most two alternates. */
export const MAX_ALTERNATES = 2;

type Resolve = (text: string) => Pick<RefAerodrome, 'id' | 'icao'> | undefined;

/** What an alternate field stores: the ICAO (or AIP id) of a known aerodrome, else the text upper-cased. */
export function alternateCode(text: string, resolve: Resolve): string {
  const a = resolve(text);
  return a ? a.icao || a.id : text.trim().toUpperCase();
}

/** FlightOptions.alternates from the alternate fields: empty ones dropped, duplicates removed, at most two. */
export function alternatesFrom(fields: string[], resolve: Resolve): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const c = alternateCode(f, resolve);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, MAX_ALTERNATES);
}
