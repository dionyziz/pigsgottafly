// ATC list generation: departure, aerodromes near the route, destination, TMAs/MTMAs
// entered at the planned altitude, FIS — as js/app.js terminalRows() did in v2 (legacy copy:
// see ARCHITECTURE.md). Pure; inputs/outputs typed in src/calc/atc.ts.
//
// Rules (ported from v2 terminalRows / aerodromeFreqText, then made per unit):
// - Departure / destination: the aerodrome the first / last route point references (kind
//   'aerodrome'), else the nearest aerodrome within 2 NM of it (v2). A local flight (destination =
//   departure) lists the aerodrome once.
// - En-route aerodromes: every non-water aerodrome with frequencies whose reference point lies
//   within `enrouteRadiusNm` of a leg, or whose aerodrome zone (ATZ/CTR circle) a leg enters,
//   ordered by where along the route they are first passed.
// - Airspace: every TMA/MTMA volume a leg enters (crosses or starts/ends in) whose vertical
//   limits contain the leg's planned altitude ('1000 FT AGL' is taken as 1000 ft MSL: conservative;
//   unknown altitude = listed). Volumes sharing a name form one group, in order of first entry.
// - FIS: ATHINAI INFORMATION south of the ENR 2.1 sector boundary, MAKEDONIA INFORMATION north of
//   it, for each sector a route point lies in, in route order.
// - Frequencies: per unit (callsign), the primary frequency plus one backup (the next primary, else
//   the first secondary; with no primary, the first two secondaries). Units of one aerodrome or
//   airspace with exactly the same frequencies (e.g. TWR and APP at military fields) are merged.
//   An airspace/FIS unit already listed with the same primary frequency is not repeated.
import type { AtcGenInput, AtcGenOutput } from '../calc/index.js';
import { distanceNm, parseLevelFt, pointSegDistNm, segmentEntersPolygon } from '../calc/index.js';
import type { RefAerodrome, RefAirspace, RefFis, RefFrequency } from '../shared/ref.js';
import type { AtcEntry, AtcRole, LatLon, RoutePoint } from '../shared/types.js';

/** Route endpoints farther than this from every aerodrome are not taken as one (v2). */
export const ENDPOINT_AERODROME_NM = 2;

const UNIT_WORDS: Record<string, string> = {
  TOWER: 'TWR',
  GROUND: 'GND',
  DELIVERY: 'DEL',
  APPROACH: 'APP',
  RADAR: 'RDR',
  CONTROL: 'CTL',
  AIRFIELD: 'A/A',
  RADIO: 'RADIO',
};
const UNIT_ORDER = ['ATIS', 'DEL', 'GND', 'TWR', 'INFO', 'AFIS', 'A/A', 'RADIO', 'APP', 'RDR', 'CTL'];

/** Short unit label from the callsign's last word ('TATOI TOWER' → 'TWR'), as on the v2 sheet. */
export function shortUnit(callsign: string, service = ''): string {
  const last = callsign.trim().split(/\s+/).pop() ?? '';
  if (last === 'INFORMATION') return service === 'ATIS' ? 'ATIS' : 'INFO';
  return UNIT_WORDS[last] ?? (last || service);
}

function unitRank(label: string): number {
  const first = label.split('/')[0];
  const i = UNIT_ORDER.indexOf(first);
  return i < 0 ? UNIT_ORDER.length : i;
}

/** Primary + one backup from a unit's frequency list (v2 rule). */
function pickFreqs(freqs: { mhz: string; role: string }[]): string[] {
  const prim = freqs.filter((f) => f.role === 'primary').map((f) => f.mhz);
  const back = freqs.filter((f) => f.role !== 'primary').map((f) => f.mhz);
  const use = prim.length ? [...prim, ...back] : back;
  return [...new Set(use)].slice(0, 2);
}

interface Unit {
  callsigns: string[];
  labels: string[];
  freqs: string[];
  remark: string;
}

