// NOTAM decoding and relevance to a flight (pure; no I/O).
//
// Relevance (PLAN-v3 "NOTAMs relevant to the flight"): a NOTAM is shown when ALL of
//   - time:     its validity [B, C] overlaps block start − margin … block stop + margin (C = PERM: open);
//   - place:    item A is an aerodrome the flight uses (departure, destination, intermediate stop,
//               alternate), or its area comes within the route corridor: the areas item E
//               describes (src/shared/notamAreas.ts), else the Q-line circle (centre + radius;
//               FIR_WIDE_NM or more = the whole FIR; no coordinates = cannot tell, kept);
//   - vertical: its Q-line lower limit is not above the highest planned altitude, and its upper
//               limit is not BELOW_LEG_FT or more under the nearest leg's planned altitude (unless
//               it is within TERMINAL_NM of an aerodrome of the route: climb-out and approach);
//   - type:     not a checklist (QKKKK), a cancellation, a FIR-wide notice (QAFXX: statements on
//               other NOTAMs, sanctions, entry rules for foreign operators) or an AIP change trigger
//               (QAFTT), and not IFR-only (Q traffic 'I') unless it concerns an aerodrome the flight
//               uses.
// Everything else is returned with relevant = false and the reasons, for "show all".
import { distanceNm, pointSegDistNm } from '../../src/calc/nav.js';
import type { Notam } from '../../src/shared/briefing.js';
import { areasToRoute, FIR_WIDE_NM, parseNotamAreas } from '../../src/shared/notamAreas.js';
import type { LatLon } from '../../src/shared/types.js';
import type { AutorouterNotamRow } from './autorouter.js';

const GARMIN = 90 / 2 ** 30;

