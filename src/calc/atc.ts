// ATC list generation: input/output types. The generator itself lives in src/data/atc.ts (data
// agent), because it walks the reference data; it must stay pure (no I/O) so it can be unit-tested.
import type { AtcEntry, RoutePoint } from '../shared/types.js';
import type { RefAerodrome, RefAirspace, RefFis } from '../shared/ref.js';

export interface AtcGenLeg {
  from: RoutePoint;
  to: RoutePoint;
  /** Planned altitude, ft (NaN = unknown: airspace is then listed regardless of level). */
  altFt: number;
}

export interface AtcGenInput {
  route: RoutePoint[];
  legs: AtcGenLeg[];
  aerodromes: RefAerodrome[];
  airspaces: RefAirspace[];
  fis: RefFis;
  /** Aerodromes within this distance of a leg are listed (PilotSettings.enrouteAerodromeRadiusNm). */
  enrouteRadiusNm: number;
}

/** Ordered: departure, en-route aerodromes (in route order), destination, airspaces entered, FIS. */
export type AtcGenOutput = AtcEntry[];
