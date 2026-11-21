// ICAO 2012 flight plan (FPL) message builder, ICAO Doc 4444 (PANS-ATM) Appendix 2 and Appendix 3
// (ATS message format), for a VFR general aviation flight, laid out as the pilot's EuroFPL plans.
// Pure: no DOM, no I/O.
//
// What it produces (the reference: the pilot's EuroFPL VFR plan for SX-ASG):
//   (FPL-SXASG-VG
//   -C172/L-SBDFGRY/EB1
//   -LGTT0700
//   -N0100VFR HOLARGOS HELLINIKON
//   -LGTT0100 LGMG
//   -PBN/B2C2D2O2S1 NAV/SBAS OPR/AEROCLUB MESOGEION RMK/GARMIN GNS430W DOF/261116
//   -E/0200 P/002 R/E J/LF A/WHITE WITH BLACKRED STRIPES N/OPR TEL +302108169910 C/ZINDROS D +30 6942462092)
//
// Conventions:
//   - Item 7: the registration without the hyphen (SX-ASV → SXASV), at most 7 characters.
//   - Item 8: V (VFR) and G (general aviation).
//   - Item 9: one aircraft (the number is omitted), ICAO type designator (ZZZZ + TYP/ when the
//     hangar has none), wake turbulence category.
//   - Item 10: 10a/10b from the hangar.
//   - Item 13: departure aerodrome + EOBT = block start time UTC. ZZZZ + DEP/ when the departure is
//     not an aerodrome with an ICAO location indicator.
//   - Item 15: cruising speed N + 4 digits (knots), level VFR, then the route as EuroFPL takes it
//     for Greek VFR flights: the intermediate points by name, space-separated — VFR reporting
//     points and named saved/custom points as their name (one word: spaces and punctuation
//     dropped), aerodromes by ICAO location indicator, and coordinates (3802N02347E, degrees and
//     minutes) only for a point without a usable name (WP1, WP2 … as the map names unnamed
//     points). Consecutive equal elements are written once. No intermediate point: DCT.
//   - Item 16: destination + total EET (HHMM, take-off to landing) + up to two alternates; ZZZZ +
//     DEST/ / ALTN/ for aerodromes without an ICAO indicator.
//   - Item 18 in the Doc 4444 order (STS PBN NAV COM DAT SUR DEP DEST REG EET SEL TYP CODE DLE OPR
//     ORGN PER ALTN RALT TALT RIF RMK) except DOF/, which goes last as EuroFPL writes it (IFPS
//     accepts the indicators in any order). The hangar's item 18 extras are merged in. RMK/ = the
//     touch-and-go / intermediate-stop requests in the club's words, the flight's remarks, the
//     hangar's RMK/. REG/ only on request (App. 2 asks for it only when the registration differs
//     from item 7, which here it never does). EET/ only when FIR boundary estimates are given.
//   - Item 19 (supplementary information) is part of the message, as EuroFPL files it:
//     E/ endurance from the fuel on board at the planning burn (HHMM), P/ persons on board
//     (3 digits), R/ S/ J/ D/ from the hangar's emergency and survival equipment (only what is
//     carried), A/ colours and markings, N/ the aircraft's remarks (e.g. OPR TEL …), C/ the pilot in
//     command as SURNAME INITIAL then the phone with its country code (ZINDROS D +30 6942462092).
//   - Free text (names, remarks, colours) is transliterated from Greek (ELOT 743, digraphs and
//     diphthongs included: see transliterate), upper-cased and reduced to the characters allowed in
//     ATS messages, without the field separators: hyphens, parentheses and oblique strokes become
//     spaces.
//   - Lines are wrapped at 69 characters (AFTN line length); each field starts a new line.
//   - A value that cannot be produced (e.g. no EOBT) is written as ???? and listed in warnings, so
//     the message is visibly incomplete instead of silently wrong. Each warning carries where it is
//     fixed (fixes: the flight editor input, the hangar field, the profile).
import type { Equipment, RoutePointKind, WakeCategory } from '../../../shared';
import type { AircraftFocus, Fix } from '../fix';

export const MISSING = '????';
/** AFTN text line length. */
export const AFTN_LINE = 69;

