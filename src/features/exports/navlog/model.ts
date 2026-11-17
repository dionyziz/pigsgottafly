// The MD 4.2 navigation log ("Flight Planner" sheet) as data: every cell of every sheet as the
// text printed in it. Pure (no I/O, no DOM) so it can be unit-tested; NavlogExport.tsx renders it.
//
// Ported from the v2 sheet (js/app.js calc() "vals" + sheetHtml()):
//   - 9 legs per sheet; longer routes continue on further sheets. A continuation sheet starts at
//     the checkpoint that ended the previous sheet; the totals (whole flight) are repeated on every
//     sheet; the notes box is left blank.
//   - Checkpoint names sit on the line between two legs, the origin on the top line of the first
//     leg and the name after the ninth leg on the line above the totals: all at the same spacing.
//     The destination is printed once, after its leg ('ARRIVAL' marks it when it ends a full sheet).
//   - Terminal information: each sheet lists only the units its legs touch (the aerodromes they
//     start from, end at or pass, the airspace and FIS sectors they enter); rows added by hand,
//     and rows whose legs are not known, go on every sheet.
//   - Header TEMP / WIND / SKY / QNH / RUNWAY: the departure on the first sheet, the destination
//     on the last sheet (a single sheet shows the departure, as v2), blank on middle sheets.
//   - BLOCK START is the planned block start; TAKE-OFF, BLOCK END, ATIS, ETA/ATA, actual GS, fuel
//     remaining, VOR and squawk columns are left blank for the pilot to write in flight.
//   - Wind columns are blank for a leg without a forecast (calm wind was used: see the warnings);
//     a wind typed in the editor (override) is printed.
//   - Rounding is that of the paper sheet (calc/nav.ts computeLeg, summarize).
// Weather sources (winds aloft model run, METAR or forecast at each end) are listed on screen only.
import {
  buildLegs,
  computeNavlog,
  defaultAltitudes,
  fmtAltitude,
  fmtClock,
  fmtHdg,
  fmtSigned,
  type FuelPlan,
  isLocalFlight,
  type LegGeometry,
  magneticVariation,
  navlogAircraft,
  type NavlogResult,
  planFuel,
} from '../../../calc';
import { atcEntryLegs, endpointAerodrome } from '../../../data/atc';
import {
  chooseSurface,
  fmtSky,
  type RouteWeather,
  sampleSurface,
  type SurfaceConditions,
  surfaceConditions,
  type SurfaceSample,
  windProviderFromLegs,
} from '../../../data/weather';
import type { MetarTafResult, ParsedMetar } from '../../../data/weatherMetar';
import type { Aircraft, AtcEntry, FlightDoc, PilotSettings, RoutePoint } from '../../../shared';
import { navlogTiming, requestTiming } from '../../../shared';
import { fmtEte } from '../../../shared/format';
import type { RefAerodrome, RefSunTable, RefVfrPoint, RefVfrRoute } from '../../../shared/ref';

export const LEGS_PER_SHEET = 9;
/** Rows of the terminal information table (at least; more rows shrink to fit the same height). */
export const MIN_TERMINAL_ROWS = 5;
/** Ruled lines in the notes box (165 u / 33 u, as on the v2 sheet), left blank for the pilot. */
export const NOTE_LINES = 5;

// ---------------------------------------------------------------------------------------------
// The computation the sheet is fed by (shared with the tests)

export interface NavlogComputeInput {
  doc: FlightDoc;
  aircraft: Aircraft | null;
  settings: PilotSettings | null;
  weather: RouteWeather | null;
  ref: {
    aerodromes: RefAerodrome[];
    vfrPoints: RefVfrPoint[];
    vfrRoutes: RefVfrRoute[];
    sunTables: Record<string, RefSunTable>;
  };
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
  const defaults = defaultAltitudes(
    doc.route,
    { aerodromes: ref.aerodromes, vfrPoints: ref.vfrPoints, vfrRoutes: ref.vfrRoutes },
    altOverrides,
    timing.patternPoints,
  );
  const altitudesFt = defaults.map((d, i) =>
    typeof altOverrides[i] === 'number' && isFinite(altOverrides[i]) ? altOverrides[i] : d.altFt,
  );
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
    ...navlogTiming(timing),
  });
  if (!aircraft) navlog.warnings.unshift('No aircraft selected: speeds, fuel and deviation are missing.');
  const fuel =
    aircraft && legs.length
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
          stops: timing.stops,
        })
      : null;
  return { legs, altitudesFt, navlog, fuel };
}

