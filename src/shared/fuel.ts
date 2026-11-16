// Approved fuels of an aircraft and the fuel on board of a flight by type. Shared by the client
// (hangar, editor, exports), the API (validation, reading old rows) and the tests.
//
// An aircraft lists one or more approved fuels (FuelSpec.types). Densities are not per aircraft:
// the W&B uses the standard density of each type (FUEL_DENSITY), whatever a stored row says. A
// flight gives its fuel on board as a total (FlightDoc.fobL, or the default required + reserve)
// and, when the pilot splits it, as litres per type (FlightOptions.fuelL). Mixed tanks are
// allowed: the fuel mass is Σ litres × density, and the fuel burnt in flight is taken from the mix
// in proportion (one density: the mix's average).
import type { FuelGrade, FuelSpec, FuelType } from './types.js';

export const FUEL_TYPES: FuelType[] = ['AVGAS', 'MOGAS', 'JET A-1'];

/** Standard densities, kg/L (MD 4.3: AVGAS 0.72, MOGAS 0.75; Jet A-1 0.80): the only ones the W&B uses. */
export const FUEL_DENSITY: Record<FuelType, number> = { AVGAS: 0.72, MOGAS: 0.75, 'JET A-1': 0.8 };

const isFuelType = (t: unknown): t is FuelType => typeof t === 'string' && (FUEL_TYPES as string[]).includes(t);
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * A FuelSpec in the current shape. Rows written before migration 014 (and old clients) have a
 * single `type` and `densityKgPerL`; they become one approved fuel.
 */
export function normalizeFuelSpec(f: unknown): FuelSpec {
  if (!f || typeof f !== 'object') return f as FuelSpec;
  if ('types' in f && Array.isArray(f.types)) return f as FuelSpec;
  const { type, densityKgPerL, ...rest } = f as { type?: string; densityKgPerL?: number };
  // an unknown type is passed through as it is, for the API's validation to refuse
  const t = (type ?? 'AVGAS') as FuelType;
  const rho = densityKgPerL !== undefined ? densityKgPerL : isFuelType(t) ? FUEL_DENSITY[t] : undefined;
  return { types: [{ type: t, densityKgPerL: rho }], ...rest } as FuelSpec;
}

/** The aircraft's usual fuel (the first approved one; AVGAS when none is listed), at its standard density. */
export function primaryFuel(spec: Pick<FuelSpec, 'types'>): FuelGrade {
  const type = spec.types?.[0]?.type ?? 'AVGAS';
  return { type, densityKgPerL: fuelDensity(type) };
}

/** The standard density of a fuel type, kg/L. */
export function fuelDensity(type: FuelType): number {
  return FUEL_DENSITY[type] ?? FUEL_DENSITY.AVGAS;
}

/** The approved fuels at their standard densities (a stored density is ignored). */
export function standardFuelTypes(types: readonly FuelGrade[]): FuelGrade[] {
  return types.map((g) => ({ type: g.type, densityKgPerL: fuelDensity(g.type) }));
}

/** 'AVGAS', 'AVGAS or MOGAS', 'AVGAS, MOGAS or JET A-1'. */
export function fuelTypesLabel(spec: Pick<FuelSpec, 'types'>): string {
  const ts = (spec.types ?? []).map((g) => g.type);
  return ts.length <= 1 ? (ts[0] ?? '') : `${ts.slice(0, -1).join(', ')} or ${ts[ts.length - 1]}`;
}

export interface FuelPart {
  type: FuelType;
  litres: number;
  densityKgPerL: number;
  kg: number;
}

export interface FuelLoad {
  /** Litres per type, in the aircraft's order (types the aircraft does not approve last); only types with fuel. */
  parts: FuelPart[];
  totalL: number;
  kg: number;
  /** Average density of the mix, kg/L (the first fuel's density when there is no fuel). */
  densityKgPerL: number;
  /** More than one type on board. */
  mixed: boolean;
  /** Types on board that the aircraft does not list as approved. */
  unapproved: FuelType[];
}

/** Litres per type typed by the pilot; null when not given (or all zero). */
export function fuelByType(
  byType: Partial<Record<FuelType, number>> | null | undefined,
): Partial<Record<FuelType, number>> | null {
  if (!byType) return null;
  const out: Partial<Record<FuelType, number>> = {};
  let any = false;
  for (const t of FUEL_TYPES) {
    const v = byType[t];
    if (fin(v) && v > 0) {
      out[t] = v;
      any = true;
    }
  }
  return any ? out : null;
}

/** Sum of the litres per type (0 when none). */
export function fuelByTypeTotal(byType: Partial<Record<FuelType, number>> | null | undefined): number {
  return FUEL_TYPES.reduce((s, t) => s + (fin(byType?.[t]) ? byType[t] : 0), 0);
}

/**
 * The fuel on board of a flight: `totalL` litres (the planned FOB), split as the pilot gave it per
 * type (scaled to `totalL` if the two disagree), else all of it the aircraft's first fuel.
 */
export function fuelLoad(
  spec: Pick<FuelSpec, 'types'>,
  totalL: number,
  byType?: Partial<Record<FuelType, number>> | null,
): FuelLoad {
  const total = fin(totalL) && totalL > 0 ? totalL : 0;
  const split = fuelByType(byType);
  const order = [
    ...(spec.types ?? []).map((g) => g.type),
    ...FUEL_TYPES.filter((t) => !(spec.types ?? []).some((g) => g.type === t)),
  ];
  let parts: FuelPart[];
  if (split) {
    const sum = fuelByTypeTotal(split);
    const k = sum > 0 && total > 0 ? total / sum : 0;
    parts = order
      .filter((t) => split[t])
      .map((t) => {
        const litres = Math.abs(k - 1) < 1e-9 ? (split[t] as number) : (split[t] as number) * k;
        const densityKgPerL = fuelDensity(t);
        return { type: t, litres, densityKgPerL, kg: litres * densityKgPerL };
      })
      .filter((p) => p.litres > 0);
  } else {
    const g = primaryFuel(spec);
    parts =
      total > 0 ? [{ type: g.type, litres: total, densityKgPerL: g.densityKgPerL, kg: total * g.densityKgPerL }] : [];
  }
  const kg = parts.reduce((s, p) => s + p.kg, 0);
  const litres = parts.reduce((s, p) => s + p.litres, 0);
  return {
    parts,
    totalL: total,
    kg,
    densityKgPerL: litres > 0 ? kg / litres : primaryFuel(spec).densityKgPerL,
    mixed: parts.length > 1,
    unapproved: parts.map((p) => p.type).filter((t) => !(spec.types ?? []).some((g) => g.type === t)),
  };
}
