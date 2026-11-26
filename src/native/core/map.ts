// The Map tab as the website's route map (src/features/editor/map/RouteMap.tsx) edits and explains
// it: what a tap at a place shows (aerodrome, radio navaid, airspaces, NOTAM areas), a route point's
// menu, the route's own sources while a point is dragged or drawn, the names a custom point can take,
// and the layers menu. Texts come formatted as the website's boxes print them.
import { distanceNm, magneticVariation, midpoint, norm360, trueCourse } from '../../calc';
import {
  notamLimits,
  notamSubject,
  notamValidity,
  notamWhere,
  onlyFromAutorouter,
  visibleNotams,
} from '../../data/notams';
import { adDayInfo, adHandlingLine, adHoursLine, fmtAdDay } from '../../features/editor/adDay';
import {
  AIRSPACE_TYPE_LABEL,
  type AirspaceInfo,
  airspaceInfos,
  airspacesAt,
  fmtVertical,
  isArea,
  pointInRing,
  shortClass,
} from '../../features/editor/map/airspace';
import {
  fmtHemi,
  localAreaFeatures,
  midpointFeatures,
  NAVAID_TYPE_NAME,
  navaidFreqText,
  routeArrowFeatures,
  routeLineFeatures,
  routePointFeatures,
} from '../../features/editor/map/features';
import { fmtCourse, fmtDistance } from '../../features/editor/map/labels';
import { airspaceShown, areaToggle } from '../../features/editor/map/mapPrefs';
import { mapNotams } from '../../features/editor/map/notamLayer';
import { drawIndex, POINT_KIND_LABEL } from '../../features/editor/map/routeEdit';
import { cleanWaypointName } from '../../features/editor/map/snap';
import {
  aerodromeVfrCharts,
  airspaceVfrCharts,
  type VfrChartIndex,
  vfrChartIndex,
  vfrChartsAt,
  vfrPointCharts,
} from '../../features/editor/map/vfrCharts';
import { calcAdEffects } from '../../features/editor/panels/flightCalc';
import {
  type AerodromeRequest,
  DEFAULT_MAP_LAYERS,
  DEFAULT_STOP_MIN,
  type FlightOptions,
  type LatLon,
  type MapLayers,
  mapLayersOf,
  MAX_STOP_MIN,
  type RefAerodrome,
  type RefNavaid,
  requestAllowed,
  type RoutePoint,
  todayUtc,
} from '../../shared';
import type { Notam, NotamBriefing } from '../../shared/briefing';
import { mercator } from './plan';
import { arg, type CoreRef, type Json, plain, type Ref, refOf } from './shared';

// ---------------------------------------------------------------- caches of the reference data

let cache: { bundle: unknown; day: string; infos: AirspaceInfo[]; charts: VfrChartIndex } | null = null;
/**
 * The airspaces (the areas in force on `day`, the flight's, else today) and the VFR chart index of the
 * reference data (built once per bundle and day: a hover asks often).
 */
function refIndex(r: Ref, date?: string | null) {
  const b = r.bundle;
  const day = date || todayUtc();
  if (cache?.bundle !== b || cache.day !== day)
    cache = {
      bundle: b,
      day,
      infos: airspaceInfos(b.airspaces, b.adAirspaces ?? [], b.areas ?? [], b.fir, day),
      charts: cache?.bundle === b ? cache.charts : vfrChartIndex(b.aerodromes, b.vfrPoints, r.aip),
    };
  return cache;
}

const layersOf = (l: Partial<MapLayers> | null | undefined): MapLayers => mapLayersOf(l ?? null) ?? DEFAULT_MAP_LAYERS;

/** An AIP reference with its PDF. */
const aip = (r: Ref, ref: string) => ({ ref, url: r.aip.url(ref) });

interface Row {
  label: string;
  text: string;
  /** NOTAMs that changed it (aerodrome hours). */
  notams?: string[];
}

// ---------------------------------------------------------------- the details boxes

