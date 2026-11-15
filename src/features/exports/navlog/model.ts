// The MD 4.2 navigation log ("Flight Planner" sheet) as data: every cell of every sheet as the
// text printed in it. Pure (no I/O, no DOM) so it can be unit-tested; NavlogExport.tsx renders it.
//
// Ported from the v2 sheet (js/app.js calc() "vals" + sheetHtml()):
//   - 9 legs per sheet; longer routes continue on further sheets. A continuation sheet starts at
//     the checkpoint that ended the previous sheet; the totals (whole flight) and the terminal
//     information and notes are repeated on every sheet.
//   - Header TEMP / WIND / SKY / QNH / RUNWAY: the departure on the first sheet, the destination
//     on the last sheet (a single sheet shows the departure, as v2), blank on middle sheets.
//   - BLOCK START is the planned block-off; TAKE-OFF, BLOCK END, ATIS, ETA/ATA, actual GS, fuel
//     remaining, VOR and squawk columns are left blank for the pilot to write in flight.
//   - Wind columns are blank for a leg without a forecast (calm wind was used: see the warnings);
//     a wind typed in the editor (override) is printed.
//   - Rounding is that of the paper sheet (calc/nav.ts computeLeg, summarize).
// Weather sources (winds aloft model run, METAR or forecast at each end) are printed in the notes.
import type { Aircraft, AtcEntry, FlightDoc, PilotSettings, RoutePoint } from '../../../shared';
import { requestTiming } from '../../../shared';
import type { RefAerodrome, RefSunTable, RefVfrPoint, RefVfrRoute } from '../../../shared/ref';
import {
  buildLegs, defaultAltitudes, fmtClock, hazardWhere, fmtHdg, fmtHmm, fmtSigned, isLocalFlight, magneticVariation, navlogAircraft, planFuel,
  computeNavlog, type FuelPlan, type LegGeometry, type NavlogResult,
} from '../../../calc';
import { endpointAerodrome } from '../../../data/atc';
import {
  chooseSurface, sampleSurface, surfaceConditions, windProviderFromLegs, fmtSky,
  type RouteWeather, type SurfaceConditions, type SurfaceSample,
} from '../../../data/weather';
import type { MetarTafResult, ParsedMetar } from '../../../data/weatherMetar';
import type { Hazard } from '../../../calc';

export const LEGS_PER_SHEET = 9;
/** Rows of the terminal information table (at least; more rows shrink to fit the same height). */
export const MIN_TERMINAL_ROWS = 5;
/** Ruled lines in the notes box (165 u / 33 u, as on the v2 sheet). */
export const NOTE_LINES = 5;

// ---------------------------------------------------------------------------------------------
// The computation the sheet is fed by (shared with the tests)

export interface NavlogComputeInput {
  doc: FlightDoc;
  aircraft: Aircraft | null;
  settings: PilotSettings | null;
  weather: RouteWeather | null;
  ref: { aerodromes: RefAerodrome[]; vfrPoints: RefVfrPoint[]; vfrRoutes: RefVfrRoute[]; sunTables: Record<string, RefSunTable> };
}

export interface NavlogComputed {
  legs: LegGeometry[];
  altitudesFt: number[];
  navlog: NavlogResult;
  fuel: FuelPlan | null;
}