// ---------------------------------------------------------------------------------------------
// Sheet model

export interface SheetLeg {
  tc: string;
  alt: string;
  wd: string;
  ws: string;
  temp: string;
  tas: string;
  wca: string;
  th: string;
  var: string;
  mh: string;
  dev: string;
  ch: string;
  dist: string;
  rem: string;
  gs: string;
  ete: string;
  ate: string;
  fuel: string;
  /** Altitude unknown (shown highlighted on screen). */
  altMissing: boolean;
  /** No forecast and no typed wind: calm wind was used (wind cells highlighted on screen). */
  windMissing: boolean;
}

export interface SheetHeader {
  date: string;
  aircraft: string;
  blockStart: string;
  sky: string;
  temp: string;
  wind: string;
  qnh: string;
  runway: string;
  /** 'EST 30lt/h = 0.5lt/min' */
  est: string;
}

/** One radio unit of a terminal row: 'TWR' and its frequencies, primary first. */
export interface TerminalUnit {
  unit: string;
  freqs: string[];
}
export interface TerminalRow {
  field: string;
  elev: string;
  rwy: string;
  units: TerminalUnit[];
}

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
  /** 'ARRIVAL' when the destination ends this sheet's last row. */
  bottomLabel: string;
  /** The checkpoint ending the sheet's last row ('' when that row is unused). */
  bottomName: string;
  /** Terminal information for this sheet's legs. */
  terminal: TerminalRow[];
  totals: { dist: string; ete: string; fuel: string; sunset: string };
}

export interface NavlogDocument {
  sheets: NavlogSheet[];
  /** Terminal information of the whole flight (each sheet has its own subset). */
  terminal: TerminalRow[];
  /** Planning warnings (shown on screen, not printed). */
  warnings: string[];
  /** Weather sources, short pieces (shown on screen on one line). */
  sources: string[];
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
  /** Legs each generated ATC row relates to (data/atc atcLegRelevance); absent = every row on every sheet. */
  atcRelevance?: Map<string, number[]>;
  aerodromes: RefAerodrome[];
  weather: RouteWeather | null;
  metar: MetarTafResult | null;
  nowMs: number;
}

const two = (t: number | null) =>
  t === null || !isFinite(t) ? '' : (Math.round(t) < 0 ? 'M' : '') + String(Math.abs(Math.round(t))).padStart(2, '0');
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
  const dir =
    w.dirTrueDeg === null
      ? 'VRB'
      : String(
          c.source === 'forecast'
            ? (Math.round(w.dirTrueDeg / 10) * 10) % 360 || 360
            : Math.round(w.dirTrueDeg) % 360 || 360,
        ).padStart(3, '0');
  return `${dir}${String(spd).padStart(2, '0')}${g}KT`;
}

