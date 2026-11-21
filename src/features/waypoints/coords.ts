import type { LatLon } from '../../shared';

/**
 * Parses a position typed by the pilot. Accepts:
 *   decimal degrees      '37.9083, 23.7261'  '37.9083 23.7261'  '-12.5 -45.25'
 *   with hemispheres     '37.9083N 23.7261E'  'N37.9083 E23.7261'
 *   degrees/min(/sec)    '37°54.5'N 23°43.6'E'  '37 54 30 N 23 43 34 E'
 *   ICAO compact         '375430N 0234334E'  '3754N 02343E'
 * Returns null when the text is not a position.
 */
export function parseLatLon(text: string): LatLon | null {
  const t = text
    .trim()
    .toUpperCase()
    .replace(/[°º'’′"”″]/g, ' ')
    .replace(/\s+/g, ' ');
  if (!t) return null;

  // ICAO compact: DDMM[SS[.s]]N DDDMM[SS[.s]]E
  const c = /^(\d{4}(?:\d{2}(?:\.\d+)?)?)\s?([NS])[\s,]*(\d{5}(?:\d{2}(?:\.\d+)?)?)\s?([EW])$/.exec(t);
  if (c) {
    const lat = compact(c[1], 2),
      lon = compact(c[3], 3);
    return check(c[2] === 'S' ? -lat : lat, c[4] === 'W' ? -lon : lon);
  }

  // split into two halves: by hemisphere letters, else by comma, else by an even split of numbers
  const hemi = /^([NS])?\s?([\d.\s-]+?)\s?([NS])?[\s,]+([EW])?\s?([\d.\s-]+?)\s?([EW])?$/.exec(t);
  if (hemi && (hemi[1] || hemi[3]) && (hemi[4] || hemi[6])) {
    const lat = dms(hemi[2]),
      lon = dms(hemi[5]);
    if (lat == null || lon == null) return null;
    return check((hemi[1] || hemi[3]) === 'S' ? -lat : lat, (hemi[4] || hemi[6]) === 'W' ? -lon : lon);
  }
  if (/[A-Z]/.test(t)) return null;
  let parts: string[];
  if (t.includes(',')) parts = t.split(',').map((s) => s.trim());
  else {
    const nums = t.split(' ');
    if (nums.length % 2) return null;
    parts = [nums.slice(0, nums.length / 2).join(' '), nums.slice(nums.length / 2).join(' ')];
  }
  if (parts.length !== 2) return null;
  const lat = dms(parts[0]),
    lon = dms(parts[1]);
  if (lat == null || lon == null) return null;
  return check(lat, lon);
}

function compact(s: string, degDigits: number): number {
  const d = +s.slice(0, degDigits),
    m = +s.slice(degDigits, degDigits + 2),
    sec = s.length > degDigits + 2 ? +s.slice(degDigits + 2) : 0;
  return d + m / 60 + sec / 3600;
}

/** 'D', 'D M', 'D M S' (each may be decimal; a leading '-' negates). */
function dms(s: string): number | null {
  const p = s.trim().split(' ').filter(Boolean);
  if (!p.length || p.length > 3 || p.some((x) => !/^-?\d+(\.\d+)?$/.test(x))) return null;
  const neg = p[0].startsWith('-');
  const [d, m = 0, sec = 0] = p.map((x) => Math.abs(+x));
  if (p.length > 1 && (m >= 60 || sec >= 60)) return null;
  const v = d + m / 60 + sec / 3600;
  return neg ? -v : v;
}

function check(lat: number, lon: number): LatLon | null {
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
}

/** 37°54'30"N 023°43'34"E (seconds rounded). */
export function formatDms({ lat, lon }: LatLon): string {
  const f = (v: number, degDigits: number, pos: string, neg: string) => {
    let total = Math.round(Math.abs(v) * 3600);
    const d = Math.floor(total / 3600);
    total -= d * 3600;
    const m = Math.floor(total / 60),
      s = total - m * 60;
    return `${String(d).padStart(degDigits, '0')}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"${v < 0 ? neg : pos}`;
  };
  return `${f(lat, 2, 'N', 'S')} ${f(lon, 3, 'E', 'W')}`;
}

/** ICAO compact form used in flight plans: 375430N0234334E. */
export function formatIcao({ lat, lon }: LatLon): string {
  const f = (v: number, degDigits: number, pos: string, neg: string) => {
    let total = Math.round(Math.abs(v) * 3600);
    const d = Math.floor(total / 3600);
    total -= d * 3600;
    const m = Math.floor(total / 60),
      s = total - m * 60;
    return `${String(d).padStart(degDigits, '0')}${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}${v < 0 ? neg : pos}`;
  };
  return f(lat, 2, 'N', 'S') + f(lon, 3, 'E', 'W');
}

/** Saved waypoint names: upper case letters, digits, space and '-', at most 40 characters. */
export function normaliseWaypointName(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 40);
}