/** Legs, effective altitudes, the navlog and the fuel plan of a flight (as the editor computes them). */
export function computeFlightNavlog(input: NavlogComputeInput): NavlogComputed {
  const { doc, aircraft, settings, weather, ref } = input;
  const legs = buildLegs(doc.route, doc.date);
  const altOverrides = legs.map((l) => doc.legOverrides[l.key]?.altFt);
  const timing = requestTiming(doc.route, doc.options);
  const defaults = defaultAltitudes(doc.route, { aerodromes: ref.aerodromes, vfrPoints: ref.vfrPoints, vfrRoutes: ref.vfrRoutes }, altOverrides, timing.patternPoints);
  const altitudesFt = defaults.map((d, i) => (typeof altOverrides[i] === 'number' && isFinite(altOverrides[i]!) ? altOverrides[i]! : d.altFt));
  const ac = aircraft
    ? navlogAircraft(aircraft, doc.options.compassCard)
    : { cruiseTasKt: NaN, patternTasKt: NaN, burnLph: NaN, taxiAllowanceL: 0, card: null };
  const navlog = computeNavlog({
    date: doc.date,
    blockOff: doc.blockOff,
    taxiOutMin: doc.taxiOutMin,
    taxiInMin: doc.taxiInMin,
    legs,
    altitudesFt,
    overrides: legs.map((l) => doc.legOverrides[l.key]),
    aircraft: ac,
    winds: weather && weather.status === 'ok' ? windProviderFromLegs(weather.legs) : null,
    sunTables: ref.sunTables,
    patternLegs: timing.patternLegs,
    groundAfterLegMin: timing.groundAfterLegMin,
  });
  if (!aircraft) navlog.warnings.unshift('No aircraft selected: speeds, fuel and deviation are missing.');
  const fuel = aircraft && legs.length
    ? planFuel({
        tripFuelL: navlog.totals.tripFuel,
        taxiAllowanceL: aircraft.fuel.taxiAllowanceL,
        burnLph: aircraft.fuel.burnLph,
        finalReserveMin: settings?.finalReserveMin ?? 0,
        reserveMin: settings ? settings.reserveMin : null,
        fobL: doc.fobL,
        usableL: aircraft.fuel.usableL,
        tripMin: navlog.flightMin,
        localFlight: isLocalFlight(doc.route),
        stops: timing.groundAfterLegMin.filter((m) => m > 0).length,
      })
    : null;
  return { legs, altitudesFt, navlog, fuel };
}

// ---------------------------------------------------------------------------------------------
// Sheet model

export interface SheetLeg {
  tc: string; alt: string; wd: string; ws: string; temp: string; tas: string; wca: string;
  th: string; var: string; mh: string; dev: string; ch: string;
  dist: string; rem: string; gs: string; ete: string; ate: string; fuel: string;
  /** Altitude unknown (shown highlighted on screen). */
  altMissing: boolean;
  /** No forecast and no typed wind: calm wind was used (wind cells highlighted on screen). */
  windMissing: boolean;
}

export interface SheetHeader {
  date: string;
  aircraft: string;
  blockStart: string;
  sky: string; temp: string; wind: string; qnh: string; runway: string;
  /** 'EST 30lt/h = 0.5lt/min' */
  est: string;
}

export interface TerminalRow { field: string; elev: string; rwy: string; freq: string }

export interface NavlogSheet {
  /** 0-based. */
  index: number;
  count: number;
  header: SheetHeader;
  /** Top checkpoint box: 'DEPARTURE' on the first sheet, '' on continuation sheets. */
  topLabel: string;
  topName: string;
  /** LEGS_PER_SHEET rows; null = unused row. */
  legs: (SheetLeg | null)[];
  /** LEGS_PER_SHEET − 1 checkpoint names between the rows ('' = none). */
  checkpoints: string[];
  bottomLabel: string;
  bottomName: string;
  totals: { dist: string; ete: string; fuel: string; sunset: string };
}

export interface NavlogDocument {
  sheets: NavlogSheet[];
  terminal: TerminalRow[];
  notes: string[];
  /** Everything worth the pilot's attention (shown on screen, not printed). */
  warnings: string[];
  /** Weather sources, one line each (also in the notes). */
  sources: string[];
  /**
   * Weather hazards that did not fit the notes lines, in full, for a printed list after the
   * sheets (null when every hazard is on the sheet).
   */
  hazardPage: { source: string; items: string[] } | null;
}