/** SKY from a METAR ('CAVOK', 'FEW030 BKN045', 'NSC'), else from the forecast cloud cover. */
export function fmtSkyOf(e: EndpointWeather): string {
  const c = e.conditions;
  if (c && c.source === 'metar' && e.metar) {
    const m = e.metar;
    if (m.cavok) return 'CAVOK';
    if (m.clouds.length)
      return m.clouds
        .map(
          (l) =>
            `${l.cover}${l.baseFt === null ? '///' : String(Math.round(l.baseFt / 100)).padStart(3, '0')}${l.type ?? ''}`,
        )
        .join(' ');
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
  const ends = ad.runways
    .flatMap((r) => r.split('/'))
    .map((e) => ({ e: e.trim(), hdg: parseInt(e, 10) * 10 }))
    .filter((x) => x.hdg > 0);
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
  const par = ends
    .filter((x) => x.hdg === best.hdg)
    .map((x) => x.e)
    .sort((a, b) => side(a) - side(b));
  return par.length > 1
    ? par[0] +
        '/' +
        par
          .slice(1)
          .map((x) => x.replace(/^\d+/, ''))
          .join('/')
    : best.e;
}

/** Surface weather at a route end for a time (minutes after 00:00 UTC of the flight date). */
export function endpointWeather(
  p: RoutePoint | undefined,
  loc: RouteWeather['departure'],
  minutes: number,
  o: {
    date: string;
    aerodromes: RefAerodrome[];
    weather: RouteWeather | null;
    metar: MetarTafResult | null;
    nowMs: number;
  },
): EndpointWeather {
  const ad = p ? endpointAerodrome(p, o.aerodromes) : null;
  const dayMs = Date.parse(o.date + 'T00:00:00Z');
  const timeMs = dayMs + minutes * 60000;
  const forecast = isFinite(timeMs) ? surfaceConditions(loc, timeMs) : null;
  const sample = loc && loc.hourly && isFinite(timeMs) ? sampleSurface(loc.hourly, timeMs, loc.elevation) : null;
  const metar = ad?.icao ? (o.metar?.stations[ad.icao]?.metar ?? null) : null;
  const conditions = isFinite(timeMs) ? chooseSurface({ metar, forecast, timeMs, nowMs: o.nowMs }) : null;
  return { aerodrome: ad, conditions, sample, metar };
}

/** Field name as on the v2 sheet: ICAO, else the aerodrome name. */
function adField(a: RefAerodrome): string {
  if (a.icao) return a.icao;
  return a.name.includes('/')
    ? a.name
        .split('/')
        .map((s) => s.trim())
        .join(' / ')
    : a.name;
}

/** Callsign words a unit label stands for, so 'SKYROS APPROACH' + 'APP' prints once. */
const SERVICE_WORDS: Record<string, string[]> = {
  APP: ['APPROACH'],
  TWR: ['TOWER'],
  GND: ['GROUND'],
  INFO: ['INFORMATION', 'INFO'],
  FIS: ['INFORMATION', 'INFO'],
  RDR: ['RADAR'],
  RADAR: ['RADAR'],
  DEL: ['DELIVERY'],
  CTR: ['CONTROL'],
  ACC: ['CONTROL'],
  ATIS: ['ATIS'],
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
 * Frequencies: one unit per line, { unit: 'TWR', freqs: ['118.100', '122.500'] } (primary then backups).
 */
export function terminalRows(atc: AtcEntry[], aerodromes: RefAerodrome[]): TerminalRow[] {
  const byKey = new Map<string, RefAerodrome>();
  for (const a of aerodromes) {
    byKey.set(a.id, a);
    if (a.icao) byKey.set(a.icao, a);
  }
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
      if (m && byKey.has(m[1])) {
        ad = byKey.get(m[1]);
        break;
      }
    }
    if (!ad) {
      const first = group.trim().split(/\s+/)[0]?.toUpperCase();
      if (first && /^[A-Z]{4}$/.test(first)) ad = byKey.get(first);
    }
    const units = entries
      .map((e) => ({ unit: unitLabel(e), freqs: [e.primary, ...e.backups].map((f) => f.trim()).filter(Boolean) }))
      .filter((u) => u.unit || u.freqs.length);
    return {
      field: ad ? adField(ad) : group,
      elev: ad && ad.elevFt !== null && isFinite(ad.elevFt) ? String(ad.elevFt) : '',
      rwy: ad ? ad.runways.map((r) => r.replace('/', ' / ')).join(', ') : '',
      units,
    };
  });
}

/** The ATC rows for the legs [from, to) of one sheet (all of them when the legs are not known). */
export function sheetAtc(
  atc: AtcEntry[],
  relevance: Map<string, number[]> | undefined,
  from: number,
  to: number,
): AtcEntry[] {
  if (!relevance || to <= from) return atc;
  return atc.filter((e) => {
    const legs = atcEntryLegs(e, relevance);
    return legs === null || legs.some((i) => i >= from && i < to);
  });
}