/** 'SKIROS TOWER' + 'SKIROS APPROACH' → 'SKIROS TOWER / APPROACH'; 'A INFORMATION' + 'B INFORMATION' → 'A / B INFORMATION'. */
function joinCallsigns(cs: string[]): string {
  if (cs.length < 2) return cs[0] ?? '';
  const words = cs.map((c) => c.split(/\s+/));
  const head = words[0].slice(0, -1).join(' ');
  if (head && words.every((w) => w.slice(0, -1).join(' ') === head)) {
    return `${head} ${words.map((w) => w[w.length - 1]).join(' / ')}`;
  }
  const tail = words[0][words[0].length - 1];
  if (words.every((w) => w.length > 1 && w[w.length - 1] === tail)) {
    return `${words.map((w) => w.slice(0, -1).join(' ')).join(' / ')} ${tail}`;
  }
  return cs.join(' / ');
}

/** Merge units whose frequency lists are identical. Keeps the first unit's position. */
function mergeUnits(units: Unit[]): Unit[] {
  const out: Unit[] = [];
  for (const u of units) {
    const m = out.find((o) => o.freqs.length > 0 && o.freqs.join(' ') === u.freqs.join(' '));
    if (m) {
      m.callsigns.push(...u.callsigns);
      m.labels.push(...u.labels.filter((l) => !m.labels.includes(l)));
      if (u.remark && !m.remark.includes(u.remark)) m.remark = m.remark ? `${m.remark}; ${u.remark}` : u.remark;
    } else {
      out.push({ ...u, callsigns: [...u.callsigns], labels: [...u.labels] });
    }
  }
  return out;
}