/** Characters per notes line that still print at a readable size (≈ 10 u, ~6.5 pt). */
export const NOTE_LINE_CHARS = 100;
/** Notes lines the weather hazards may take (the rest keep times, fuel, DEV/VAR). */
export const HAZARD_NOTE_LINES = 3;

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** One hazard in a few words for the ruled notes line: 'L2 BKN 1700 ft, plan 1800 ft, 0800–0900Z'. */
export function compactHazard(h: Hazard, where: string): string {
  let t = h.text.replace(/,\s*\d\d:\d\d\s*[–-]\s*\d\d:\d\dZ\s*$/, '').replace(/,\s*\d\d:\d\dZ\s*$/, '');
  t = t.replace(/\s*\([^)]*\)/g, '').replace(/ · planned /, ', plan ');
  if (h.suggestedMaxAltFt != null) t += `, max ${h.suggestedMaxAltFt} ft`;
  const time = isFinite(h.timeFromMs) && isFinite(h.timeToMs)
    ? (hhmm(h.timeFromMs) === hhmm(h.timeToMs) ? `${hhmm(h.timeFromMs)}Z` : `${hhmm(h.timeFromMs)}–${hhmm(h.timeToMs)}Z`) : '';
  return [where, t].filter(Boolean).join(' ') + (time ? `, ${time}` : '');
}

/**
 * Packs pieces into lines of at most `width` characters, joined with ' · ' (a piece longer than a
 * line gets a line of its own). Returns the lines and how many pieces were placed.
 */
export function packLines(pieces: string[], width: number, maxLines: number): { lines: string[]; placed: number } {
  const lines: string[] = [];
  let cur = '';
  let placed = 0;
  for (const p of pieces) {
    const next = cur ? `${cur} · ${p}` : p;
    if (!cur || next.length <= width) { cur = next; placed++; continue; }
    if (lines.length + 1 >= maxLines) break;
    lines.push(cur);
    cur = p;
    placed++;
  }
  if (cur) lines.push(cur);
  return { lines, placed };
}

export interface EndpointWeather {
  aerodrome: RefAerodrome | null;
  /** The conditions used (METAR when current, else the forecast). */
  conditions: SurfaceConditions | null;
  /** Forecast surface sample (cloud cover for SKY when there is no METAR). */
  sample: SurfaceSample | null;
  metar: ParsedMetar | null;
}

export interface SheetBuildInput {
  doc: FlightDoc;
  aircraft: Aircraft | null;
  computed: NavlogComputed;
  /** The flight's ATC list (doc.atc, or the generated one). */
  atc: AtcEntry[];
  aerodromes: RefAerodrome[];
  weather: RouteWeather | null;
  metar: MetarTafResult | null;
  nowMs: number;
  /**
   * Weather hazards along the route (data/hazardWeather computeRouteHazards); listed in the
   * warnings and summarised on the first note line of the printed sheet. Omitted = not checked.
   */
  hazards?: Hazard[];
  /** Why there are no hazards to show (e.g. 'Weather hazards unavailable: …'), printed as a note. */
  hazardStatus?: string;
}

const two = (t: number | null) => (t === null || !isFinite(t) ? '' : (Math.round(t) < 0 ? 'M' : '') + String(Math.abs(Math.round(t))).padStart(2, '0'));
const num = (x: number | undefined | null) => (typeof x === 'number' && isFinite(x) ? String(x) : '');

export function fmtTempDewC(c: SurfaceConditions | null): string {
  if (!c || c.tempC === null || !isFinite(c.tempC)) return '';
  return `${two(c.tempC)}/${c.dewC !== null && isFinite(c.dewC) ? two(c.dewC) : '//'}`;
}