/** An aerodrome for items 13/16 (icao null → ZZZZ with its name and position in item 18). */
export interface FplAerodrome {
  icao: string | null;
  name: string;
  lat: number;
  lon: number;
}

export interface FplRoutePoint {
  name: string;
  lat: number;
  lon: number;
  kind: RoutePointKind;
  /** Aerodromes: the ICAO location indicator, when it has one. */
  icao?: string | null;
}

export interface FplPerson {
  fullName: string;
  phone: string;
}

export interface FplInput {
  /** Registration as in the hangar, e.g. 'SX-ASV'. */
  registration: string;
  /** Default 'V' / 'G'. */
  flightRules?: 'V';
  flightType?: 'G';
  /** ICAO type designator, '' = none (ZZZZ + TYP/). */
  icaoType: string;
  /** Make and model for TYP/ when the designator is missing. */
  makeModel: string;
  wake: WakeCategory;
  equipment: Equipment;
  /** Operator (OPR/), '' = none. */
  operator: string;
  /** Colours and markings (A/). */
  colours: string;

  /** Flight date 'YYYY-MM-DD' (DOF/). */
  date: string;
  /** EOBT = block start 'HH:MM' UTC; '' = not set. */
  eobt: string;
  departure: FplAerodrome | null;
  destination: FplAerodrome | null;
  alternates: FplAerodrome[];
  /** Every point of the route, endpoints included (the endpoints are left out of item 15). */
  route: FplRoutePoint[];
  /** Cruising speed, kt TAS. */
  cruiseTasKt: number;
  /** Item 15 level; default 'VFR'. */
  level?: string;
  /** Total EET, minutes (take-off → landing); null = unknown. */
  totalEetMin: number | null;
  /** EET/ estimates to FIR boundaries or significant points, minutes from take-off. */
  firEets?: { point: string; elapsedMin: number }[];

  /** Endurance from the fuel on board, minutes; null = unknown. */
  enduranceMin: number | null;
  /** Persons on board (PIC + PAX); null/0 = unknown (TBN). */
  personsOnBoard: number | null;
  pic: FplPerson;
  /**
   * Flight's own remarks (FlightOptions.remarks). Parsed like the hangar's item 18 extras: text
   * after an indicator (STS/, PER/, RMK/ …) goes to that indicator, text without one to RMK/.
   */
  remarks: string;
  /** Touch-and-go / intermediate-stop requests, in the club's words ('REQUEST TOUCH N GO AT LGMG'), first in RMK/. */
  requests?: string[];
}

export interface Item19 {
  endurance: string;
  persons: string;
  radio: { uhf: boolean; vhf: boolean; elt: boolean };
  survival: { present: boolean; polar: boolean; desert: boolean; maritime: boolean; jungle: boolean };
  jackets: { present: boolean; light: boolean; fluorescein: boolean; uhf: boolean; vhf: boolean };
  dinghies: { number: string; capacity: string; covered: boolean; colour: string } | null;
  colours: string;
  remarks: string;
  /** C/: SURNAME INITIAL and the phone ('ZINDROS D +30 6942462092'). */
  pic: string;
  /** The item as written in the message, '' when nothing to write. */
  text: string;
}

export interface FplFields {
  item7: string;
  item8: { rules: string; type: string };
  item9: { number: string; type: string; wake: string };
  item10: { a: string; b: string };
  item13: { adep: string; eobt: string };
  item15: { speed: string; level: string; route: string };
  item16: { ades: string; eet: string; altn1: string; altn2: string };
  /** Item 18 as written ('0' when empty). */
  item18: string;
  item18Parts: { indicator: string; text: string }[];
  item19: Item19;
}

export interface FplResult {
  fields: FplFields;
  /** The message, lines joined with '\n'. */
  message: string;
  lines: string[];
  /** True when nothing is missing (no ???? in the message). */
  complete: boolean;
  warnings: string[];
  /** Where each warning is fixed (by its text); an aircraft fix has no id (the flight's aircraft). */
  fixes: Record<string, Fix>;
}

export { transliterate } from '../../../shared/translit';
import { transliterate } from '../../../shared/translit';

/**
 * Free text for an FPL field: transliterated, upper case, only A-Z 0-9 space and . , ? : ' = +
 * (the ITA-2 set without the field separators - ( ) /), single spaces.
 */
