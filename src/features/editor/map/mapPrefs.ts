// Map preferences. The layer selection belongs to the flight (FlightOptions.mapLayers; a new flight
// gets the pilot's PilotSettings.mapLayers); only the editing tips are per browser (localStorage).
import { DEFAULT_MAP_LAYERS, type MapLayers, mapLayersOf } from '../../../shared/mapLayers';

const PREFS_KEY = 'pgf:map';

/** `tips` shows the editing hint bubble; closing the bubble turns it off and the layers popover turns it back on. */
export interface MapPrefs {
  tips: boolean;
}

function stored(): Record<string, unknown> | null {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export function loadPrefs(): MapPrefs {
  return { tips: stored()?.tips !== false };
}

export function savePrefs(p: MapPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...(stored() ?? {}), tips: p.tips }));
  } catch {
    /* ignore */
  }
}

/** The layers this browser used before they were kept per flight (null: none stored). */
export function legacyLayers(): MapLayers | null {
  const v = stored();
  if (!v || typeof v.base !== 'string') return null;
  const l = mapLayersOf(v);
  if (!l) return null;
  // the old "Chart layers" switch hid all of our chart layers together
  if (v.chart === false)
    for (const k of [
      'fir',
      'tma',
      'zones',
      'aerodromes',
      'vfrPoints',
      'vfrRoutes',
      'navaids',
      'waypoints',
      'prd',
      'mil',
      'act',
    ] as const)
      l[k] = false;
  return l;
}

/** The flight's layers, else the pilot's choice for new flights, else what this browser used, else all. */
export function flightLayers(flight: unknown, pilot: unknown): MapLayers {
  return mapLayersOf(flight) ?? mapLayersOf(pilot) ?? legacyLayers() ?? { ...DEFAULT_MAP_LAYERS };
}

export type AreaToggle = 'prd' | 'mil' | 'act';
export const areaToggle = (kind: string): AreaToggle => (kind === 'MIL' ? 'mil' : kind === 'ACT' ? 'act' : 'prd');

export const areaShown = (l: MapLayers, kind: string): boolean => l[areaToggle(kind)];

/** Hover and click details follow the layers. */
export function airspaceShown(l: MapLayers, type: string): boolean {
  if (type === 'TMA' || type === 'MTMA') return l.tma;
  if (type === 'CTR' || type === 'ATZ') return l.zones;
  return areaShown(l, type);
}