/** METAR wind group of surface conditions: '23004KT', 'VRB03KT', '27015G25KT', '00000KT'. */
export function fmtSurfaceWind(c: SurfaceConditions | null): string {
  const w = c?.wind;
  if (!w) return '';
  const spd = Math.round(w.speedKt);
  if (spd < 1) return '00000KT';
  const g = w.gustKt !== null && isFinite(w.gustKt) ? `G${String(Math.round(w.gustKt)).padStart(2, '0')}` : '';
  // forecast directions to the nearest 10° as in a METAR; METAR directions as reported
  const dir = w.dirTrueDeg === null ? 'VRB' : String(c!.source === 'forecast' ? (Math.round(w.dirTrueDeg / 10) * 10) % 360 || 360 : Math.round(w.dirTrueDeg)).padStart(3, '0');
  return `${dir}${String(spd).padStart(2, '0')}${g}KT`;
}

/** SKY from a METAR ('CAVOK', 'FEW030 BKN045', 'NSC'), else from the forecast cloud cover. */
export function fmtSkyOf(e: EndpointWeather): string {
  const c = e.conditions;
  if (c && c.source === 'metar' && e.metar) {
    const m = e.metar;
    if (m.cavok) return 'CAVOK';
    if (m.clouds.length) return m.clouds.map((l) => `${l.cover}${l.baseFt === null ? '///' : String(Math.round(l.baseFt / 100)).padStart(3, '0')}${l.type ?? ''}`).join(' ');
    return m.skyClear ?? '';
  }
  return fmtSky(e.sample);
}

/**
 * Runway in use for the surface wind: the most headwind (v2 runwayInUse); parallel runways are
 * listed together ('03L/R'). Uses the AIP runway designators; wind true → magnetic with the WMM
 * variation at the aerodrome. Calm or unknown wind: the first runway.
 */
export function runwayInUse(ad: RefAerodrome | null, c: SurfaceConditions | null, date: string): string {
  if (!ad || !ad.runways.length) return '';
  const ends = ad.runways.flatMap((r) => r.split('/')).map((e) => ({ e: e.trim(), hdg: parseInt(e, 10) * 10 })).filter((x) => x.hdg > 0);
  if (!ends.length) return '';
  let best = ends[0];
  const w = c?.wind;
  if (w && w.dirTrueDeg !== null && w.speedKt >= 1) {
    const variation = magneticVariation(ad.lat, ad.lon, date || new Date().toISOString().slice(0, 10));
    const wMag = w.dirTrueDeg - variation;
    const head = (x: { hdg: number }) => Math.cos(((wMag - x.hdg) * Math.PI) / 180);
    best = ends.reduce((a, b) => (head(b) > head(a) + 1e-9 ? b : a));
  }
  const side = (e: string) => 'LCR'.indexOf(e.replace(/^\d+/, '').charAt(0));
  const par = ends.filter((x) => x.hdg === best.hdg).map((x) => x.e).sort((a, b) => side(a) - side(b));
  return par.length > 1 ? par[0] + '/' + par.slice(1).map((x) => x.replace(/^\d+/, '')).join('/') : best.e;
}

/** Surface weather at a route end for a time (minutes after 00:00 UTC of the flight date). */
export function endpointWeather(
  p: RoutePoint | undefined, loc: RouteWeather['departure'], minutes: number,
  o: { date: string; aerodromes: RefAerodrome[]; weather: RouteWeather | null; metar: MetarTafResult | null; nowMs: number },
): EndpointWeather {
  const ad = p ? endpointAerodrome(p, o.aerodromes) : null;
  const dayMs = Date.parse(o.date + 'T00:00:00Z');
  const timeMs = dayMs + minutes * 60000;
  const label = o.weather?.source?.modelLabel ?? 'Forecast';
  const forecast = isFinite(timeMs) ? surfaceConditions(loc, timeMs, label) : null;
  const sample = loc && loc.hourly && isFinite(timeMs) ? sampleSurface(loc.hourly, timeMs, loc.elevation) : null;
  const metar = ad?.icao ? o.metar?.stations[ad.icao]?.metar ?? null : null;
  const conditions = isFinite(timeMs) ? chooseSurface({ metar, forecast, timeMs, nowMs: o.nowMs }) : null;
  return { aerodrome: ad, conditions, sample, metar };
}