/** Units of an aerodrome (grouped by callsign, ordered ATIS, DEL, GND, TWR, INFO, …, APP). */
export function aerodromeUnits(a: RefAerodrome): Unit[] {
  const groups = new Map<string, RefFrequency[]>();
  for (const f of a.freqs) {
    const k = f.callsign || f.service;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const units: Unit[] = [...groups.entries()].map(([cs, list]) => ({
    callsigns: [cs],
    labels: [shortUnit(cs, list[0].service)],
    freqs: pickFreqs(list),
    remark: '',
  }));
  units.sort((x, y) => unitRank(x.labels[0]) - unitRank(y.labels[0]));
  return mergeUnits(units);
}

/** Group heading of an aerodrome: 'LGTT DEKELIA / TATOI' (name alone when it has no ICAO). */
export function aerodromeGroup(a: RefAerodrome): string {
  return a.icao ? `${a.icao} ${a.name}` : a.name;
}

function aerodromeKey(a: RefAerodrome): string {
  return a.icao ?? a.id;
}

/** Aerodrome a route endpoint stands for: its reference, else the nearest within 2 NM. */
export function endpointAerodrome(p: RoutePoint, aerodromes: RefAerodrome[]): RefAerodrome | null {
  if (p.kind === 'aerodrome' && p.refId) {
    const k = p.refId.toUpperCase();
    const hit = aerodromes.find((a) => a.id === k) ?? aerodromes.find((a) => a.icao === k);
    if (hit) return hit;
  }
  let best: RefAerodrome | null = null;
  let bd = Infinity;
  for (const a of aerodromes) {
    const d = distanceNm(p, a);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return bd <= ENDPOINT_AERODROME_NM ? best : null;
}

/** 'north' or 'south' of the FIS sector boundary (a polyline running west → east). */
export function fisSide(p: LatLon, boundary: [number, number][]): 'north' | 'south' {
  if (boundary.length < 2) return 'south';
  const pts = [...boundary].sort((a, b) => a[1] - b[1]);
  let i = 0;
  while (i < pts.length - 2 && p.lon > pts[i + 1][1]) i++;
  const [la1, lo1] = pts[i];
  const [la2, lo2] = pts[i + 1];
  // beyond either end the end segment is extended
  const latOnLine = lo2 === lo1 ? la1 : la1 + ((p.lon - lo1) * (la2 - la1)) / (lo2 - lo1);
  return p.lat > latOnLine ? 'north' : 'south';
}

const limitText = (x: string) => x.replace(/ FT AGL$/, "' AGL").replace(/ FT$/, "'");

function entriesOf(role: AtcRole, group: string, keyPrefix: string, units: Unit[], baseRemark: string, listed?: Set<string>): AtcEntry[] {
  return units.map((u) => {
    for (const cs of u.callsigns) listed?.add(`${cs}|${u.freqs[0] ?? ''}`);
    const key = `${keyPrefix}:${u.callsigns.join('+')}`;
    const remark = [baseRemark, u.remark].filter(Boolean).join('; ');
    return {
      id: key,
      role,
      group,
      callsign: joinCallsigns(u.callsigns),
      service: u.labels.join('/'),
      primary: u.freqs[0] ?? '',
      backups: u.freqs.slice(1),
      remark,
      sourceKey: key,
    };
  });
}

function aerodromeEntries(role: AtcRole, a: RefAerodrome, reason: string, listed: Set<string>): AtcEntry[] {
  const units = aerodromeUnits(a);
  const key = `ad:${aerodromeKey(a)}`;
  if (!units.length) {
    return [
      {
        id: key,
        role,
        group: aerodromeGroup(a),
        callsign: aerodromeGroup(a),
        service: '',
        primary: '',
        backups: [],
        remark: [reason, 'No ATS frequency published'].filter(Boolean).join('; '),
        sourceKey: key,
      },
    ];
  }
  return entriesOf(role, aerodromeGroup(a), key, units, reason, listed);
}

/** First position along the route (leg index + fraction) where the aerodrome is passed, or null. */
function enroutePosition(a: RefAerodrome, legs: { from: LatLon; to: LatLon }[], radiusNm: number): number | null {
  let best: number | null = null;
  legs.forEach((L, i) => {
    const d = pointSegDistNm(a, L.from, L.to);
    const zone = a.zones.reduce((m, z) => Math.max(m, z.radiusNm), 0);
    const near = (radiusNm >= 0 && d.dist <= radiusNm) || (zone > 0 && d.dist <= zone);
    if (near && (best === null || i + d.t < best)) best = i + d.t;
  });
  return best;
}

function fisEntries(fis: RefFis, route: RoutePoint[], legs: { from: LatLon; to: LatLon }[], listed: Set<string>): AtcEntry[] {
  const sides: string[] = [];
  // sample along each leg, so a leg crossing the boundary lists both sectors
  const samples: LatLon[] = [];
  if (legs.length) {
    for (const L of legs) {
      for (let k = 0; k <= 8; k++) {
        samples.push({ lat: L.from.lat + ((L.to.lat - L.from.lat) * k) / 8, lon: L.from.lon + ((L.to.lon - L.from.lon) * k) / 8 });
      }
    }
  } else samples.push(...route);
  for (const p of samples) {
    const s = fisSide(p, fis.boundary);
    if (!sides.includes(s)) sides.push(s);
  }
  const units: Unit[] = [];
  for (const s of sides) {
    const u = fis.units.find((x) => x.side === s);
    if (u && !listed.has(`${u.callsign}|${u.freqs[0] ?? ''}`)) units.push({ callsigns: [u.callsign], labels: ['INFO'], freqs: u.freqs.slice(0, 2), remark: `${s === 'north' ? 'North' : 'South'} sector` });
  }
  if (!units.length) return [];
  return entriesOf('fis', 'FIS', 'fis', mergeUnits(units), '', listed);
}

/** The ordered ATC list: departure, en-route aerodromes, destination, airspace entered, FIS. */
export function generateAtcList(input: AtcGenInput): AtcGenOutput {
  const { route, aerodromes, airspaces, fis, enrouteRadiusNm } = input;
  const legs =
    input.legs.length || route.length < 2
      ? input.legs
      : route.slice(1).map((to, i) => ({ from: route[i], to, altFt: NaN }));
  if (route.length < 1) return [];
  const out: AtcEntry[] = [];
  /** 'CALLSIGN|primary' of every unit listed so far (airspace units are not repeated). */
  const listed = new Set<string>();

  const dep = endpointAerodrome(route[0], aerodromes);
  const arr = route.length > 1 ? endpointAerodrome(route[route.length - 1], aerodromes) : null;
  const local = !!dep && !!arr && dep.id === arr.id;

  if (dep) out.push(...aerodromeEntries('departure', dep, local ? 'Departure and destination' : 'Departure', listed));

  // aerodromes passed over / near the route
  if (legs.length) {
    const enr: { a: RefAerodrome; pos: number }[] = [];
    for (const a of aerodromes) {
      if (a.water || !a.freqs.length || a.id === dep?.id || a.id === arr?.id) continue;
      const pos = enroutePosition(a, legs, enrouteRadiusNm);
      if (pos !== null) enr.push({ a, pos });
    }
    enr.sort((x, y) => x.pos - y.pos);
    for (const e of enr) out.push(...aerodromeEntries('enroute', e.a, 'En route', listed));
  }

  if (arr && !local) out.push(...aerodromeEntries('destination', arr, 'Destination', listed));

  // airspace (TMA / MTMA) entered at the planned altitude
  const hits = new Map<string, { first: number; vols: RefAirspace[] }>();
  legs.forEach((L, i) => {
    for (const v of airspaces) {
      const lo = parseLevelFt(v.lower);
      const hi = parseLevelFt(v.upper);
      const alt = L.altFt;
      const altOk = !Number.isFinite(alt) || ((Number.isNaN(lo) || alt >= lo) && (Number.isNaN(hi) || alt <= hi));
      if (!altOk || !segmentEntersPolygon(L.from, L.to, v.polygon)) continue;
      if (!hits.has(v.name)) hits.set(v.name, { first: i, vols: [] });
      const h = hits.get(v.name)!;
      if (!h.vols.includes(v)) h.vols.push(v);
    }
  });
  [...hits.entries()]
    .sort((a, b) => a[1].first - b[1].first)
    .forEach(([name, h]) => {
      const units: Unit[] = [];
      for (const v of h.vols) {
        for (const u of v.units) {
          if (units.some((x) => x.callsigns[0] === u.callsign)) continue;
          const freqs = u.freqs.slice(0, 2);
          if (listed.has(`${u.callsign}|${freqs[0] ?? ''}`)) continue;
          units.push({ callsigns: [u.callsign], labels: [shortUnit(u.callsign)], freqs, remark: u.hours ?? '' });
        }
      }
      if (!units.length) return;
      const limits = [...new Set(h.vols.map((v) => `${limitText(v.lower)}–${limitText(v.upper)}`))].join(', ');
      out.push(...entriesOf('airspace', name, `as:${name}`, mergeUnits(units), limits, listed));
    });

  out.push(...fisEntries(fis, route, legs, listed));
  return out;
}

/**
 * Which legs each generated ATC row relates to, by the row's source (the part of its sourceKey
 * before the callsigns): 'ad:LGTT' (departure: first leg; destination: last leg; an aerodrome
 * passed or used as a stop: the legs passing it, as generateAtcList finds them), 'as:ATHINAI TMA'
 * (the legs entering it at their altitude), 'fis:ATHINAI INFORMATION' (the legs in that sector).
 * Leg indices are 0-based. Used to print on each navlog sheet only the units its legs touch.
 */
export function atcLegRelevance(input: AtcGenInput): Map<string, number[]> {
  const { route, aerodromes, airspaces, fis, enrouteRadiusNm } = input;
  const legs =
    input.legs.length || route.length < 2
      ? input.legs
      : route.slice(1).map((to, i) => ({ from: route[i], to, altFt: NaN }));
  const out = new Map<string, number[]>();
  const add = (k: string, i: number) => {
    const v = out.get(k) ?? [];
    if (!v.includes(i)) v.push(i);
    out.set(k, v);
  };
  if (!legs.length) return out;
  const last = legs.length - 1;
  const dep = route.length ? endpointAerodrome(route[0], aerodromes) : null;
  const arr = route.length > 1 ? endpointAerodrome(route[route.length - 1], aerodromes) : null;
  if (dep) add(`ad:${aerodromeKey(dep)}`, 0);
  if (arr) add(`ad:${aerodromeKey(arr)}`, last);
  for (const a of aerodromes) {
    if (a.water || !a.freqs.length || a.id === dep?.id || a.id === arr?.id) continue;
    const zone = a.zones.reduce((m, z) => Math.max(m, z.radiusNm), 0);
    legs.forEach((L, i) => {
      const d = pointSegDistNm(a, L.from, L.to).dist;
      if ((enrouteRadiusNm >= 0 && d <= enrouteRadiusNm) || (zone > 0 && d <= zone)) add(`ad:${aerodromeKey(a)}`, i);
    });
  }
  legs.forEach((L, i) => {
    for (const v of airspaces) {
      const lo = parseLevelFt(v.lower);
      const hi = parseLevelFt(v.upper);
      const alt = L.altFt;
      const altOk = !Number.isFinite(alt) || ((Number.isNaN(lo) || alt >= lo) && (Number.isNaN(hi) || alt <= hi));
      if (altOk && segmentEntersPolygon(L.from, L.to, v.polygon)) add(`as:${v.name}`, i);
    }
    for (let k = 0; k <= 8; k++) {
      const p = { lat: L.from.lat + ((L.to.lat - L.from.lat) * k) / 8, lon: L.from.lon + ((L.to.lon - L.from.lon) * k) / 8 };
      const u = fis.units.find((x) => x.side === fisSide(p, fis.boundary));
      if (u) add(`fis:${u.callsign}`, i);
    }
  });
  return out;
}

/**
 * The legs an ATC row relates to (see atcLegRelevance), or null when that is not known: a row
 * added by hand (no sourceKey) or one the current route no longer generates. Null rows belong on
 * every navlog sheet.
 */
export function atcEntryLegs(e: Pick<AtcEntry, 'sourceKey'>, relevance: Map<string, number[]>): number[] | null {
  const k = e.sourceKey;
  if (!k) return null;
  let keys: string[];
  const ad = /^ad:([^:]+)/.exec(k);
  if (ad) keys = [`ad:${ad[1]}`];
  else if (k.startsWith('as:')) keys = [k.slice(0, k.lastIndexOf(':') > 2 ? k.lastIndexOf(':') : k.length)];
  else if (k.startsWith('fis:')) keys = k.slice(4).split('+').map((cs) => `fis:${cs}`);
  else return null;
  const found = keys.filter((x) => relevance.has(x));
  if (!found.length) return null;
  return [...new Set(found.flatMap((x) => relevance.get(x)!))].sort((a, b) => a - b);
}

/**
 * Regenerate an edited list: generated rows are replaced by the new generation; rows added by hand
 * (sourceKey null) are kept, at the end, in their order. Generated rows the pilot edited are kept
 * as edited when the generator still produces their sourceKey.
 */
export function regenerateAtcList(edited: AtcEntry[] | null, generated: AtcEntry[], keepEdits = false): AtcEntry[] {
  if (!edited) return generated;
  const custom = edited.filter((e) => e.sourceKey === null);
  if (!keepEdits) return [...generated, ...custom];
  const byKey = new Map(edited.filter((e) => e.sourceKey).map((e) => [e.sourceKey!, e]));
  return [...generated.map((g) => byKey.get(g.sourceKey!) ?? g), ...custom];
}

/** Convenience for the editor: build the generator input from route + effective leg altitudes. */
export function atcInput(
  route: RoutePoint[],
  altitudesFt: number[],
  ref: { aerodromes: RefAerodrome[]; airspaces: RefAirspace[]; fis: RefFis },
  enrouteRadiusNm: number,
): AtcGenInput {
  return {
    route,
    legs: route.slice(1).map((to, i) => ({ from: route[i], to, altFt: altitudesFt[i] ?? NaN })),
    aerodromes: ref.aerodromes,
    airspaces: ref.airspaces,
    fis: ref.fis,
    enrouteRadiusNm,
  };
}

/** Frequencies of an entry as printed: '122.650 / 118.500'. */
export function atcFreqText(e: Pick<AtcEntry, 'primary' | 'backups'>): string {
  return [e.primary, ...e.backups].filter(Boolean).join(' / ');
}