export function cleanText(s: string): string {
  return transliterate(s)
    .replace(/[^A-Z0-9 .,?:'=+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Phone number for a remark: digits only, a leading + becomes 00 ('+30 694 123' → '0030694123'). */
export function cleanPhone(s: string): string {
  const t = (s || '').trim();
  const digits = t.replace(/\D/g, '');
  if (!digits) return '';
  return t.startsWith('+') ? '00' + digits : digits;
}

// Two-digit ITU country codes (the others are 1 digit: 1, 7; or 3 digits).
const CC2 = new Set([
  20, 27, 30, 31, 32, 33, 34, 36, 39, 40, 41, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62,
  63, 64, 65, 66, 81, 82, 84, 86, 90, 91, 92, 93, 94, 95, 98,
]);

/**
 * Phone in international form, the country code apart: '+30 694 246 2092' → '+30 6942462092'.
 * '00…' counts as '+'; a Greek national number (10 digits, 2… or 69…) gets +30. Other numbers
 * without a country code stay as digits. '' when there are no digits.
 */
export function intlPhone(s: string): string {
  const t = (s || '').trim();
  let d = t.replace(/\D/g, '');
  if (!d) return '';
  let intl = t.startsWith('+');
  if (!intl && d.startsWith('00')) {
    intl = true;
    d = d.slice(2);
  }
  if (!intl) return /^(2\d{9}|69\d{8})$/.test(d) ? `+30 ${d}` : d;
  const n = d[0] === '1' || d[0] === '7' ? 1 : CC2.has(+d.slice(0, 2)) ? 2 : 3;
  return d.length > n ? `+${d.slice(0, n)} ${d.slice(n)}` : `+${d}`;
}

/** C/ name: SURNAME and the first initial ('Dionysis Zindros' → 'ZINDROS D'); one word stays as is. */
export function picName(fullName: string): string {
  const w = cleanText(fullName).split(' ').filter(Boolean);
  if (w.length < 2) return w[0] ?? '';
  return `${w[w.length - 1]} ${w[0][0]}`;
}

/** Item 7: registration without hyphen/spaces, upper case. */
export function aircraftId(registration: string): string {
  return transliterate(registration).replace(/[^A-Z0-9]/g, '');
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** HHMM from minutes (rounded to the minute); MISSING for unknown/negative. */
export function hhmm(min: number | null | undefined): string {
  if (typeof min !== 'number' || !isFinite(min) || min < 0) return MISSING;
  const m = Math.round(min);
  if (m >= 100 * 60) return MISSING;
  return pad(Math.floor(m / 60), 2) + pad(m % 60, 2);
}

/** 'HH:MM' → 'HHMM'; MISSING when not a valid clock time. */
export function eobtField(clock: string): string {
  const m = /^(\d{1,2}):?(\d{2})$/.exec((clock || '').trim());
  if (!m) return MISSING;
  const h = +m[1],
    mi = +m[2];
  if (h > 23 || mi > 59) return MISSING;
  return pad(h, 2) + pad(mi, 2);
}

/** DOF/: 'YYYY-MM-DD' → 'YYMMDD'; '' when invalid. */
export function dofField(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return '';
  return m[1].slice(2) + m[2] + m[3];
}

/** Item 15 cruising speed in knots: N + 4 digits (N0092). MISSING when not positive. */
export function speedField(kt: number): string {
  if (!isFinite(kt) || kt <= 0 || kt >= 10000) return 'N' + MISSING;
  return 'N' + pad(Math.round(kt), 4);
}

/**
 * Coordinates as an ICAO significant point, degrees and minutes: 2 digits lat degrees, 2 lat
 * minutes, N/S, 3 lon degrees, 2 lon minutes, E/W (11 characters), e.g. 3802N02347E.
 * Rounded to the nearest minute (a minute carry rolls into the degrees).
 */
export function coordField(lat: number, lon: number): string {
  const part = (v: number, degW: number, pos: string, neg: string) => {
    const total = Math.round(Math.abs(v) * 60);
    return pad(Math.floor(total / 60), degW) + pad(total % 60, 2) + (v < 0 ? neg : pos);
  };
  return part(lat, 2, 'N', 'S') + part(lon, 3, 'E', 'W');
}

const ICAO_RE = /^[A-Z]{4}$/;
/** Location indicator or ZZZZ. */
export function locationField(a: FplAerodrome | null): string {
  if (!a) return MISSING;
  const icao = (a.icao || '').toUpperCase();
  return ICAO_RE.test(icao) ? icao : 'ZZZZ';
}
/** Name and position for DEP/ DEST/ ALTN/ when the indicator is ZZZZ. */
export function zzzzText(a: FplAerodrome): string {
  const name = cleanText(a.name);
  const pos = isFinite(a.lat) && isFinite(a.lon) ? coordField(a.lat, a.lon) : '';
  return [name, pos].filter(Boolean).join(' ');
}

/** Auto names the map gives to points the pilot did not name (WP1, WP2 …). */
const AUTO_NAME = /^WP\d+$/;
const RESERVED = new Set(['DCT', 'VFR', 'IFR', 'OAT', 'GAT', 'T', 'C']);

/**
 * One item 15 route element for a route point: an aerodrome's ICAO indicator, a named point's name
 * as one word (VFR reporting points, saved and named custom points, as EuroFPL accepts them for
 * Greek VFR flights), else coordinates.
 */
export function routeElement(p: FplRoutePoint): string {
  const coord = () => (isFinite(p.lat) && isFinite(p.lon) ? coordField(p.lat, p.lon) : '');
  if (p.kind === 'aerodrome') {
    const icao = (p.icao || '').toUpperCase();
    if (ICAO_RE.test(icao)) return icao;
    return coord();
  }
  const word = cleanText((p.name || '').replace(/\([^)]*\)/g, ' ')).replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z][A-Z0-9]+$/.test(word) && !AUTO_NAME.test(word) && !RESERVED.has(word)) return word;
  return coord();
}

/** Item 15 route after the level: the intermediate points (endpoints excluded), space-separated; DCT when none. */
export function routeField(route: FplRoutePoint[]): string {
  const out: string[] = [];
  for (const p of route.slice(1, -1)) {
    const e = routeElement(p);
    if (e && e !== out[out.length - 1]) out.push(e);
  }
  return out.length ? out.join(' ') : 'DCT';
}

/** Item 18 indicators in the Doc 4444 order, DOF/ moved last as EuroFPL writes it. */
export const ITEM18_ORDER = [
  'STS',
  'PBN',
  'NAV',
  'COM',
  'DAT',
  'SUR',
  'DEP',
  'DEST',
  'REG',
  'EET',
  'SEL',
  'TYP',
  'CODE',
  'DLE',
  'OPR',
  'ORGN',
  'PER',
  'ALTN',
  'RALT',
  'TALT',
  'RIF',
  'RMK',
  'DOF',
] as const;
/** Splits item 18 text into indicator/text pairs ('NAV/GNSS COM/8.33' → [[NAV,GNSS],[COM,8.33]]). */
export function parseItem18(s: string): { indicator: string; text: string }[] {
  const t = transliterate(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t === '0') return [];
  const re = /(?:^|\s)([A-Z]{3,4})\//g;
  const marks: { ind: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) marks.push({ ind: m[1], start: m.index, end: re.lastIndex });
  if (!marks.length) return [{ indicator: 'RMK', text: cleanText(t) }];
  const out: { indicator: string; text: string }[] = [];
  const lead = t.slice(0, marks[0].start).trim();
  if (lead) out.push({ indicator: 'RMK', text: cleanText(lead) });
  marks.forEach((k, i) => {
    const text = t.slice(k.end, i + 1 < marks.length ? marks[i + 1].start : t.length).trim();
    out.push({
      indicator: k.ind,
      text: k.ind === 'DOF' || k.ind === 'EET' ? text.replace(/[^A-Z0-9 ]/g, '') : cleanText(text),
    });
  });
  return out.filter((p) => p.text);
}

/** Item 10a/10b: upper case, letters and digits only. */
const equipField = (s: string) => transliterate(s || '').replace(/[^A-Z0-9]/g, '');

type Warn = (text: string, fix?: Fix) => void;

export function buildItem19(input: FplInput, warn: Warn): Item19 {
  const eq = input.equipment;
  const endurance = hhmm(input.enduranceMin);
  if (endurance === MISSING)
    warn('Endurance unknown (item 19 E/): set the fuel on board and the aircraft burn rate.', {
      kind: 'flight',
      focus: 'fob',
    });
  const pob = input.personsOnBoard;
  const persons = pob && pob > 0 ? pad(Math.min(999, Math.round(pob)), 3) : 'TBN';
  if (persons === 'TBN')
    warn('Persons on board unknown (item 19 P/): the manifest is empty.', { kind: 'flight', focus: 'manifest' });

  const radio = { ...{ uhf: false, vhf: false, elt: false }, ...(eq?.emergencyRadio || {}) };
  const sv = { ...{ polar: false, desert: false, maritime: false, jungle: false }, ...(eq?.survival || {}) };
  const survival = { present: sv.polar || sv.desert || sv.maritime || sv.jungle, ...sv };
  const jackets = {
    ...{ present: false, light: false, fluorescein: false, uhf: false, vhf: false },
    ...(eq?.jackets || {}),
  };
  const d = eq?.dinghies && eq.dinghies.number > 0 ? eq.dinghies : null;
  const dinghies = d
    ? {
        number: pad(Math.min(99, Math.round(d.number)), 2),
        capacity: pad(Math.min(999, Math.round(d.capacity || 0)), 3),
        covered: !!d.covered,
        colour: cleanText(d.colour || ''),
      }
    : null;
  const colours = cleanText(input.colours);
  if (!colours)
    warn('Aircraft colours and markings not set in the hangar (item 19 A/).', { kind: 'aircraft', focus: 'colours' });
  const remarkParts = [cleanText(eq?.remarks || '')].filter(Boolean);
  const name = picName(input.pic.fullName);
  if (!name) warn('Pilot in command name not set in the profile (item 19 C/).', { kind: 'profile', focus: 'fullName' });
  const pic = [name || MISSING, intlPhone(input.pic.phone)].filter(Boolean).join(' ');

  const parts: string[] = [];
  parts.push('E/' + endurance);
  parts.push('P/' + persons);
  const r = (radio.uhf ? 'U' : '') + (radio.vhf ? 'V' : '') + (radio.elt ? 'E' : '');
  if (r) parts.push('R/' + r);
  const s = (sv.polar ? 'P' : '') + (sv.desert ? 'D' : '') + (sv.maritime ? 'M' : '') + (sv.jungle ? 'J' : '');
  if (s) parts.push('S/' + s);
  if (jackets.present) {
    const j =
      (jackets.light ? 'L' : '') +
      (jackets.fluorescein ? 'F' : '') +
      (jackets.uhf ? 'U' : '') +
      (jackets.vhf ? 'V' : '');
    // Doc 4444: J/ is followed by one or more of L F U V. Jackets without any of these are
    // written in N/ instead of an empty J/.
    if (j) parts.push('J/' + j);
    else remarkParts.unshift('LIFE JACKETS');
  }
  if (dinghies)
    parts.push(
      'D/' +
        [dinghies.number, dinghies.capacity, dinghies.covered ? 'C' : '', dinghies.colour].filter(Boolean).join(' '),
    );
  if (colours) parts.push('A/' + colours);
  const remarks = remarkParts.join(' ');
  if (remarks) parts.push('N/' + remarks);
  parts.push('C/' + pic);
  return { endurance, persons, radio, survival, jackets, dinghies, colours, remarks, pic, text: parts.join(' ') };
}

/** Wraps one field at spaces so no line exceeds `width` (a single longer word stays whole). */
export function wrapLine(s: string, width = AFTN_LINE): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function buildFpl(input: FplInput): FplResult {
  const warnings: string[] = [];
  const fixes: Record<string, Fix> = {};
  const warn: Warn = (text, fix) => {
    if (!warnings.includes(text)) warnings.push(text);
    if (fix && !fixes[text]) fixes[text] = fix;
  };
  const ac = (focus: AircraftFocus): Fix => ({ kind: 'aircraft', focus });

  // item 7
  let item7 = aircraftId(input.registration);
  if (!item7) {
    item7 = MISSING;
    warn('Aircraft registration missing (item 7).', { kind: 'flight', focus: 'aircraft' });
  } else if (item7.length > 7)
    warn(`Aircraft identification ${item7} is longer than 7 characters (item 7).`, ac('registration'));

  // item 8
  const item8 = { rules: input.flightRules || 'V', type: input.flightType || 'G' };

  // item 9
  const designator = transliterate(input.icaoType || '').replace(/[^A-Z0-9]/g, '');
  const typeOk = /^[A-Z][A-Z0-9]{1,3}$/.test(designator);
  if (!designator) warn('ICAO type designator not set in the hangar: ZZZZ and TYP/ used (item 9).', ac('icaoType'));
  else if (!typeOk)
    warn(`"${input.icaoType}" is not an ICAO type designator: ZZZZ and TYP/ used (item 9).`, ac('icaoType'));
  const item9 = {
    number: '',
    type: typeOk ? designator : 'ZZZZ',
    wake: ['L', 'M', 'H', 'J'].includes(input.wake) ? input.wake : 'L',
  };
  if (!['L', 'M', 'H', 'J'].includes(input.wake))
    warn('Wake turbulence category not set: L used (item 9).', ac('wake'));

  // item 10
  const eq = input.equipment;
  const a10 = equipField(eq?.item10a || '') || 'N';
  const b10 = equipField(eq?.item10b || '') || 'N';
  if (!equipField(eq?.item10a || ''))
    warn('Item 10a equipment not set in the hangar: N (no equipment) used.', ac('item10a'));
  if (!equipField(eq?.item10b || ''))
    warn('Item 10b surveillance equipment not set in the hangar: N used.', ac('item10b'));
  if (a10.includes('N') && a10.length > 1)
    warn('Item 10a: N (no equipment) cannot be combined with other letters.', ac('item10a'));
  if (b10.includes('N') && b10.length > 1) warn('Item 10b: N cannot be combined with other letters.', ac('item10b'));
  const pbn = equipField(eq?.pbn || '');
  if (a10.includes('R') && !pbn) warn('Item 10a contains R: PBN/ is required in item 18.', ac('pbn'));
  if (pbn && !a10.includes('R')) warn('PBN/ is given but item 10a has no R.', ac('item10a'));

  // item 13
  const adep = locationField(input.departure);
  if (adep === MISSING)
    warn('Departure aerodrome unknown (item 13): the route must start at an aerodrome.', { kind: 'flight' });
  const eobt = eobtField(input.eobt);
  if (eobt === MISSING) warn('Block start time (EOBT) not set (item 13).', { kind: 'flight', focus: 'blockOff' });

  // item 15
  const speed = speedField(input.cruiseTasKt);
  if (speed.includes(MISSING)) warn('Cruising speed not set in the hangar (item 15).', ac('cruiseTasKt'));
  const level = (input.level || 'VFR').toUpperCase();
  const route = routeField(input.route);

  // item 16
  const ades = locationField(input.destination);
  if (ades === MISSING)
    warn('Destination aerodrome unknown (item 16): the route must end at an aerodrome.', { kind: 'flight' });
  const eet = hhmm(input.totalEetMin);
  if (eet === MISSING) warn('Total EET unknown (item 16).', { kind: 'flight' });
  const alts = (input.alternates || []).slice(0, 2);
  if ((input.alternates || []).length > 2)
    warn('Only two alternates fit in item 16; the rest are ignored.', { kind: 'flight', focus: 'alternates' });
  const altn = alts.map(locationField);

  // item 18
  const gen: Record<string, string[]> = {};
  const add = (k: string, v: string) => {
    if (v) (gen[k] ||= []).push(v);
  };
  if (pbn) add('PBN', pbn);
  if (adep === 'ZZZZ' && input.departure) add('DEP', zzzzText(input.departure));
  if (ades === 'ZZZZ' && input.destination) add('DEST', zzzzText(input.destination));
  const dof = dofField(input.date);
  if (dof) add('DOF', dof);
  else warn('Flight date not set (item 18 DOF/).', { kind: 'flight', focus: 'date' });
  // Item 7 is always the registration here, so REG/ would only repeat it (App. 2: 'if different').
  if (input.firEets && input.firEets.length) {
    add(
      'EET',
      input.firEets.map((e) => `${transliterate(e.point).replace(/[^A-Z0-9]/g, '')}${hhmm(e.elapsedMin)}`).join(' '),
    );
  }
  if (!typeOk) add('TYP', cleanText(input.makeModel) || MISSING);
  if (cleanText(input.operator)) add('OPR', cleanText(input.operator));
  const zAlts = alts.filter((_, i) => altn[i] === 'ZZZZ');
  if (zAlts.length) add('ALTN', zAlts.map(zzzzText).join(' '));

  // The flight's remarks, then the hangar's extras: generated indicators win over the same ones
  // typed by hand; RMK/ text is collected and written once, in one RMK/ field.
  const OWN = new Set(['DOF', 'REG', 'DEP', 'DEST', 'ALTN', 'EET']);
  const typed = (src: string, where: string, fix: Fix, rmkOut: string[]) => {
    for (const p of parseItem18(src)) {
      if (OWN.has(p.indicator)) {
        warn(`Item 18 ${p.indicator}/ ${where} is ignored: it is generated from the flight.`, fix);
        continue;
      }
      if (p.indicator === 'PBN' && pbn) continue;
      if (p.indicator === 'TYP' && !typeOk) continue;
      if (p.indicator === 'OPR' && gen.OPR) continue;
      if (p.indicator === 'RMK') {
        rmkOut.push(p.text);
        continue;
      }
      if (gen[p.indicator]?.includes(p.text)) continue;
      add(p.indicator, p.text);
    }
  };
  const flightRmk: string[] = [];
  typed(input.remarks || '', 'in the flight remarks', { kind: 'flight', focus: 'remarks' }, flightRmk);
  const hangarRmk: string[] = [];
  typed(eq?.item18Extras || '', 'from the hangar', ac('item18Extras'), hangarRmk);
  if (a10.includes('Z') && !gen.NAV && !gen.COM && !gen.DAT)
    warn('Item 10a contains Z: NAV/, COM/ or DAT/ is required in item 18.', ac('item18Extras'));

  // RMK: touch-and-go / stop requests, flight remarks, hangar remarks (the route is in item 15)
  const rmk: string[] = [];
  for (const r of input.requests ?? []) {
    const t = cleanText(r);
    if (t && !rmk.includes(t)) rmk.push(t);
  }
  for (const t of [...flightRmk, ...hangarRmk]) if (t && !rmk.includes(t)) rmk.push(t);
  const phone = cleanPhone(input.pic.phone);
  if (!phone) warn('Pilot phone number not set in the profile (item 19 C/).', { kind: 'profile', focus: 'phone' });
  if (rmk.length) add('RMK', rmk.join(' '));

  const order = [...ITEM18_ORDER] as string[];
  const beforeRmk = order.indexOf('RMK') - 0.5; // unknown indicators go just before RMK
  const keys = Object.keys(gen).sort((x, y) => {
    const ix = order.indexOf(x),
      iy = order.indexOf(y);
    const rx = ix < 0 ? beforeRmk : ix,
      ry = iy < 0 ? beforeRmk : iy;
    return rx - ry || x.localeCompare(y);
  });
  const item18Parts = keys.map((k) => ({ indicator: k, text: gen[k].join(' ') }));
  const item18 = item18Parts.length ? item18Parts.map((p) => `${p.indicator}/${p.text}`).join(' ') : '0';

  // item 19
  const item19 = buildItem19(input, warn);

  const fields: FplFields = {
    item7,
    item8,
    item9,
    item10: { a: a10, b: b10 },
    item13: { adep, eobt },
    item15: { speed, level, route },
    item16: { ades, eet, altn1: altn[0] || '', altn2: altn[1] || '' },
    item18,
    item18Parts,
    item19,
  };

  const raw = [
    `(FPL-${item7}-${item8.rules}${item8.type}`,
    `-${item9.number}${item9.type}/${item9.wake}-${a10}/${b10}`,
    `-${adep}${eobt}`,
    `-${speed}${level} ${route}`,
    `-${[ades + eet, ...altn].join(' ')}`,
    `-${item18}`,
  ];
  raw.push(`-${item19.text}`);
  raw[raw.length - 1] += ')';
  const lines = raw.flatMap((l) => wrapLine(l));
  const message = lines.join('\n');
  return { fields, message, lines, complete: !message.includes(MISSING), warnings, fixes };
}

/** The message on one line (some ARO web forms want it so). */
export const oneLine = (r: FplResult) => r.lines.join(' ').replace(/ -/g, '-').replace(/\s+/g, ' ');