function legRow(nl: NavlogResult['legs'][number]): SheetLeg {
  const windShown = !nl.windMissing && isFinite(nl.windDirDeg) && isFinite(nl.windKt);
  return {
    tc: fmtHdg(nl.tc),
    alt: isFinite(nl.altFt) ? fmtAltitude(nl.altFt) : '',
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
    ete: nl.ete === undefined ? '' : fmtEte(nl.ete),
    ate: nl.ateRem === undefined ? '' : fmtEte(nl.ateRem),
    fuel: num(nl.fuel),
    altMissing: !isFinite(nl.altFt),
    windMissing: nl.windMissing,
  };
}

const clockZ = (m: number) => (isFinite(m) ? fmtClock(m) + 'Z' : '');

/** The whole printed document (sheets, terminal information) plus on-screen warnings and sources. */
export function buildNavlogDocument(input: SheetBuildInput): NavlogDocument {
  const { doc, aircraft, computed, weather, metar, nowMs } = input;
  const { navlog, fuel, legs } = computed;
  const route = doc.route;
  const nLegs = legs.length;
  const nSheets = Math.max(1, Math.ceil(nLegs / LEGS_PER_SHEET));
  const t = navlog.times;

  const wxOpts = { date: doc.date, aerodromes: input.aerodromes, weather, metar, nowMs };
  // departure conditions at block start (v2), destination at landing
  const dep = endpointWeather(route[0], weather?.departure ?? null, t.blockOffMin, wxOpts);
  const arr = endpointWeather(
    route.length > 1 ? route[route.length - 1] : undefined,
    weather?.destination ?? null,
    t.landingMin,
    wxOpts,
  );
  const pickRunway = (e: EndpointWeather, chosen: string | null) =>
    chosen || runwayInUse(e.aerodrome, e.conditions, doc.date);
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
    ete: nLegs ? fmtEte(navlog.totals.ete) : '',
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
      bottomLabel: last && off + LEGS_PER_SHEET === nLegs ? 'ARRIVAL' : '',
      bottomName: off + LEGS_PER_SHEET <= nLegs ? name(off + LEGS_PER_SHEET) : '',
      terminal: terminalRows(
        sheetAtc(input.atc, input.atcRelevance, off, Math.min(nLegs, off + LEGS_PER_SHEET)),
        input.aerodromes,
      ),
      totals,
    });
  }

  // ---- weather sources: one short piece each, shown on screen above the sheet (not printed)
  const sources: string[] = [];
  if (nLegs) {
    // the model is named on the About page only: 'run 2026-11-15 12Z, fetched 08:00Z'
    const model = weather?.source?.modelLabel;
    const detail =
      weather && model && weather.message.startsWith(model + ', ')
        ? weather.message.slice(model.length + 2)
        : weather?.message;
    sources.push(weather && weather.status === 'ok' ? `Winds aloft: ${detail}` : 'Winds aloft: none, calm wind used');
    const typed = navlog.legs.filter((l) => l.windSource === 'override').map((l) => l.index + 1);
    if (typed.length) sources.push(`wind typed on leg${typed.length > 1 ? 's' : ''} ${typed.join(', ')}`);
    const dayMs = Date.parse(doc.date + 'T00:00:00Z');
    const end = (e: EndpointWeather, fallback: string) => {
      if (!e.conditions) return;
      const where = e.aerodrome ? adField(e.aerodrome) : fallback;
      sources.push(
        e.conditions.source === 'metar'
          ? e.conditions.label
          : `${where} forecast ${clockZ((e.conditions.timeMs - dayMs) / 60000)}`,
      );
    };
    end(dep, route[0]?.name ?? 'DEP');
    if (route.length > 1) end(arr, route[route.length - 1].name);
  }

  // Weather (METAR/TAF, hazards, missing forecasts) is the editor's business: planning warnings only.
  const warnings = [...navlog.warnings, ...(fuel?.warnings ?? [])].filter((w) => !/calm wind assumed/i.test(w));

  return { sheets, terminal: terminalRows(input.atc, input.aerodromes), warnings: [...new Set(warnings)], sources };
}
