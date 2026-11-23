// The fuel on board as the Fuel section types it (FuelSection; the native core's fuelEdit).
import { type FlightDoc, fuelByType, type FuelSpec, type FuelType, primaryFuel } from '../../../shared';

type FuelDoc = Pick<FlightDoc, 'fobL' | 'options'>;

/** The flight with fuel on board `fobL` (null = default) and the split by type (null = all the first fuel). */
export function withFuel<D extends FuelDoc>(
  d: D,
  fobL: number | null,
  byType: Partial<Record<FuelType, number>> | null,
): D {
  return { ...d, fobL, options: { ...d.options, fuelL: byType } };
}

/** The flight after typing `v` litres of fuel `t` (null = cleared) on an aircraft with these fuels. */
export function withTypedFuel<D extends FuelDoc>(
  d: D,
  spec: Pick<FuelSpec, 'types'>,
  t: FuelType,
  v: number | null,
): D {
  const primary = primaryFuel(spec).type;
  const cur = fuelByType(d.options.fuelL) ?? (d.fobL != null ? { [primary]: d.fobL } : {});
  const next: Partial<Record<FuelType, number>> = { ...cur };
  if (v == null) delete next[t];
  else next[t] = v;
  const keys = Object.keys(next) as FuelType[];
  if (!keys.length) return withFuel(d, null, null); // nothing typed: back to the default
  const total = keys.reduce((a, k) => a + (next[k] ?? 0), 0);
  // only the first fuel: a plain total, as for a single-fuel aircraft
  return withFuel(d, total, keys.every((k) => k === primary) ? null : next);
}