/** Field name as on the v2 sheet: ICAO, else the aerodrome name. */
function adField(a: RefAerodrome): string {
  if (a.icao) return a.icao;
  return a.name.includes('/') ? a.name.split('/').map((s) => s.trim()).join(' / ') : a.name;
}

/** Callsign words a unit label stands for, so 'SKYROS APPROACH' + 'APP' prints once. */
const SERVICE_WORDS: Record<string, string[]> = {
  APP: ['APPROACH'], TWR: ['TOWER'], GND: ['GROUND'], INFO: ['INFORMATION', 'INFO'], FIS: ['INFORMATION', 'INFO'],
  RDR: ['RADAR'], RADAR: ['RADAR'], DEL: ['DELIVERY'], CTR: ['CONTROL'], ACC: ['CONTROL'], ATIS: ['ATIS'],
};

/**
 * Unit label in front of a frequency. Generated rows print their service ('TWR') as the v2 sheet
 * did: the row's field already names the aerodrome or airspace, so the callsign adds nothing.
 * A hand-added row (no sourceKey) has a free heading such as 'Other', so its callsign is printed
 * too, followed by the service unless the callsign already says it ('SKYROS APPROACH', not
 * 'SKYROS APPROACH APP').
 */
function unitLabel(e: AtcEntry): string {
  const callsign = e.callsign.trim();
  const service = e.service.trim();
  if (!callsign) return service;
  if (e.sourceKey !== null && service) return service;
  if (!service) return callsign;
  const last = callsign.toUpperCase().split(/\s+/).pop() ?? '';
  const svc = service.toUpperCase();
  const implied = last === svc || (SERVICE_WORDS[svc] ?? []).includes(last);
  return implied ? callsign : `${callsign} ${service}`;
}

/**
 * Terminal information rows from the flight's ATC list: one row per group (aerodrome, airspace,
 * FIS, hand-added heading), in list order. Aerodrome rows carry elevation and runways from the AIP.
 * Frequencies: 'TWR 118.100 122.500 · GND 121.700' (primary then backups).
 */
export function terminalRows(atc: AtcEntry[], aerodromes: RefAerodrome[]): TerminalRow[] {
  const byKey = new Map<string, RefAerodrome>();
  for (const a of aerodromes) { byKey.set(a.id, a); if (a.icao) byKey.set(a.icao, a); }
  const groups: { group: string; entries: AtcEntry[] }[] = [];
  for (const e of atc) {
    const g = groups.find((x) => x.group === e.group);
    if (g) g.entries.push(e);
    else groups.push({ group: e.group, entries: [e] });
  }
  return groups.map(({ group, entries }) => {
    let ad: RefAerodrome | undefined;
    for (const e of entries) {
      const m = e.sourceKey?.match(/^ad:([^:]+)/);
      if (m && byKey.has(m[1])) { ad = byKey.get(m[1]); break; }
    }
    if (!ad) {
      const first = group.trim().split(/\s+/)[0]?.toUpperCase();
      if (first && /^[A-Z]{4}$/.test(first)) ad = byKey.get(first);
    }
    const freq = entries
      .map((e) => [unitLabel(e), e.primary, ...e.backups].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' · ');
    return {
      field: ad ? adField(ad) : group,
      elev: ad && ad.elevFt !== null && isFinite(ad.elevFt) ? String(ad.elevFt) : '',
      rwy: ad ? ad.runways.map((r) => r.replace('/', ' / ')).join(', ') : '',
      freq,
    };
  });
}

