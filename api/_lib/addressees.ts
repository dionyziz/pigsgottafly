// AFTN addressees of a Greek VFR flight plan, from AIP Greece ENR 1.11 (AIRAC AMDT 02/24) §1.11.2:
//   - the ACC the flight is in: ATHINAI (LGGGZFZX, LGGGYXYK) or MAKEDONIA (LGMDZFZX, LGMDYXYK);
//     above FL 195 ZQZX instead of ZFZX (ENR 1.2.5 VFR above FL 195, never for our aircraft);
//   - plus each TMA / MTMA flown into or via (table below; ATHINAI TMA below FL 195: LGATZAZV);
//   - plus, for each CTR or ATZ flown into or via, and for the departure, destination, intermediate
//     and alternate aerodromes: <location indicator>ZTZX and <location indicator>ZPZX.
// The ACC split follows the FIS sector boundary (ENR 2.1.3/2.1.4: ATHINAI INFORMATION south,
// MAKEDONIA INFORMATION north), which is the ACC boundary. The pilot reviews the list before filing.
import { pointSegDistNm, segmentEntersPolygon } from '../../src/calc/nav.js';
import type { Addressee } from '../../src/shared/briefing.js';
import type { RefAerodrome, RefAirspace, RefFis } from '../../src/shared/ref.js';
import type { LatLon, RoutePoint } from '../../src/shared/types.js';

/** ENR 1.11 TMA/MTMA addresses by airspace name (all sectors of one TMA share them for VFR below FL 195). */
export const TMA_ADDRESSES: Record<string, string[]> = {
  'ANDRAVIDA MTMA': ['LGADZAZX'],
  'ATHINAI TMA': ['LGATZAZV', 'LGAVZTZX', 'LGAVZPZX'],
  'IRAKLION TMA': ['LGIRZAZX'],
  'IOANNINA TMA': ['LGIOZAZX'],
  'KERKIRA TMA': ['LGKRZAZX'],
  'KALAMATA MTMA': ['LGKLZAZX'],
  'KOS TMA': ['LGKOZAZX'],
  'MIKONOS TMA': ['LGMKZAZX'],
  'PREVEZA MTMA': ['LGPZZAZX'],
  'RODOS TMA': ['LGRPZAZX'],
  'SAMOS TMA': ['LGSMZAZX'],
  'SANTORINI TMA': ['LGSRZAZX'],
  'SOUDA MTMA': ['LGSAZAZX'],
  'TANAGRA MTMA': ['LGTGZAZX'],
  'ALEXANDROUPOLIS TMA': ['LGALZAZX'],
  'ANCHIALOS MTMA': ['LGBLZAZX'],
  'CHIOS TMA': ['LGHIZAZX'],
  'KAVALA TMA': ['LGKVZAZX'],
  'LARISSA MTMA': ['LGLRZAZX'],
  'LIMNOS TMA': ['LGLMZAZX'],
  'MAKEDONIA TMA': ['LGTSZAZX'],
  'MITILINI TMA': ['LGMTZAZX'],
  'SKIATHOS TMA': ['LGSKZAZX'],
  'SKIROS MTMA': ['LGSYZAZX'],
};
/** ATHINAI TMA between FL 195 and FL 245 (not for VFR in practice). */
const ATHINAI_TMA_HIGH = ['LGATZAZX', 'LGAVZTZX', 'LGAVZPZX'];

export interface AddresseeInput {
  route: RoutePoint[];
  /** Altitude of each leg, ft (route.length − 1 values; NaN = unknown). */
  altitudesFt: number[];
  /** Alternate aerodromes (ICAO). */
  alternates: string[];
  aerodromes: RefAerodrome[];
  airspaces: RefAirspace[];
  fis: RefFis | null;
}

/** "1000 FT AGL" → 0 (surface: conservative for "below"), "FL 155" → 15500, "8500 FT" → 8500, "UNL" → ∞. */
export function levelFt(s: string, kind: 'lower' | 'upper'): number {
  const t = String(s || '')
    .toUpperCase()
    .trim();
  if (!t) return kind === 'lower' ? 0 : Infinity;
  if (t === 'UNL') return Infinity;
  if (t === 'SFC' || t === 'GND' || /AGL|SFC|GND/.test(t)) return kind === 'lower' ? 0 : Infinity;
  let m = /^FL\s*(\d+)/.exec(t);
  if (m) return +m[1] * 100;
  m = /^(\d+)\s*FT/.exec(t);
  if (m) return +m[1];
  return kind === 'lower' ? 0 : Infinity;
}