// ICAO Doc 8126 NOTAM code, 2nd+3rd letters (subject), most common for VFR in Greece.
export const SUBJECTS: Record<string, string> = {
  AA: 'Minimum altitude',
  AC: 'Control zone (CTR)',
  AD: 'Air defence identification zone',
  AE: 'Control area',
  AF: 'Flight information region',
  AH: 'Upper control area',
  AL: 'Minimum usable flight level',
  AN: 'Area navigation route',
  AO: 'Oceanic control area',
  AP: 'Reporting point',
  AR: 'ATS route',
  AT: 'Terminal control area (TMA)',
  AU: 'Upper flight information region',
  AV: 'Upper advisory area',
  AX: 'Intersection',
  AZ: 'Aerodrome traffic zone (ATZ)',
  CA: 'Air/ground facility',
  CB: 'ADS-B',
  CC: 'ADS-C',
  CD: 'CPDLC',
  CE: 'En-route surveillance radar',
  CG: 'Ground controlled approach system',
  CL: 'SELCAL',
  CM: 'Surface movement radar',
  CP: 'Precision approach radar',
  CR: 'Surveillance radar element of PAR',
  CS: 'Secondary surveillance radar',
  CT: 'Terminal area surveillance radar',
  FA: 'Aerodrome',
  FB: 'Friction measuring device',
  FC: 'Ceiling measurement equipment',
  FD: 'Docking system',
  FE: 'Oxygen',
  FF: 'Fire fighting and rescue',
  FG: 'Ground movement control',
  FH: 'Helicopter alighting area/platform',
  FI: 'Aircraft de-icing',
  FJ: 'Oils',
  FL: 'Landing direction indicator',
  FM: 'Meteorological service',
  FO: 'Fog dispersal system',
  FP: 'Heliport',
  FS: 'Snow removal equipment',
  FT: 'Transmissometer',
  FU: 'Fuel availability',
  FW: 'Wind direction indicator',
  FZ: 'Customs/immigration',
  GA: 'GNSS airfield-specific operations',
  GW: 'GNSS area-wide operations',
  IC: 'ILS',
  ID: 'DME associated with ILS',
  IG: 'Glide path (ILS)',
  II: 'Inner marker (ILS)',
  IL: 'Localizer (ILS)',
  IM: 'Middle marker (ILS)',
  IN: 'Localizer (non-ILS)',
  IO: 'Outer marker (ILS)',
  KK: 'Checklist',
  LA: 'Approach lighting system',
  LB: 'Aerodrome beacon',
  LC: 'Runway centre line lights',
  LD: 'Landing direction indicator lights',
  LE: 'Runway edge lights',
  LF: 'Sequenced flashing lights',
  LG: 'Pilot-controlled lighting',
  LH: 'High intensity runway lights',
  LI: 'Runway end identifier lights',
  LJ: 'Runway alignment indicator lights',
  LK: 'CAT II components of ALS',
  LL: 'Low intensity runway lights',
  LM: 'Medium intensity runway lights',
  LP: 'PAPI',
  LR: 'All landing area lighting facilities',
  LS: 'Stopway lights',
  LT: 'Threshold lights',
  LU: 'Helicopter approach path indicator',
  LV: 'VASIS',
  LW: 'Heliport lighting',
  LX: 'Taxiway centre line lights',
  LY: 'Taxiway edge lights',
  LZ: 'Runway touchdown zone lights',
  MA: 'Movement area',
  MB: 'Bearing strength',
  MC: 'Clearway',
  MD: 'Declared distances',
  MG: 'Taxiing guidance system',
  MH: 'Runway arresting gear',
  MK: 'Parking area',
  MM: 'Daylight markings',
  MN: 'Apron',
  MO: 'Stop bar',
  MP: 'Aircraft stands',
  MR: 'Runway',
  MS: 'Stopway',
  MT: 'Threshold',
  MU: 'Runway turning bay',
  MW: 'Strip/shoulder',
  MX: 'Taxiway(s)',
  MY: 'Rapid exit taxiway',
  NA: 'All radio navigation facilities',
  NB: 'Non-directional radio beacon',
  NC: 'DECCA',
  ND: 'DME',
  NF: 'Fan marker',
  NL: 'Locator',
  NM: 'VOR/DME',
  NN: 'TACAN',
  NO: 'OMEGA',
  NT: 'VORTAC',
  NV: 'VOR',
  NX: 'Direction finding station',
  OA: 'Aeronautical information service',
  OB: 'Obstacle',
  OE: 'Aircraft entry requirements',
  OL: 'Obstacle lights',
  OR: 'Rescue coordination centre',
  PA: 'Standard instrument arrival (STAR)',
  PB: 'Standard VFR arrival',
  PC: 'Contingency procedures',
  PD: 'Standard instrument departure (SID)',
  PE: 'Standard VFR departure',
  PF: 'Flow control procedure',
  PH: 'Holding procedure',
  PI: 'Instrument approach procedure',
  PK: 'VFR approach procedure',
  PL: 'Flight plan processing',
  PM: 'Aerodrome operating minima',
  PN: 'Noise operating restriction',
  PO: 'Obstacle clearance altitude and height',
  PR: 'Radio failure procedures',
  PT: 'Transition altitude or level',
  PU: 'Missed approach procedure',
  PX: 'Minimum holding altitude',
  PZ: 'ADIZ procedure',
  RA: 'Airspace reservation',
  RD: 'Danger area',
  RM: 'Military operating area',
  RO: 'Overflying of',
  RP: 'Prohibited area',
  RR: 'Restricted area',
  RT: 'Temporary restricted area',
  SA: 'ATIS',
  SB: 'ATS reporting office',
  SC: 'Area control centre',
  SE: 'Flight information service',
  SF: 'Aerodrome flight information service',
  SL: 'Flow control centre',
  SO: 'Oceanic area control centre',
  SP: 'Approach control service',
  SS: 'Flight service station',
  ST: 'Aerodrome control tower',
  SU: 'Upper area control centre',
  SV: 'VOLMET broadcast',
  SY: 'Upper advisory service',
  TT: 'MIJI',
  WA: 'Air display',
  WB: 'Aerobatics',
  WC: 'Captive balloon or kite',
  WD: 'Demolition of explosives',
  WE: 'Exercises',
  WF: 'Air refuelling',
  WG: 'Glider flying',
  WH: 'Blasting',
  WJ: 'Banner/target towing',
  WL: 'Ascent of free balloon',
  WM: 'Missile, gun or rocket firing',
  WP: 'Parachute jumping exercise, paragliding or hang gliding',
  WR: 'Radioactive materials or toxic chemicals',
  WS: 'Burning or blowing gas',
  WT: 'Mass movement of aircraft',
  WU: 'Unmanned aircraft',
  WV: 'Formation flight',
  WW: 'Significant volcanic activity',
  WY: 'Aerial survey',
  WZ: 'Model flying',
};