function legRow(nl: NavlogResult['legs'][number]): SheetLeg {
  const windShown = !nl.windMissing && isFinite(nl.windDirDeg) && isFinite(nl.windKt);
  return {
    tc: fmtHdg(nl.tc),
    alt: isFinite(nl.altFt) ? String(nl.altFt) : '',
    wd: windShown ? fmtHdg(nl.windDirDeg) : '',
    ws: windShown ? String(nl.windKt) : '',
    temp: isFinite(nl.tempC) ? String(nl.tempC) : '',
    tas: nl.tasKt > 0 ? String(nl.tasKt) : '',
    wca: nl.wca === undefined ? '' : fmtSigned(nl.wca),
    th: nl.th === undefined ? '' : fmtHdg(nl.th),
    var: nl.var === undefined ? '' : fmtSigned(nl.var),
    mh: nl.mh === undefined ? '' : fmtHdg(nl.mh),
    dev: nl.dev === undefined || !isFinite(nl.dev) ? '' : nl.dev === 0 ? '0' : fmtSigned(nl.dev),
    ch: nl.ch === undefined ? '' : fmtHdg(nl.ch),
    dist: num(nl.dist),
    rem: num(nl.distRem),
    gs: num(nl.gs),
    ete: nl.ete === undefined ? '' : fmtHmm(nl.ete),
    ate: nl.ateRem === undefined ? '' : fmtHmm(nl.ateRem),
    fuel: num(nl.fuel),
    altMissing: !isFinite(nl.altFt),
    windMissing: nl.windMissing,
  };
}

const clockZ = (m: number) => (isFinite(m) ? fmtClock(m) + 'Z' : '');