/** North of the FIS boundary polyline (MAKEDONIA) at this point? Beyond its ends the end segments are extended. */
export function northOfBoundary(p: LatLon, boundary: [number, number][]): boolean {
  if (boundary.length < 2) return false;
  const pts = [...boundary].sort((a, b) => a[1] - b[1]);
  let i = pts.findIndex((q, k) => k + 1 < pts.length && p.lon >= q[1] && p.lon <= pts[k + 1][1]);
  if (i < 0) i = p.lon < pts[0][1] ? 0 : pts.length - 2;
  const [la, lo] = pts[i],
    [lb, lob] = pts[i + 1];
  const latAt = lob === lo ? (la + lb) / 2 : la + ((lb - la) * (p.lon - lo)) / (lob - lo);
  return p.lat > latAt;
}

export function generateAddressees(inp: AddresseeInput): Addressee[] {
  const out = new Map<string, Set<string>>();
  const add = (addrs: string[], reason: string) => {
    for (const a of addrs) {
      if (!/^[A-Z]{8}$/.test(a)) continue;
      if (!out.has(a)) out.set(a, new Set());
      out.get(a)!.add(reason);
    }
  };
  const { route } = inp;
  const maxAlt = Math.max(0, ...inp.altitudesFt.filter(Number.isFinite));
  const high = maxAlt > 19500;

  // ACCs: sample every leg (end points and every ~2 NM)
  if (route.length) {
    let athinai = false,
      makedonia = false;
    const sample = (p: LatLon) => {
      if (inp.fis && northOfBoundary(p, inp.fis.boundary)) makedonia = true;
      else athinai = true;
    };
    sample(route[0]);
    for (let i = 0; i + 1 < route.length; i++) {
      const a = route[i],
        b = route[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.lat - a.lat, b.lon - a.lon) * 30));
      for (let k = 1; k <= n; k++)
        sample({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
    }
    if (athinai) add([high ? 'LGGGZQZX' : 'LGGGZFZX', 'LGGGYXYK'], 'ATHINAI ACC (VFR)');
    if (makedonia) add([high ? 'LGMDZQZX' : 'LGMDZFZX', 'LGMDYXYK'], 'MAKEDONIA ACC (VFR)');
  }

  // TMAs / MTMAs flown into or via (laterally, and vertically when the limits allow a decision)
  for (const sp of inp.airspaces) {
    const addrs = TMA_ADDRESSES[sp.name];
    if (!addrs || sp.polygon.length < 3) continue;
    const lower = levelFt(sp.lower, 'lower'),
      upper = levelFt(sp.upper, 'upper');
    let hit = false;
    for (let i = 0; i + 1 < route.length && !hit; i++) {
      const alt = inp.altitudesFt[i];
      if (Number.isFinite(alt) && (alt < lower || alt > upper)) continue;
      hit = segmentEntersPolygon(route[i], route[i + 1], sp.polygon);
    }
    if (route.length === 1) hit = segmentEntersPolygon(route[0], route[0], sp.polygon);
    if (!hit) continue;
    add(sp.name === 'ATHINAI TMA' && maxAlt > 19500 ? ATHINAI_TMA_HIGH : addrs, sp.name);
  }

  // aerodromes: departure, destination, stops, alternates, and every CTR/ATZ crossed
  const byIcao = new Map(inp.aerodromes.filter((a) => a.icao).map((a) => [a.icao!, a]));
  const adAddrs = (icao: string) => [`${icao}ZTZX`, `${icao}ZPZX`];
  route.forEach((p, i) => {
    if (p.kind !== 'aerodrome') return;
    const ad = inp.aerodromes.find((a) => a.id === p.refId) || (p.name ? byIcao.get(p.name.toUpperCase()) : undefined);
    if (!ad?.icao) return;
    const role = i === 0 ? 'departure' : i === route.length - 1 ? 'destination' : 'intermediate stop';
    add(adAddrs(ad.icao), `${role} ${ad.icao}`);
  });
  for (const alt of inp.alternates) if (/^[A-Z]{4}$/.test(alt)) add(adAddrs(alt), `alternate ${alt}`);
  for (const ad of inp.aerodromes) {
    if (!ad.icao || !ad.zones.length) continue;
    const crossed = ad.zones.some((z) => {
      if (route.length === 1)
        return (
          Math.hypot((route[0].lat - z.lat) * 60, (route[0].lon - z.lon) * 60 * Math.cos((z.lat * Math.PI) / 180)) <=
          z.radiusNm
        );
      for (let i = 0; i + 1 < route.length; i++)
        if (pointSegDistNm({ lat: z.lat, lon: z.lon }, route[i], route[i + 1]).dist <= z.radiusNm) return true;
      return false;
    });
    if (crossed) add(adAddrs(ad.icao), `${ad.icao} CTR/ATZ`);
  }

  return [...out].map(([address, reasons]) => ({ address, reasons: [...reasons] }));
}