// 4th+5th letters (condition).
export const CONDITIONS: Record<string, string> = {
  AC: 'Withdrawn for maintenance',
  AD: 'Available for daylight operation',
  AF: 'Flight checked and found reliable',
  AG: 'Operating but ground checked only',
  AH: 'Hours of service are now',
  AK: 'Resumed normal operation',
  AL: 'Operative (subject to previously published limitations)',
  AM: 'Military operations only',
  AN: 'Available for night operation',
  AO: 'Operational',
  AP: 'Available, prior permission required',
  AR: 'Available on request',
  AS: 'Unserviceable',
  AU: 'Not available',
  AW: 'Completely withdrawn',
  AX: 'Previously promulgated shutdown cancelled',
  CA: 'Activated',
  CC: 'Completed',
  CD: 'Deactivated',
  CE: 'Erected',
  CF: 'Operating frequency changed to',
  CG: 'Downgraded to',
  CH: 'Changed',
  CI: 'Identification or call sign changed to',
  CL: 'Realigned',
  CM: 'Displaced',
  CN: 'Cancelled',
  CO: 'Operating',
  CP: 'Operating on reduced power',
  CR: 'Temporarily replaced by',
  CS: 'Installed',
  CT: 'On test, do not use',
  HA: 'Braking action is',
  HV: 'Work completed',
  HW: 'Work in progress',
  HX: 'Concentration of birds',
  HY: 'Snow banks exist',
  HZ: 'Covered by frozen ruts and ridges',
  LA: 'Operating on auxiliary power supply',
  LB: 'Reserved for aircraft based therein',
  LC: 'Closed',
  LD: 'Unsafe',
  LE: 'Operating without auxiliary power supply',
  LF: 'Interference from',
  LG: 'Operating without identification',
  LH: 'Unserviceable for aircraft heavier than',
  LI: 'Closed to IFR operations',
  LK: 'Operating as a fixed light',
  LL: 'Usable for length of',
  LN: 'Closed to all night operations',
  LP: 'Prohibited to',
  LR: 'Aircraft restricted to runways and taxiways',
  LS: 'Subject to interruption',
  LT: 'Limited to',
  LV: 'Closed to VFR operations',
  LW: 'Will take place',
  LX: 'Operating but caution advised due to',
  XX: '',
};

const pad = (n: number, w: number) => String(Math.max(0, Math.round(n))).padStart(w, '0');
const key = (series?: string | null, number?: number | null, year?: number | null) =>
  series && Number.isFinite(number) ? `${series}${pad(number!, 4)}/${pad((year ?? 0) % 100, 2)}` : '';