/** The whole printed document: sheets, terminal information, notes, warnings. */
export function buildNavlogDocument(input: SheetBuildInput): NavlogDocument {
  const { doc, aircraft, computed, weather, metar, nowMs } = input;
  const { navlog, fuel, legs } = computed;
  const route = doc.route;
  const nLegs = legs.length;
  const nSheets = Math.max(1, Math.ceil(nLegs / LEGS_PER_SHEET));
  const t = navlog.times;

  const wxOpts = { date: doc.date, aerodromes: input.aerodromes, weather, metar, nowMs };
  // departure conditions at block-off (v2), destination at landing
  const dep = endpointWeather(route[0], weather?.departure ?? null, t.blockOffMin, wxOpts);
  const arr = endpointWeather(route.length > 1 ? route[route.length - 1] : undefined, weather?.destination ?? null, t.landingMin, wxOpts);
  const pickRunway = (e: EndpointWeather, chosen: string | null) => chosen || runwayInUse(e.aerodrome, e.conditions, doc.date);
  const wxHeader = (e: EndpointWeather, chosen: string | null) => ({
    sky: fmtSkyOf(e),
    temp: fmtTempDewC(e.conditions),
    wind: fmtSurfaceWind(e.conditions),
    qnh: e.conditions?.qnhHpa != null && isFinite(e.conditions.qnhHpa) ? String(Math.round(e.conditions.qnhHpa)) : '',
    runway: pickRunway(e, chosen),
  });
  const blank = { sky: '', temp: '', wind: '', qnh: '', runway: '' };
  const depHdr = nLegs ? wxHeader(dep, doc.options.departureRunway) : blank;
  const arrHdr = nLegs ? wxHeader(arr, doc.options.arrivalRunway) : blank;

  const burn = aircraft?.fuel.burnLph;
  const est = burn && burn > 0 ? `EST ${burn}lt/h = ${+(burn / 60).toFixed(2)}lt/min` : 'EST —lt/h';

  const rows = navlog.legs.map(legRow);
  const totals = {
    dist: nLegs ? String(navlog.totals.dist) : '',
    ete: nLegs ? fmtHmm(navlog.totals.ete) : '',
    fuel: nLegs && burn && burn > 0 ? String(navlog.totals.fuel) : '',
    sunset: navlog.sunsetMin !== null && nLegs ? `SUNSET ${fmtClock(navlog.sunsetMin)}Z` : '',
  };
  const name = (i: number) => (route[i] ? route[i].name : '');

  const sheets: NavlogSheet[] = [];
  for (let s = 0; s < nSheets; s++) {
    const off = s * LEGS_PER_SHEET;
    const last = s === nSheets - 1;
    const sheetLegs: (SheetLeg | null)[] = [];
    const cps: string[] = [];
    for (let j = 0; j < LEGS_PER_SHEET; j++) {
      const i = off + j;
      sheetLegs.push(i < nLegs ? rows[i] : null);
      if (j < LEGS_PER_SHEET - 1) cps.push(i < nLegs ? name(i + 1) : '');
    }
    const hdrWx = s === 0 ? depHdr : last ? arrHdr : blank;
    sheets.push({
      index: s,
      count: nSheets,
      header: {
        date: doc.date || '',
        aircraft: aircraft?.registration ?? '',
        blockStart: navlog.blockOffSet ? clockZ(t.blockOffMin) : '',
        ...hdrWx,
        est,
      },
      topLabel: s === 0 ? 'DEPARTURE' : '',
      topName: s === 0 ? name(0) : name(off),
      legs: sheetLegs,
      checkpoints: cps,
      bottomLabel: last ? 'ARRIVAL' : '',
      bottomName: last ? (route.length > 1 ? name(route.length - 1) : '') : name(off + LEGS_PER_SHEET),
      totals,
    });
  }

  // ---- sources (full, for the screen) and notes (compact, printed on the ruled lines)
  const sources: string[] = [];
  const notes: string[] = [];
  const warnings0: string[] = [];
  let hazardPage: NavlogDocument['hazardPage'] = null;
  if (nLegs) {
    const typed = navlog.legs.filter((l) => l.windSource === 'override').map((l) => l.index + 1);
    const typedText = typed.length ? `wind typed by hand on leg${typed.length > 1 ? 's' : ''} ${typed.join(', ')}` : '';
    const aloft = weather && weather.status === 'ok'
      ? `Open-Meteo ${weather.message}`
      : weather && weather.message ? `${weather.message} (calm wind used)` : 'no forecast (calm wind used)';
    sources.push(`Winds/temp aloft: ${aloft}`);
    if (typedText) sources.push(typedText.charAt(0).toUpperCase() + typedText.slice(1));
    const surf: string[] = [];
    const end = (e: EndpointWeather, what: string, fallback: string) => {
      if (!e.conditions) return;
      const where = e.aerodrome ? adField(e.aerodrome) : fallback;
      const metarUsed = e.conditions.source === 'metar';
      sources.push(`${where} ${what}: ${metarUsed ? e.conditions.label : `${e.conditions.label} (Open-Meteo)`}`);
      surf.push(`${where} ${metarUsed ? e.conditions.label : `forecast ${clockZ((e.conditions.timeMs - Date.parse(doc.date + 'T00:00:00Z')) / 60000)}`}`);
    };
    end(dep, 'departure', route[0]?.name ?? 'DEP');
    if (route.length > 1) end(arr, 'arrival', route[route.length - 1].name);
    if (metar && metar.status === 'error' && metar.message) sources.push(metar.message);

    const on = navlog.blockOffSet;
    // Weather hazards first, one short item each, packed on up to HAZARD_NOTE_LINES lines that
    // print at a readable size; what does not fit is listed in full on a page after the sheets.
    const hz = input.hazards ?? [];
    if (hz.length) {
      const legName = (i: number) => (legs[i] ? `${legs[i].from.name}–${legs[i].to.name}` : '');
      const endName = (e: 'departure' | 'destination') => (e === 'departure' ? dep : arr).aerodrome?.icao ?? '';
      // Most severe first, then in route order (departure, legs, destination).
      const pos = (h: Hazard) => (h.scope.type === 'departure' ? -1 : h.scope.type === 'leg' ? h.scope.legIndex : 1e6);
      const sorted = [...hz].sort((a, b) => (a.level !== b.level ? (a.level === 'danger' ? -1 : 1) : pos(a) - pos(b)));
      const srcs = [...new Set(hz.map((h) => h.source))].join('; ');
      const items = sorted.map((h) => compactHazard(h, h.scope.type === 'leg' ? `L${h.scope.legIndex + 1}` : endName(h.scope.type)));
      const head = `WX ${srcs}:`;
      let packed = packLines([head, ...items], NOTE_LINE_CHARS, HAZARD_NOTE_LINES);
      const full = sorted.map((h) => `${hazardWhere(h, legName, endName)}: ${h.text}`);
      if (packed.placed < items.length + 1) {
        // Leave room on the last line for the pointer to the full list.
        const more = (n: number) => `+${n} more: see the hazard list`;
        let lines = packed.lines;
        let placed = packed.placed - 1;
        while (placed > 0 && (lines[lines.length - 1] + ' · ' + more(items.length - placed)).length > NOTE_LINE_CHARS) {
          placed--;
          lines = packLines([head, ...items.slice(0, placed)], NOTE_LINE_CHARS, HAZARD_NOTE_LINES).lines;
        }
        lines[lines.length - 1] += ` · ${more(items.length - placed)}`;
        notes.push(...lines);
        hazardPage = { source: srcs, items: full };
      } else notes.push(...packed.lines);
      for (const h of sorted) warnings0.push(`${hazardWhere(h, legName, endName)}: ${h.text} (${h.source}).`);
    } else if (input.hazardStatus) notes.push(`WX hazards: ${input.hazardStatus}`);
    notes.push(`Block-off ${on ? clockZ(t.blockOffMin) : '—'} · T/O ${on ? clockZ(t.takeoffMin) : '—'} · LDG ${on ? clockZ(t.landingMin) : '—'} · Block-on ${on ? clockZ(t.blockOnMin) : '—'} · taxi ${doc.taxiOutMin ?? '—'}/${doc.taxiInMin ?? '—'} min`);
    if (fuel) {
      const parts = [`taxi ${fuel.taxiL}`, `trip ${fuel.tripL}`];
      if (fuel.finalReserveL) parts.push(`final reserve ${fuel.finalReserveL}`);
      notes.push(`Fuel: ${parts.join(' + ')} = required ${fuel.requiredL} L · FOB ${fuel.fobL} L${isFinite(fuel.enduranceMin) ? ` (endurance ${fmtHmm(fuel.enduranceMin)})` : ''} · at landing ${fuel.landingFuelL} L`);
    } else if (aircraft) notes.push(`Taxi fuel ${aircraft.fuel.taxiAllowanceL} L`);
    const card = aircraft ? (doc.options.compassCard ? aircraft.compassCards.find((c) => c.name === doc.options.compassCard) : undefined) ?? aircraft.compassCards[0] : undefined;
    let devText = aircraft ? 'DEV: no compass card' : '';
    if (card) {
      const left = doc.date ? Math.round((Date.parse(card.expires) - Date.parse(doc.date)) / 86400000) : NaN;
      devText = isFinite(left) && left < 0 ? `COMPASS CARD EXPIRED ${card.expires}: swing required`
        : isFinite(left) && left <= 90 ? `DEV: ${card.name}, card expires ${card.expires}: swing due`
        : `DEV: ${card.name}, swung ${card.swung}`;
    }
    notes.push([devText, 'VAR: WMM2025 at leg midpoints'].filter(Boolean).join(' · '));
    notes.push(`Winds aloft: ${aloft}${typedText ? ` · ${typedText}` : ''}`);
    if (surf.length) notes.push(`Surface: ${surf.join(' · ')}`);
  }

  const warnings = [...warnings0, ...navlog.warnings, ...(fuel?.warnings ?? [])];
  if (nLegs && weather && weather.status !== 'ok' && weather.message) warnings.push(weather.message);

  return { sheets, terminal: terminalRows(input.atc, input.aerodromes), notes: notes.slice(0, NOTE_LINES), warnings: [...new Set(warnings)], sources, hazardPage };
}
