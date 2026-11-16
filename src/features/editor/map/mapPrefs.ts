// Per-browser map preferences (base map, layers, editing tips), kept in localStorage.
import { BASE_MAPS, type BaseMapId } from './style';

const PREFS_KEY = 'pgf:map';

/** `tips` shows the editing hint bubble; closing the bubble turns it off and the layers popover turns
 *  it back on. */
export interface MapPrefs {
  base: BaseMapId; ofm: boolean; chart: boolean; tips: boolean; notams: boolean;
  /** ENR 5 areas (with the chart layers): prohibited / restricted / danger, military, other activities. */
  prd: boolean; mil: boolean; act: boolean;
}

export const DEFAULT_PREFS: MapPrefs = { base: 'light', ofm: false, chart: true, tips: true, notams: true, prd: true, mil: true, act: true };

export function loadPrefs(): MapPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (v && BASE_MAPS.some((b) => b.id === v.base)) {
      return {
        base: v.base, ofm: !!v.ofm, chart: v.chart !== false, tips: v.tips !== false, notams: v.notams !== false,
        prd: v.prd !== false, mil: v.mil !== false, act: v.act !== false,
      };
    }
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_PREFS };
}

export function savePrefs(p: MapPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** The ENR 5 area kinds and the toggle that shows each. */
export type AreaToggle = 'prd' | 'mil' | 'act';
export const areaToggle = (kind: string): AreaToggle => (kind === 'MIL' ? 'mil' : kind === 'ACT' ? 'act' : 'prd');

/** Which ENR 5 area kinds the layer toggles show. */
export const areaShown = (p: MapPrefs, kind: string): boolean => p[areaToggle(kind)];