function fmtCoord(lat: number, lon: number): string {
  const dm = (v: number, w: number) => {
    const a = Math.abs(v),
      d = Math.floor(a),
      m = Math.round((a - d) * 60);
    return m === 60 ? pad(d + 1, w) + '00' : pad(d, w) + pad(m, 2);
  };
  return `${dm(lat, 2)}${lat >= 0 ? 'N' : 'S'}${dm(lon, 3)}${lon >= 0 ? 'E' : 'W'}`;
}
const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear() % 100, 2)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}`;
};

/** An autorouter row → Notam (relevance not evaluated yet). Rows without a usable start time are dropped (null). */
export function normalizeNotam(r: AutorouterNotamRow): Notam | null {
  if (!r || typeof r !== 'object') return null;
  const from = Number(r.startvalidity) * 1000;
  if (!Number.isFinite(from)) return null;
  const endRaw = r.endvalidity;
  // autorouter uses 2^32-1 style far-future values for PERM
  const to =
    endRaw === null || endRaw === undefined || !Number.isFinite(Number(endRaw)) || Number(endRaw) >= 2 ** 31 - 1
      ? null
      : Number(endRaw) * 1000;
  const code23 = String(r.code23 || '')
    .toUpperCase()
    .trim();
  const code45 = String(r.code45 || '')
    .toUpperCase()
    .trim();
  const hasPos = Number.isFinite(r.lat) && Number.isFinite(r.lon) && !(r.lat === 0 && r.lon === 0);
  const center = hasPos
    ? { lat: +(Number(r.lat) * GARMIN).toFixed(5), lon: +(Number(r.lon) * GARMIN).toFixed(5) }
    : null;
  const radiusNm = Number.isFinite(r.radius) ? Number(r.radius) : null;
  const lowerFt = (Number.isFinite(r.lower) ? Number(r.lower) : 0) * 100;
  const upperFt = (Number.isFinite(r.upper) ? Number(r.upper) : 999) * 100;
  const type = (['N', 'R', 'C'].includes(String(r.type)) ? r.type : 'N') as Notam['type'];
  const itemA = (Array.isArray(r.itema) ? r.itema : []).map((x) => String(x).toUpperCase().trim()).filter(Boolean);
  const fir = String(r.fir || '')
    .toUpperCase()
    .trim();
  const traffic = String(r.traffic || '').trim();
  const purpose = String(r.purpose || '').trim();
  const scope = String(r.scope || '').trim();
  const k = key(r.series, r.number, r.year) || `#${r.id ?? '?'}`;
  const refers = type === 'N' ? null : key(r.referredseries, r.referrednumber, r.referredyear) || null;
  const qcode = `Q${code23}${code45}`;
  const text = String(r.iteme || '').trim();
  const estimated = !!(r.estimation && String(r.estimation).trim());
  const n: Notam = {
    key: k,
    type,
    refers,
    itemA,
    fir,
    qcode,
    subject: SUBJECTS[code23] ?? null,
    condition: code45 in CONDITIONS ? CONDITIONS[code45] || null : null,
    traffic,
    purpose,
    scope,
    lowerFt,
    upperFt,
    center,
    radiusNm,
    areas: parseNotamAreas(text, { center, radiusNm }),
    from,
    to,
    estimated,
    schedule: r.itemd ? String(r.itemd).trim() || null : null,
    text,
    lowerText: r.itemf ? String(r.itemf).trim() || null : null,
    upperText: r.itemg ? String(r.itemg).trim() || null : null,
    raw: '',
    relevant: false,
    reasons: [],
    legIndex: null,
  };
  const q = `Q) ${fir}/${qcode}/${traffic}/${purpose}/${scope}/${pad(lowerFt / 100, 3)}/${pad(upperFt / 100, 3)}/${center ? fmtCoord(center.lat, center.lon) + pad(radiusNm ?? 999, 3) : ''}`;
  n.raw = [
    `${k} NOTAM${type}${refers ? ' ' + refers : ''}`,
    q,
    `A) ${itemA.join(' ')} B) ${fmtTime(from)} C) ${to === null ? 'PERM' : fmtTime(to) + (estimated ? ' EST' : '')}`,
    n.schedule ? `D) ${n.schedule}` : '',
    `E) ${text}`,
    n.lowerText || n.upperText ? `F) ${n.lowerText ?? ''} G) ${n.upperText ?? ''}`.trim() : '',
  ]
    .filter(Boolean)
    .join('\n');
  return n;
}

export interface RelevanceInput {
  /** Route points in order. */
  route: LatLon[];
  /** Aerodromes the flight uses (departure, destination, stops, alternates): ICAO → role label. */
  aerodromes: Map<string, string>;
  window: { from: number; to: number };
  maxAltFt: number;
  corridorNm: number;
  /** Planned altitude per leg, ft (NaN: unknown); with the route's aerodromes, for areas far below. */
  legAltFt?: number[];
  /** The route's aerodromes (departure, stops, destination). */
  fields?: LatLon[];
}