/** AerodromePopover's details: the hours of the flight's day (AdHoursDetail), the AIP and the VFR chart. */
function aerodromeCard(a: RefAerodrome, date: string, briefing: NotamBriefing | null, r: Ref) {
  const info = adDayInfo(a, date, calcAdEffects(briefing));
  const h = a.hours;
  const published = !!h && !!info.ad;
  const rows: Row[] = [];
  const partial: Row[] = [];
  if (h && info.ad) {
    rows.push({ label: fmtAdDay(info.day), text: info.ad.text, notams: info.ad.notams });
    if (info.ats) rows.push({ label: 'ATS', text: info.ats.text, notams: info.ats.notams });
    if (info.handling) rows.push({ label: 'Handling', text: info.handling.text, notams: info.handling.notams });
    if (h.customs)
      rows.push({ label: 'Customs', text: h.customs.parsed.partial ? h.customs.text : h.customs.parsed.label });
    // text the parser could not represent exactly: shown as printed
    if ([h.ad, h.ats, h.handling].some((f) => f?.parsed.partial)) {
      partial.push({ label: 'AD', text: h.ad.text });
      if (h.ats) partial.push({ label: 'ATS', text: h.ats.text });
      partial.push({ label: 'Handling', text: h.handling.text });
      if (h.customs) partial.push({ label: 'Customs', text: h.customs.text });
      if (h.remarks) partial.push({ label: 'Remarks', text: h.remarks });
    }
  }
  return {
    id: a.id,
    icao: a.icao,
    title: a.icao ? `${a.icao} · ${a.name}` : a.name,
    elevFt: a.elevFt === null ? null : Math.round(a.elevFt),
    hoursLine: adHoursLine(info),
    handlingLine: adHandlingLine(info),
    closed: !!info.ad?.runs.every((x) => x.status === 'closed'),
    published,
    rows,
    notams: published
      ? info.notams.map((n) => ({ key: n.key, summary: n.summary, text: n.partial ? n.text : null }))
      : [],
    hoursSource: h && info.ad ? aip(r, h.source) : null,
    partial,
    partialNotes: h && partial.length ? h.ad.parsed.notes : [],
    source: aip(r, a.source),
    charts: aerodromeVfrCharts(refIndex(r).charts, a),
    airac: r.bundle.airac.id,
  };
}

