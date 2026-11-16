// The route map's layer selection: stored per flight (FlightOptions.mapLayers) and as the pilot's
// choice for new flights (PilotSettings.mapLayers). The route of the flight is always drawn.

export type BaseMapId = 'light' | 'terrain' | 'street';
export const BASE_MAP_IDS: readonly BaseMapId[] = ['light', 'terrain', 'street'];

export interface MapLayers {
  base: BaseMapId;
  /** openflightmaps aero overlay. */
  ofm: boolean;
  /** LGGG FIR boundary and the ATHINAI / MAKEDONIA line. */
  fir: boolean;
  /** TMAs and MTMAs. */
  tma: boolean;
  /** Aerodrome CTRs and ATZs. */
  zones: boolean;
  aerodromes: boolean;
  /** VFR reporting points. */
  vfrPoints: boolean;
  vfrRoutes: boolean;
  /** The pilot's saved waypoints. */
  waypoints: boolean;
  /** ENR 5 areas: prohibited / restricted / danger, military, local flying. */
  prd: boolean;
  mil: boolean;
  act: boolean;
  notams: boolean;
}

export type MapLayerToggle = Exclude<keyof MapLayers, 'base'>;
export const MAP_LAYER_TOGGLES: readonly MapLayerToggle[] = [
  'fir', 'tma', 'zones', 'aerodromes', 'vfrPoints', 'vfrRoutes', 'waypoints', 'prd', 'mil', 'act', 'notams', 'ofm',
];

export const DEFAULT_MAP_LAYERS: MapLayers = {
  base: 'light', ofm: false, fir: true, tma: true, zones: true, aerodromes: true, vfrPoints: true, vfrRoutes: true,
  waypoints: true, prd: true, mil: true, act: true, notams: true,
};

/** A stored layer selection, completed from `base` (unknown keys dropped, wrong types ignored); null when not an object. */
export function mapLayersOf(v: unknown, base: MapLayers = DEFAULT_MAP_LAYERS): MapLayers | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const i = v as Record<string, unknown>;
  const out: MapLayers = { ...base };
  if (typeof i.base === 'string' && (BASE_MAP_IDS as string[]).includes(i.base)) out.base = i.base as BaseMapId;
  for (const k of MAP_LAYER_TOGGLES) if (typeof i[k] === 'boolean') out[k] = i[k] as boolean;
  return out;
}