/** An area this far under the leg's planned altitude is not in the way… */
export const BELOW_LEG_FT = 1000;
/** …unless it is this close to an aerodrome of the route. */
export const TERMINAL_NM = 5;

/** Distance (NM) from a point to the route polyline and the index of the nearest leg. */
export function distanceToRoute(p: LatLon, route: LatLon[]): { dist: number; leg: number | null } {
  if (!route.length) return { dist: Infinity, leg: null };
  if (route.length === 1) return { dist: distanceNm(p, route[0]), leg: null };
  let best = { dist: Infinity, leg: 0 };
  for (let i = 0; i + 1 < route.length; i++) {
    const d = pointSegDistNm(p, route[i], route[i + 1]).dist;
    if (d < best.dist) best = { dist: d, leg: i };
  }
  return best;
}

/** Sets relevant / reasons / legIndex on each NOTAM (in place) and returns them sorted: relevant first. */
export function assessNotams(list: Notam[], inp: RelevanceInput): Notam[] {
  for (const n of list) {
    const hide: string[] = [];
    const show: string[] = [];
    if (n.to !== null && n.to < inp.window.from) hide.push('ends before the flight');
    if (n.from > inp.window.to) hide.push('starts after the flight');
    const used = n.itemA.filter((a) => inp.aerodromes.has(a));
    for (const a of used) show.push(`${inp.aerodromes.get(a)} ${a}`);
    if (!used.length) {
      const areas = n.areas ?? [];
      if (areas.length || (n.center && n.radiusNm !== null && n.radiusNm < FIR_WIDE_NM)) {
        const near = areas.length ? areasToRoute(areas, inp.route) : null;
        const { dist, leg } = near ?? distanceToRoute(n.center!, inp.route);
        const gap = near ? dist : dist - n.radiusNm!;
        n.legIndex = leg;
        const legAlt = leg !== null ? (inp.legAltFt?.[leg] ?? NaN) : NaN;
        const toField = (f: LatLon) =>
          areas.length ? areasToRoute(areas, [f]).dist : distanceNm(n.center!, f) - n.radiusNm!;
        const terminal = (inp.fields ?? []).some((f) => toField(f) <= TERMINAL_NM);
        if (gap > inp.corridorNm) hide.push(`${Math.round(gap)} NM from the route`);
        else if (n.upperFt <= legAlt - BELOW_LEG_FT && !terminal)
          hide.push(`below the planned altitude (up to ${n.upperText ?? `FL${pad(n.upperFt / 100, 3)}`})`);
        else
          show.push(
            gap <= 0
              ? `on the route${leg !== null ? ` (leg ${leg + 1})` : ''}`
              : `${Math.round(gap)} NM from the route${leg !== null ? ` (leg ${leg + 1})` : ''}`,
          );
      } else {
        show.push(n.center ? 'whole FIR' : 'no position given');
      }
    }
    if (n.lowerFt > inp.maxAltFt) hide.push(`above the planned altitudes (from FL${pad(n.lowerFt / 100, 3)})`);
    if (n.qcode.startsWith('QKK')) hide.push('checklist');
    if (n.qcode === 'QAFXX') hide.push('FIR-wide notice');
    if (n.qcode === 'QAFTT') hide.push('AIP change notice');
    if (n.type === 'C') hide.push(`cancels ${n.refers ?? 'a NOTAM'}`);
    if (n.traffic === 'I' && !used.length) hide.push('IFR only');
    n.relevant = hide.length === 0;
    n.reasons = n.relevant ? show : hide;
  }
  const order = (n: Notam) => (n.itemA.find((a) => inp.aerodromes.has(a)) ? 0 : 1);
  return list.sort(
    (a, b) =>
      Number(b.relevant) - Number(a.relevant) ||
      order(a) - order(b) ||
      a.itemA.join().localeCompare(b.itemA.join()) ||
      a.from - b.from,
  );
}