/** NavaidPopover's details. */
function navaidCard(n: RefNavaid, r: Ref) {
  const rows: Row[] = [{ label: 'Type', text: NAVAID_TYPE_NAME[n.type] }];
  rows.push({
    label: 'Frequency',
    text: [n.freq !== null ? navaidFreqText(n) : '', n.channel ? `CH ${n.channel}` : ''].filter(Boolean).join(' · '),
  });
  rows.push({ label: 'Hours', text: n.hours });
  if (n.coverage) rows.push({ label: 'Coverage', text: n.coverage });
  if (n.elevFt !== null) rows.push({ label: 'DME elev', text: `${n.elevFt} ft` });
  if (n.variation !== null || n.declination !== null)
    rows.push({
      label: 'Variation',
      text: [
        n.variation !== null ? `${fmtHemi(n.variation)} (${n.variationYear})` : '',
        n.declination !== null ? `declination ${fmtHemi(n.declination)}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    });
  return {
    id: n.id,
    type: n.type,
    title: `${n.ident} · ${n.name}`,
    freq: navaidFreqText(n),
    rows,
    sources: n.sources.map((s) => aip(r, s)),
    charts: vfrChartsAt(refIndex(r).charts, n.lon, n.lat),
    airac: r.bundle.airac.id,
  };
}

/** AirspacePopover's details. */
function airspaceCard(a: AirspaceInfo, r: Ref) {
  const rows: Row[] = [
    { label: 'Type', text: AIRSPACE_TYPE_LABEL[a.type] + (a.cls ? ` · class ${a.cls}` : '') },
    { label: 'Vertical', text: fmtVertical(a.lower, a.upper) },
    { label: 'Lateral', text: a.lateral },
  ];
  if (a.activity) rows.push({ label: 'Active', text: a.activity });
  rows.push(...(a.timeRows ?? []));
  a.notes.forEach((n, i) => rows.push({ label: i === 0 ? 'Notes' : '', text: n }));
  return {
    id: a.id,
    type: a.type,
    title: a.sector ? `${a.name} · ${a.sector}` : a.name,
    cls: shortClass(a.cls),
    vertical: fmtVertical(a.lower, a.upper),
    rows,
    /** Areas list their units only when there are some. */
    showUnits: a.units.length > 0 || !isArea(a.type),
    units: a.units.map((u) => ({ callsign: u.callsign, freqs: u.freqs, hours: u.hours ?? null })),
    remarks: a.remarks,
    charts: airspaceVfrCharts(refIndex(r).charts, a),
    source: aip(r, a.source),
    airac: r.bundle.airac.id,
  };
}

/** NotamPopover's details. */
function notamCard(n: Notam, route: RoutePoint[]) {
  const i = n.legIndex;
  const leg = i !== null && route[i] && route[i + 1] ? `${i + 1}: ${route[i].name} → ${route[i + 1].name}` : null;
  return {
    key: n.key,
    where: notamWhere(n),
    subject: notamSubject(n),
    qcode: n.qcode,
    validity: notamValidity(n),
    schedule: n.schedule,
    limits: notamLimits(n),
    leg,
    text: n.text,
    raw: n.raw,
    relevant: n.relevant,
    autorouter: onlyFromAutorouter(n),
  };
}

/** Within `px` of the screen point at this zoom, the nearest first. */
function nearest<T extends LatLon>(
  list: readonly T[],
  lat: number,
  lon: number,
  zoom: number,
  px: number,
  skip?: (x: T) => boolean,
) {
  const m = mercator(zoom);
  const at = m.project(lon, lat);
  let best: T | null = null,
    bd = px;
  for (const x of list) {
    if (skip?.(x)) continue;
    const q = m.project(x.lon, x.lat);
    const d = Math.hypot(q.x - at.x, q.y - at.y);
    if (d < bd) {
      bd = d;
      best = x;
    }
  }
  return best;
}

/**
 * What a tap at (lat, lon) on the map at `zoom` shows, as the website's map opens one details box with
 * everything there (RouteMap onClick): the aerodrome within 10 px, the navaid within 9 px, the NOTAM
 * areas (smallest first) and the airspaces, each as the layers show them. `aerodrome` (an id): only
 * that aerodrome's box (a route point's "Aerodrome hours…").
 */
export function mapInfo(
  input: Json<{
    ref?: CoreRef | null;
    lat?: number;
    lon?: number;
    zoom?: number;
    layers?: Partial<MapLayers> | null;
    notams?: NotamBriefing | null;
    /** The flight's date (the aerodrome hours' day). */
    date?: string | null;
    route?: RoutePoint[] | null;
    aerodrome?: string | null;
  }>,
) {
  const i = arg(input);
  const r = refOf(i.ref);
  const route = i.route ?? [];
  const briefing = i.notams ?? null;
  const date = i.date ?? '';
  if (i.aerodrome) {
    const a = r.find(i.aerodrome);
    return plain({
      aerodrome: a ? aerodromeCard(a, date, briefing, r) : null,
      navaid: null,
      airspaces: [],
      notams: [],
    });
  }
  const lat = i.lat ?? NaN,
    lon = i.lon ?? NaN,
    zoom = i.zoom ?? 8;
  const layers = layersOf(i.layers);
  const ad = layers.aerodromes ? nearest(r.bundle.aerodromes, lat, lon, zoom, 10) : null;
  // locators and aerodrome NDBs are drawn from zoom 7.5 (style.ts navaid-icon)
  const nav = layers.navaids
    ? nearest(
        r.bundle.navaids,
        lat,
        lon,
        zoom,
        9,
        (n) => zoom < 7.5 && n.unit === 'kHz' && !n.sources.includes('ENR 4.1'),
      )
    : null;
  const shown = visibleNotams(briefing, false);
  const notams = layers.notams
    ? mapNotams(shown)
        .filter((n) => n.rings.some((ring) => pointInRing(lon, lat, ring)))
        .sort((a, b) => a.sizeNm - b.sizeNm)
        .map((n) => shown.find((x) => x.key === n.key))
        .filter((n): n is Notam => !!n)
    : [];
  const infos = refIndex(r, date).infos.filter((a) => airspaceShown(layers, a.type));
  return plain({
    aerodrome: ad ? aerodromeCard(ad, date, briefing, r) : null,
    navaid: nav ? navaidCard(nav, r) : null,
    airspaces: airspacesAt(infos, lon, lat).map((a) => airspaceCard(a, r)),
    notams: notams.map((n) => notamCard(n, route)),
  });
}

// ---------------------------------------------------------------- a route point's menu

/**
 * What a route point's menu offers (RouteMap menuItems): renaming and saving a custom point, the
 * touch-and-go and stop requests of an aerodrome, its hours, a VFR point's chart, continuing the
 * route from its last point.
 */
export function pointMenu(
  input: Json<{
    ref?: CoreRef | null;
    route: RoutePoint[];
    options?: Partial<FlightOptions> | null;
    uid: string;
  }>,
) {
  const i = arg(input);
  const r = refOf(i.ref);
  const route = i.route ?? [];
  const idx = route.findIndex((q) => q.uid === i.uid);
  if (idx < 0) return null;
  const p = route[idx];
  const mine: Partial<Record<AerodromeRequest['kind'], AerodromeRequest>> = {};
  for (const q of i.options?.aerodromeRequests ?? []) if (q.pointUid === p.uid) mine[q.kind] = q;
  const aerodrome = p.kind === 'aerodrome' ? (r.bundle.aerodromes.find((a) => a.id === p.refId) ?? null) : null;
  const vfr = p.kind === 'vfr' && p.refId;
  return plain({
    uid: p.uid,
    name: p.name,
    kind: p.kind,
    kindLabel: POINT_KIND_LABEL[p.kind],
    index: idx,
    end: idx === 0 ? 'departure' : idx === route.length - 1 ? 'destination' : null,
    last: idx === route.length - 1,
    aerodromeId: aerodrome?.id ?? null,
    requests:
      p.kind === 'aerodrome'
        ? {
            tng: { on: !!mine['touch-and-go'], allowed: requestAllowed(route, idx, 'touch-and-go') },
            stop: {
              on: !!mine.stop,
              allowed: requestAllowed(route, idx, 'stop'),
              stopMin: mine.stop?.stopMin ?? DEFAULT_STOP_MIN,
            },
          }
        : null,
    stopMin: { default: DEFAULT_STOP_MIN, max: MAX_STOP_MIN },
    charts: vfr ? vfrPointCharts(refIndex(r).charts, { chart: p.refId!.split('/')[0], lat: p.lat, lon: p.lon }) : [],
  });
}

// ---------------------------------------------------------------- drawing

/**
 * The route's own sources as the map draws them while it is edited (RouteMap): the line, the local
 * area, the arrows, the points (the selected one marked) and the legs' middle dots (none while drawing
 * or dragging: `handles` false).
 */
export function routeFeatures(
  input: Json<{ route: RoutePoint[]; selected?: string | null; handles?: boolean }>,
): Record<string, unknown> {
  const i = arg(input);
  const route = i.route ?? [];
  return plain({
    'route-line': routeLineFeatures(route),
    'local-area': localAreaFeatures(route),
    'route-arrows': routeArrowFeatures(route),
    'route-points': routePointFeatures(route, i.selected ?? null),
    'route-mid': i.handles === false ? { type: 'FeatureCollection', features: [] } : midpointFeatures(route),
  });
}

/**
 * The rubber band while drawing: from the point drawn last to `target`, and on to a round trip's
 * closing point; and the leg's magnetic course and distance (RouteMap legReadout).
 */
export function drawBand(input: Json<{ route: RoutePoint[]; toEnd?: boolean; target: LatLon; date?: string | null }>) {
  const i = arg(input);
  const route = i.route ?? [];
  const at = drawIndex(route, !!i.toEnd);
  const last = route[at - 1];
  const next = route[at];
  const t = i.target;
  if (!last) return plain({ band: null, readout: null });
  const coords = [
    [last.lon, last.lat],
    [t.lon, t.lat],
  ];
  if (next) coords.push([next.lon, next.lat]);
  let readout = '';
  const d = distanceNm(last, t);
  if (d >= 0.05) {
    const mid = midpoint(last, t);
    const day = i.date || new Date().toISOString().slice(0, 10);
    readout = `${fmtCourse(norm360(trueCourse(last, t) - magneticVariation(mid.lat, mid.lon, day)))}  ${fmtDistance(d)}`;
  }
  return plain({
    band: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} },
    readout,
  });
}

/** A custom point's name as the website takes it (upper case, single spaces), or '' when it cannot be one. */
export function waypointName(input: Json<{ name: string }>) {
  return { name: cleanWaypointName(arg(input).name ?? '') };
}

// ---------------------------------------------------------------- layers

/**
 * The map's layers (the flight's, else the pilot's for new flights, else all: mapPrefs flightLayers)
 * and the layers menu's counts: the ENR 5 areas by toggle and the NOTAMs drawn as areas.
 */
export function mapLayers(
  input: Json<{
    ref?: CoreRef | null;
    flight?: unknown;
    pilot?: unknown;
    notams?: NotamBriefing | null;
    /** The flight's date: the areas counted are those in force then (today without one). */
    date?: string | null;
  }>,
) {
  const i = arg(input);
  const r = refOf(i.ref);
  const layers = mapLayersOf(i.flight) ?? mapLayersOf(i.pilot) ?? { ...DEFAULT_MAP_LAYERS };
  const counts = { prd: 0, mil: 0, act: 0, notams: 0 };
  for (const a of refIndex(r, i.date).infos) if (isArea(a.type)) counts[areaToggle(a.type)]++;
  counts.notams = mapNotams(visibleNotams(i.notams ?? null, false)).length;
  return plain({ layers, counts, airac: r.bundle.airac.id });
}
