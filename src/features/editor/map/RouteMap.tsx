// Controlled: reports edits through callbacks and never changes the flight itself; MapView binds it to the
// editor state. On a round trip (A … A) drawing adds points before the closing A, so the flight keeps
// returning home. A local flight (A → A, nothing between) is not drawn on: its route is set by the
// Route section's Local flight box, and the map only shows it.
import './map.css';

import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { maplibregl } from '../../../app/maplibre';
import {
  type AltitudeDefault,
  buildLegs,
  distanceNm,
  magneticVariation,
  midpoint,
  norm360,
  trueCourse,
} from '../../../calc';
import type { LatLon, RoutePoint, Waypoint } from '../../../shared';
import {
  type AerodromeRequest,
  DEFAULT_STOP_MIN,
  isLocalFlight,
  requestAllowed,
  todayUtc,
  uid as newUid,
} from '../../../shared';
import type { Notam } from '../../../shared/briefing';
import type { MapLayers } from '../../../shared/mapLayers';
import type { RefAerodrome, RefBundle, RefNavaid } from '../../../shared/ref';
import type { MenuItem } from '../../../ui';
import type { AdDayInfo } from '../adDay';
import { AerodromeDetails, AerodromeTipRows } from './AerodromePopover';
import { type AirspaceInfo, airspaceInfos, airspacesAt, farFromRoute, isArea } from './airspace';
import { AirspaceDetails, AirspaceTipRows } from './AirspacePopover';
import {
  aerodromeFeatures,
  airspaceFeatures,
  areaFeatures,
  firFeatures,
  focusFeatures,
  localAreaFeatures,
  midpointFeatures,
  navaidFeatures,
  notamFocusFeatures,
  routeArrowFeatures,
  routeLineFeatures,
  routePointFeatures,
  vfrPointFeatures,
  vfrRouteArrowFeatures,
  vfrRouteFeatures,
  waypointFeatures,
  zoneFeatures,
} from './features';
import { hazardLabelsAt, hazardsByLeg, type LegHazards, type MapHazard, setHazardLayer } from './hazardLayer';
import {
  fmtAltitude,
  fmtCourse,
  fmtDistance,
  labelAlong,
  labelMode,
  legLabelSlots,
  parseAltitudeInput,
  placeLabel,
} from './labels';
import { MapPopover, MapTip } from './MapPopover';
import { airspaceShown, areaToggle, loadPrefs, savePrefs } from './mapPrefs';
import { type DrawMode, LayersControl, MapHint, MapToolbar } from './MapToolbar';
import { NavaidDetails, NavaidTipRows } from './NavaidPopover';
import { type MapNotam, mapNotams, notamKeysAt, setNotamLayer } from './notamLayer';
import { NotamDetails, NotamTipRows } from './NotamPopover';
import { NameBox, type NamePrompt, PointMenu } from './PointMenu';
import {
  addDrawnPoint,
  drawIndex,
  insertPoint,
  isBareRoundTrip,
  mercatorMid,
  movePoint,
  POINT_KIND_LABEL,
  removeDrawnPoint,
  removePoint,
  renamePoint,
} from './routeEdit';
import {
  autoWaypointName,
  bestSnap,
  buildCandidates,
  findSnap,
  pointFromCandidate,
  routeCandidates,
  SNAP_RADIUS_PX,
  type SnapHit,
} from './snap';
import {
  AIR_SOURCES,
  BASE_MAPS,
  type BaseLayers,
  buildStyle,
  type DataSourceId,
  FAR_OPACITY,
  FAR_OPACITY_PROP,
  farScaled,
  FOCUS_DASHES,
  LAYER_GROUPS,
  LGGG_BOUNDS,
  loadChartTokens,
  loadVectorBase,
} from './style';
import { addSymbols } from './symbols';
import { aerodromeVfrCharts, airspaceVfrCharts, vfrChartIndex, vfrChartsAt, vfrPointCharts } from './vfrCharts';

export interface LegAltitude {
  /** ft; NaN = unknown. */
  altFt: number;
  overridden: boolean;
  source: AltitudeDefault['source'];
}

export interface RouteMapProps {
  route: RoutePoint[];
  /** For the labels' magnetic variation. */
  date: string;
  /** By legKey(from, to). */
  altitudes: Record<string, LegAltitude>;
  refData: RefBundle;
  waypoints: Waypoint[];
  /** Where to look when the route is empty (the pilot's home aerodrome), or null. */
  home: LatLon | null;
  onRouteChange: (route: RoutePoint[], opts?: { coalesce?: string }) => void;
  /** null = remove the override (back to the default). */
  onAltitudeChange: (legKey: string, altFt: number | null) => void;
  onCustomWaypoint?: (p: RoutePoint) => void;
  onSaveWaypoint?: (p: RoutePoint) => Promise<void>;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  hazards?: MapHazard[];
  /** NOTAMs to draw (the panel's list); those with a Q-line circle get an area (notamLayer.ts). */
  notams?: Notam[];
  selectedNotam?: string | null;
  onNotamSelect?: (key: string | null) => void;
  hoveredNotam?: string | null;
  focusLeg?: { from: { lat: number; lon: number }; to: { lat: number; lon: number } } | null;
  requests?: Record<string, Partial<Record<AerodromeRequest['kind'], AerodromeRequest>>>;
  onRequest?: (uid: string, kind: AerodromeRequest['kind'], on: boolean, stopMin?: number) => void;
  aerodromeInfo?: (a: RefAerodrome) => AdDayInfo;
  /** The route is always drawn. */
  layers: MapLayers;
  onLayers: (l: MapLayers) => void;
  readOnly?: boolean;
}

type Mode = DrawMode;

interface Drag {
  uid: string;
  index: number;
  insert: boolean;
  start: { x: number; y: number };
  moved: boolean;
  base: RoutePoint[];
  /** The point as it was (moves keep its identity until dropped elsewhere). */
  orig: RoutePoint;
  hit: SnapHit | null;
}

interface Menu {
  x: number;
  y: number;
  uid: string;
}

interface Hover {
  x: number;
  y: number;
  name: string | null;
  detail: string | null;
  leg: string | null;
}

function setData(map: MlMap, id: DataSourceId, data: unknown) {
  void map.getSource<GeoJSONSource>(id)?.setData(data as never);
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/** Second line of the snap tooltip; says when a nearby point was passed over for the aerodrome. */
function snapDetail(hit: SnapHit): string {
  if (!hit.shadowed) return hit.cand.detail;
  const nm = distanceNm(hit.cand, hit.shadowed);
  return `${hit.cand.detail} · ${hit.shadowed.name} (${nm.toFixed(1)} NM away): zoom in to pick it`;
}

function legReadout(a: LatLon, b: LatLon, date: string): string {
  const d = distanceNm(a, b);
  if (d < 0.05) return '';
  const mid = midpoint(a, b);
  const mc = norm360(
    trueCourse(a, b) - magneticVariation(mid.lat, mid.lon, date || new Date().toISOString().slice(0, 10)),
  );
  return `${fmtCourse(mc)}  ${fmtDistance(d)}`;
}

/** A leg label is re-rendered when this changes. */
function labelKey(
  leg: { mcMag: number; distNm: number },
  alt: LegAltitude | undefined,
  haz: LegHazards | undefined,
): string {
  const altFt = alt?.altFt ?? NaN;
  return `${fmtCourse(leg.mcMag)}|${fmtDistance(leg.distNm)}|${fmtAltitude(altFt)}|${alt?.overridden ? 1 : 0}|${alt?.source ?? ''}|${haz ? haz.level + ':' + haz.labels.join(';') : ''}`;
}

/** Returns the stop function; marches even when motion is reduced. */
function marchDashes(m: MlMap, layerId: string): (() => void) | undefined {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let frame = 0,
    last = -1;
  const tick = (now: number) => {
    const phase = Math.floor(now / 60) % FOCUS_DASHES.length;
    if (phase !== last && m.getLayer(layerId)) {
      m.setPaintProperty(layerId, 'line-dasharray', ['literal', FOCUS_DASHES[phase]]);
      last = phase;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/** A press this long on a route point, without moving, opens its menu (touch). */
const LONG_PRESS_MS = 550;
export function RouteMap(props: RouteMapProps) {
  const { route, date, altitudes, refData, waypoints } = props;
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const [prefs, setPrefs] = useState(loadPrefs);
  const layers = props.layers;
  const [layersOpen, setLayersOpen] = useState(false);
  const local = isLocalFlight(route);
  const [mode, setMode] = useState<Mode>(() =>
    !props.readOnly && !local && (route.length < 2 || isBareRoundTrip(route)) ? 'draw' : 'idle',
  );
  /** Drawing appends after the last point even on a round trip ("Continue drawing" on it). */
  const [toEnd, setToEnd] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoutePoint[] | null>(null);
  const [prompt, setPrompt] = useState<NamePrompt | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  /** A touch screen (iPhone, iPad): the hints say tap and press, not click. */
  const [touch] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const [airTip, setAirTip] = useState<{ x: number; y: number; items: AirspaceInfo[] } | null>(null);
  const [wxTip, setWxTip] = useState<{
    x: number;
    y: number;
    items: { level: 'danger' | 'warn'; label: string }[];
  } | null>(null);
  const [airPop, setAirPop] = useState<{ x: number; y: number; items: AirspaceInfo[] } | null>(null);
  /** Hovered or open in the details box; the latest wins. */
  const [mapFocus, setMapFocus] = useState<{ kind: 'air' | 'notam'; id: string } | null>(null);
  const focusOf = (kind: 'air' | 'notam') => (id: string | null) =>
    setMapFocus((f) => (id ? { kind, id } : f?.kind === kind ? null : f));
  const setAirFocus = useMemo(() => focusOf('air'), []);
  const setNotamFocus = useMemo(() => focusOf('notam'), []);
  const closeDetails = useCallback(() => {
    setAdPop(null);
    setNavPop(null);
    setNotamPop(null);
    setAirPop(null);
  }, []);
  const [notamTip, setNotamTip] = useState<{ x: number; y: number; keys: string[] } | null>(null);
  const [notamPop, setNotamPop] = useState<{ x: number; y: number; keys: string[] } | null>(null);
  const [adTip, setAdTip] = useState<{ x: number; y: number; a: RefAerodrome } | null>(null);
  const [adPop, setAdPop] = useState<{ x: number; y: number; a: RefAerodrome } | null>(null);
  const [navTip, setNavTip] = useState<{ x: number; y: number; n: RefNavaid } | null>(null);
  const [navPop, setNavPop] = useState<{ x: number; y: number; n: RefNavaid } | null>(null);
  const [editingLeg, setEditingLeg] = useState<string | null>(null);
  /** The cursor is near the hint bubble: it fades out so it never hides what the pilot points at. */
  const hintEl = useRef<HTMLDivElement>(null);
  const [hintAway, setHintAway] = useState(false);

  const shown = draft ?? route;
  const legs = useMemo(() => buildLegs(shown, date), [shown, date]);
  const chartIdx = useMemo(
    () => vfrChartIndex(refData.aerodromes, refData.vfrPoints),
    [refData.aerodromes, refData.vfrPoints],
  );
  // snapping follows the layers: only what is on the map (the route's own points always)
  const candidates = useMemo(
    () =>
      buildCandidates(
        layers.aerodromes ? refData.aerodromes : [],
        layers.vfrPoints ? refData.vfrPoints : [],
        layers.waypoints ? waypoints : [],
      ),
    [refData, waypoints, layers.aerodromes, layers.vfrPoints, layers.waypoints],
  );

  // Everything the (once-bound) map handlers read.
  // the areas in force on the flight's day (today for a flight without a date)
  const allInfos = useMemo(
    () =>
      airspaceInfos(refData.airspaces, refData.adAirspaces ?? [], refData.areas ?? [], refData.fir, date || todayUtc()),
    [refData, date],
  );
  const airInfos = useMemo(() => allInfos.filter((a) => airspaceShown(layers, a.type)), [allInfos, layers]);
  const areaCount = useMemo(() => {
    const n = { prd: 0, mil: 0, act: 0 };
    for (const a of allInfos) if (isArea(a.type)) n[areaToggle(a.type)]++;
    return n;
  }, [allInfos]);
  const live = useRef({
    props,
    local,
    mode,
    toEnd,
    route,
    shown,
    candidates,
    selected,
    prompt,
    menu,
    editingLeg,
    layersOpen,
    airInfos,
    layers,
    airPop,
    adPop,
    navPop,
    closeDetails,
  });
  live.current = {
    props,
    local,
    mode,
    toEnd,
    route,
    shown,
    candidates,
    selected,
    prompt,
    menu,
    editingLeg,
    layersOpen,
    airInfos,
    layers,
    airPop,
    adPop,
    navPop,
    closeDetails,
  };
  const drag = useRef<Drag | null>(null);
  const cancelDragRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);

  const baseLayers = useRef<BaseLayers | null>(null);
  // the map is built once, with the layers shown at that time (later toggles restyle it in place)
  const buildMap = useEffectEvent((container: HTMLDivElement, vector: maplibregl.StyleSpecification | null) => {
    loadChartTokens();
    const built = buildStyle(layers.base, layers.ofm, vector);
    baseLayers.current = built.baseLayers;
    return createMap(container, built.style);
  });
  useEffect(() => {
    let cancelled = false;
    let m: MlMap | null = null;
    void loadVectorBase().then((vector) => {
      if (cancelled || !el.current) return;
      m = buildMap(el.current, vector);
    });
    return () => {
      cancelled = true;
      m?.remove();
      mapRef.current = null;
    };
  }, []);

  function createMap(container: HTMLDivElement, style: maplibregl.StyleSpecification): MlMap | null {
    let m: MlMap;
    try {
      m = new maplibregl.Map({
        container,
        style,
        bounds: LGGG_BOUNDS,
        fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
        // resized below, synchronously with the layout (no blank frame while a panel is dragged)
        trackResize: false,
        doubleClickZoom: false,
        boxZoom: false, // Shift-click places a custom point
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxZoom: 14,
        minZoom: 4,
      });
    } catch {
      setFailed('The map needs WebGL, which this browser could not start.');
      return null;
    }
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'nautical', maxWidth: 120 }), 'bottom-right');
    m.on('styleimagemissing', () => addSymbols(m));
    m.once('idle', () => {
      const a = container.querySelector('.maplibregl-ctrl-attrib');
      a?.classList.remove('maplibregl-compact-show');
      a?.removeAttribute('open');
    });
    m.on('load', () => {
      addSymbols(m);
      const { refData: r, waypoints: w } = live.current.props;
      const variation = magneticVariation(38, 24, new Date().toISOString().slice(0, 10));
      setData(m, 'airspaces', airspaceFeatures(allInfos));
      setData(m, 'zones', zoneFeatures(allInfos));
      setData(m, 'areas', areaFeatures(live.current.airInfos));
      setData(m, 'fir', firFeatures(r.fir));
      setData(m, 'vfr-routes', vfrRouteFeatures(r.vfrRoutes, r.vfrPoints));
      setData(m, 'vfr-route-arrows', vfrRouteArrowFeatures(r.vfrRoutes, r.vfrPoints));
      setData(m, 'vfr-points', vfrPointFeatures(r.vfrPoints));
      setData(m, 'navaids', navaidFeatures(r.navaids ?? []));
      setData(m, 'aerodromes', aerodromeFeatures(r.aerodromes, variation));
      setData(m, 'waypoints', waypointFeatures(w));
      fitInitial(m);
      setLoaded(true);
    });
    mapRef.current = m;
    // test hook: e2e tests project coordinates through the live map
    (container as HTMLDivElement & { __pgfMap?: MlMap }).__pgfMap = m;
    return m;
  }

  function fitInitial(m: MlMap) {
    const { route: r, props: p } = live.current;
    if (r.length >= 2) {
      const b = new maplibregl.LngLatBounds();
      for (const q of r) b.extend([q.lon, q.lat]);
      m.fitBounds(b, { padding: 90, maxZoom: 10, duration: 0 });
    } else if (r.length === 1) m.jumpTo({ center: [r[0].lon, r[0].lat], zoom: 9 });
    else if (p.home) m.jumpTo({ center: [p.home.lon, p.home.lat], zoom: 8.5 });
  }

  const fitRoute = useCallback(() => {
    const m = mapRef.current;
    if (!m || !route.length) return;
    if (route.length === 1) {
      m.easeTo({ center: [route[0].lon, route[0].lat], zoom: Math.max(m.getZoom(), 9) });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    for (const q of route) b.extend([q.lon, q.lat]);
    m.fitBounds(b, { padding: 90, maxZoom: 11 });
  }, [route]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    const bl = baseLayers.current;
    if (bl)
      for (const b of BASE_MAPS)
        for (const l of bl[b.id])
          if (m.getLayer(l.id))
            m.setLayoutProperty(l.id, 'visibility', b.id === layers.base && l.visible ? 'visible' : 'none');
    m.setLayoutProperty('ofm', 'visibility', layers.ofm ? 'visible' : 'none');
    for (const [k, ids] of Object.entries(LAYER_GROUPS)) {
      const v = layers[k as keyof typeof LAYER_GROUPS] ? 'visible' : 'none';
      for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v);
    }
  }, [layers, loaded]);
  useEffect(() => savePrefs(prefs), [prefs]);
  useEffect(() => {
    const m = mapRef.current;
    if (m && loaded) setData(m, 'areas', areaFeatures(airInfos));
  }, [airInfos, loaded]);

  const focusLeg = props.focusLeg ?? null;
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    setData(m, 'leg-focus', routeLineFeatures(focusLeg ? [focusLeg.from, focusLeg.to] : []));
    return focusLeg ? marchDashes(m, 'leg-focus-line') : undefined;
  }, [focusLeg, loaded]);

  // Panels resized (dragging the flight panel's edge or the navlog's top, collapsing the panel): resize
  // the canvas and redraw in the same frame, before it is painted. MapLibre's own observer is throttled
  // and redraws a frame later, which shows a cleared canvas or an uncovered strip while dragging.
  useEffect(() => {
    const m = mapRef.current,
      c = el.current;
    if (!m || !c || typeof ResizeObserver === 'undefined') return;
    let w = c.clientWidth,
      h = c.clientHeight;
    const ro = new ResizeObserver(() => {
      if (c.clientWidth === w && c.clientHeight === h) return;
      w = c.clientWidth;
      h = c.clientHeight;
      m.resize();
      m.redraw();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [loaded]);

  useEffect(() => {
    const m = mapRef.current;
    if (m && loaded) setData(m, 'waypoints', waypointFeatures(waypoints));
  }, [waypoints, loaded]);

  const hazardMarks = props.hazards;
  useEffect(() => {
    const m = mapRef.current;
    if (m && loaded) setHazardLayer(m, hazardMarks ?? [], 'route-casing');
  }, [hazardMarks, loaded]);

  const notamList = props.notams;
  const notamMarks = useMemo(() => mapNotams(notamList ?? []), [notamList]);
  // Airspaces and areas more than FAR_NM from the route are drawn faint (UX-PLAN.md step 6): what the
  // route goes through stands out. Their layers' opacities are scaled by the feature state 'far'.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    const far: ExpressionSpecification = ['case', ['boolean', ['feature-state', 'far'], false], FAR_OPACITY, 1];
    for (const l of m.getStyle().layers) {
      const prop = FAR_OPACITY_PROP[l.type];
      if (!prop || !('source' in l) || !AIR_SOURCES.includes(l.source)) continue;
      const v = m.getPaintProperty(l.id, prop) as ExpressionSpecification | number | undefined;
      m.setPaintProperty(l.id, prop, farScaled(v, far));
    }
  }, [loaded]);
  const routeLatLon = useMemo(() => route.map((p) => ({ lat: p.lat, lon: p.lon })), [route]);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    const src = (x: AirspaceInfo) =>
      x.type === 'CTR' || x.type === 'ATZ' ? 'zones' : isArea(x.type) ? 'areas' : 'airspaces';
    for (const a of allInfos) {
      const isFar = farFromRoute(a, routeLatLon);
      try {
        m.setFeatureState({ source: src(a), id: a.id }, { far: isFar });
      } catch {
        /* a source not drawn yet */
      }
    }
  }, [allInfos, routeLatLon, loaded]);

  // Dashes march even when motion is reduced. A NOTAM under the pointer in the panel comes first.
  const panelNotam = props.hoveredNotam ?? null;
  const focusData = useMemo(() => {
    if (panelNotam) {
      const n = notamMarks.find((x) => x.key === panelNotam);
      if (n) return notamFocusFeatures(n.key, n.rings);
    }
    if (mapFocus?.kind === 'air' && airPop) {
      const a = allInfos.find((x) => x.id === mapFocus.id);
      return a ? focusFeatures(a) : null;
    }
    if (mapFocus?.kind === 'notam' && notamPop) {
      const n = notamMarks.find((x) => x.key === mapFocus.id);
      return n ? notamFocusFeatures(n.key, n.rings) : null;
    }
    return null;
  }, [panelNotam, mapFocus, airPop, notamPop, allInfos, notamMarks]);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    setData(m, 'air-focus', focusData ?? focusFeatures(null));
    return focusData ? marchDashes(m, 'air-focus-line') : undefined;
  }, [focusData, loaded]);
  const notamLive = useRef<{ marks: MapNotam[]; pop: boolean }>({ marks: [], pop: false });
  notamLive.current = { marks: layers.notams ? notamMarks : [], pop: !!notamPop };
  useEffect(() => {
    const m = mapRef.current;
    if (m && loaded) setNotamLayer(m, notamMarks, props.selectedNotam ?? null, layers.notams, 'route-casing');
  }, [notamMarks, props.selectedNotam, layers.notams, loaded]);
  const selectedNotam = props.selectedNotam ?? null;
  const showNotam = useEffectEvent((key: string | null) => {
    const m = mapRef.current;
    const mk = key && layers.notams ? notamMarks.find((n) => n.key === key) : undefined;
    if (!m || !loaded || !mk) return;
    const view = m.getBounds();
    if (mk.rings.some((r) => r.some((c) => view.contains(c)))) return;
    const b = new maplibregl.LngLatBounds();
    for (const c of mk.rings.flat()) b.extend(c);
    m.fitBounds(b, { padding: 80, maxZoom: Math.max(m.getZoom(), 8) });
  });
  useEffect(() => showNotam(selectedNotam), [selectedNotam, loaded]);
  const notamsOf = (keys: string[]) =>
    keys.map((k) => (notamList ?? []).find((n) => n.key === k)).filter((n): n is Notam => !!n);

  const drawing = mode !== 'idle';
  /** Its index, which is its feature id (generateId). */
  const hoverPoint = useRef<number | null>(null);
  const setHoverPoint = useCallback((i: number | null) => {
    const m = mapRef.current;
    if (!m || hoverPoint.current === i) return;
    if (hoverPoint.current !== null)
      m.setFeatureState({ source: 'route-points', id: hoverPoint.current }, { hover: false });
    hoverPoint.current = i;
    if (i !== null) m.setFeatureState({ source: 'route-points', id: i }, { hover: true });
  }, []);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    setData(m, 'route-line', routeLineFeatures(shown));
    setData(m, 'local-area', localAreaFeatures(shown));
    setData(m, 'route-arrows', routeArrowFeatures(shown));
    setData(m, 'route-points', routePointFeatures(shown, selected));
    setData(m, 'route-mid', drawing || draft ? EMPTY : midpointFeatures(shown));
  }, [shown, selected, loaded, drawing, draft]);
  // the indexes (feature ids) change with the route: the next mouse move finds the point again
  useEffect(() => {
    if (loaded) setHoverPoint(null);
  }, [route, drawing, loaded, setHoverPoint]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    if (!drawing) {
      setData(m, 'route-band', EMPTY);
      setData(m, 'snap', EMPTY);
    }
    m.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    m.getContainer().classList.toggle('is-drawing', drawing);
  }, [drawing, loaded]);

  // Tooltips and details belong to idle mode, and to the layers shown.
  useEffect(() => {
    if (drawing) {
      setWxTip(null);
      setNotamTip(null);
      setNotamPop(null);
      setAdTip(null);
      setAdPop(null);
      setNavTip(null);
      setNavPop(null);
      setAirTip(null);
      setAirPop(null);
    }
  }, [drawing]);
  useEffect(() => {
    setAirTip(null);
    setAirPop(null);
  }, [airInfos]);
  useEffect(() => {
    if (!layers.aerodromes) setAdTip(null);
  }, [layers.aerodromes]);
  useEffect(() => {
    if (!layers.navaids) {
      setNavTip(null);
      setNavPop(null);
    }
  }, [layers.navaids]);
  useEffect(() => {
    if (!layers.notams) {
      setNotamTip(null);
      setNotamPop(null);
    }
  }, [layers.notams]);

  // The route may shrink below 2 points from elsewhere (undo, panel): offer drawing again.
  useEffect(() => {
    if (route.length === 0 && mode === 'idle' && !props.readOnly) setMode('draw');
    if (local && mode !== 'idle') setMode('idle');
    if (selected && !route.some((p) => p.uid === selected)) setSelected(null);
  }, [route, mode, selected, props.readOnly, local]);

  // None while a point is dragged: the hazards belong to the legs before the drag.
  const legHazards = useMemo(
    () => (draft ? new Map<number, LegHazards>() : hazardsByLeg(hazardMarks ?? [])),
    [hazardMarks, draft],
  );
  const markers = useRef(
    new Map<
      string,
      { marker: maplibregl.Marker; el: HTMLDivElement; inner: HTMLDivElement; text: string; at: string }
    >(),
  );

  // legs sharing a line (out and back, or flown twice) have their labels spread along it (labels.ts)
  const labelSlots = useMemo(() => legLabelSlots(legs), [legs]);

  const layoutLabels = useCallback(
    (only?: Set<string>) => {
      const m = mapRef.current;
      if (!m) return;
      legs.forEach((leg, i) => {
        if (only && !only.has(leg.key)) return;
        const rec = markers.current.get(leg.key);
        if (!rec) return;
        const a = m.project([leg.from.lon, leg.from.lat]);
        const b = m.project([leg.to.lon, leg.to.lat]);
        const pl = placeLabel(a, b);
        const slot = labelSlots[i] ?? { t: 0.5, room: 1 };
        const editing = live.current.editingLeg === leg.key;
        const lm = editing ? 'full' : labelMode(pl.lengthPx * slot.room);
        rec.el.dataset.mode = lm;
        // distance from the line to the label's centre: half the label's height plus a small gap (more
        // off the middle, to clear the direction arrows on the line)
        const off = (lm === 'compact' ? 21 : 17) + (slot.room === 1 ? 0 : 3);
        const k = off * pl.side;
        // the marker sits at the middle of the leg: move the label along it to its place
        const s = (slot.room === 1 ? 0.5 : labelAlong(slot, pl.lengthPx, rec.inner.offsetWidth)) - 0.5;
        const tx = pl.normal.x * k + (b.x - a.x) * s,
          ty = pl.normal.y * k + (b.y - a.y) * s;
        rec.inner.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${pl.angleDeg.toFixed(1)}deg)`;
      });
    },
    [legs, labelSlots],
  );

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    const keep = new Set<string>();
    const moved = new Set<string>();
    legs.forEach((leg, i) => {
      keep.add(leg.key);
      const alt = altitudes[leg.key];
      const altFt = alt?.altFt ?? NaN;
      const haz = legHazards.get(i);
      const text = labelKey(leg, alt, haz);
      let rec = markers.current.get(leg.key);
      if (!rec) {
        const elx = document.createElement('div');
        elx.className = 'pgf-leg';
        elx.dataset.testid = 'leg-label';
        elx.dataset.leg = leg.key;
        const inner = document.createElement('div');
        inner.className = 'pgf-leg-inner';
        elx.appendChild(inner);
        const marker = new maplibregl.Marker({ element: elx, anchor: 'center' })
          .setLngLat(mercatorMid(leg.from, leg.to))
          .addTo(m);
        rec = { marker, el: elx, inner, text: '', at: '' };
        markers.current.set(leg.key, rec);
      }
      const at = `${leg.from.lat},${leg.from.lon},${leg.to.lat},${leg.to.lon}`;
      if (rec.at !== at) {
        rec.at = at;
        moved.add(leg.key);
        rec.marker.setLngLat(mercatorMid(leg.from, leg.to));
      }
      // where along the leg the label sits (changes when another leg comes to share its line)
      const slot = String(labelSlots[i]?.t ?? 0.5);
      if (rec.el.dataset.slot !== slot) {
        rec.el.dataset.slot = slot;
        moved.add(leg.key);
      }
      if (rec.text !== text && live.current.editingLeg !== leg.key) {
        rec.text = text;
        moved.add(leg.key);
        renderLegLabel(rec.inner, leg.key, leg.mcMag, leg.distNm, altFt, alt, haz);
      }
      rec.el.dataset.drawing = drawing ? '1' : '';
    });
    for (const [k, rec] of markers.current) {
      if (!keep.has(k)) {
        rec.marker.remove();
        markers.current.delete(k);
      }
    }
    layoutLabels(moved);
  }, [legs, labelSlots, altitudes, legHazards, loaded, drawing, layoutLabels]);

  useEffect(
    () => () => {
      for (const r of markers.current.values()) r.marker.remove();
      markers.current.clear();
    },
    [],
  );

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    let raf = 0;
    const on = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          layoutLabels();
        });
    };
    m.on('zoom', on);
    m.on('resize', on);
    return () => {
      m.off('zoom', on);
      m.off('resize', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [loaded, layoutLabels]);

  const renderLegLabel = useEffectEvent(
    (
      inner: HTMLDivElement,
      key: string,
      mc: number,
      dist: number,
      altFt: number,
      alt: LegAltitude | undefined,
      haz: LegHazards | undefined,
    ) => {
      inner.textContent = '';
      if (haz) {
        const b = document.createElement('span');
        b.className = 'pgf-leg-wx is-' + haz.level;
        b.textContent = '!';
        b.title = haz.labels.join('\n');
        b.setAttribute('aria-label', 'Weather: ' + haz.labels.join('; '));
        b.dataset.testid = 'leg-hazard';
        inner.appendChild(b);
      }
      const course = document.createElement('span');
      course.className = 'pgf-leg-mc';
      course.textContent = fmtCourse(mc);
      const d = document.createElement('span');
      d.className = 'pgf-leg-dist';
      d.textContent = fmtDistance(dist);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pgf-leg-alt' + (alt?.overridden ? ' is-set' : '') + (!isFinite(altFt) ? ' is-unknown' : '');
      btn.textContent = fmtAltitude(altFt);
      btn.title = !isFinite(altFt) ? 'Set altitude' : 'Edit altitude';
      btn.dataset.testid = 'leg-alt';
      stopMapEvents(btn);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        startAltEdit(key);
      });
      inner.append(course, d, btn);
    },
  );

  function stopMapEvents(node: HTMLElement) {
    for (const t of [
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'pointerdown',
      'touchstart',
      'contextmenu',
    ] as const) {
      // the wheel still reaches the map: scrolling over a label or its altitude box zooms
      node.addEventListener(t, (e) => e.stopPropagation(), { passive: t === 'touchstart' });
    }
  }

  function startAltEdit(key: string) {
    if (live.current.props.readOnly) return;
    const rec = markers.current.get(key);
    if (!rec) return;
    setEditingLeg(key);
    live.current.editingLeg = key;
    const btn = rec.inner.querySelector<HTMLButtonElement>('.pgf-leg-alt');
    const alt = live.current.props.altitudes[key];
    const input = document.createElement('input');
    input.className = 'pgf-leg-input';
    input.dataset.testid = 'leg-alt-input';
    input.value = alt && isFinite(alt.altFt) ? String(Math.round(alt.altFt)) : '';
    input.placeholder = 'ft';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', 'Leg altitude, feet');
    input.size = 5;
    stopMapEvents(input);
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      if (commit) {
        const v = parseAltitudeInput(input.value);
        if (typeof v === 'number' && !isFinite(v)) {
          input.classList.add('is-invalid');
          input.focus();
          return;
        }
        done = true;
        live.current.editingLeg = null;
        rec.text = '';
        setEditingLeg(null);
        live.current.props.onAltitudeChange(key, v);
      } else {
        done = true;
        live.current.editingLeg = null;
        rec.text = '';
        setEditingLeg(null);
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else input.classList.remove('is-invalid');
    });
    input.addEventListener('blur', () => {
      // a typo on blur is dropped rather than trapping focus
      const v = parseAltitudeInput(input.value);
      if (typeof v === 'number' && !isFinite(v)) finish(false);
      else finish(true);
    });
    if (btn) btn.replaceWith(input);
    else rec.inner.appendChild(input);
    rec.el.dataset.mode = 'full';
    rec.el.classList.add('is-editing');
    input.focus();
    input.select();
  }

  // After an edit ends, re-render that label (its text key was reset).
  const redrawResetLabels = useEffectEvent(() => {
    for (const rec of markers.current.values()) rec.el.classList.remove('is-editing');
    const m = mapRef.current;
    if (!m) return;
    legs.forEach((leg, i) => {
      const rec = markers.current.get(leg.key);
      if (rec && rec.text === '') {
        const alt = altitudes[leg.key];
        const altFt = alt?.altFt ?? NaN;
        const haz = legHazards.get(i);
        rec.text = labelKey(leg, alt, haz);
        renderLegLabel(rec.inner, leg.key, leg.mcMag, leg.distNm, altFt, alt, haz);
      }
    });
    layoutLabels();
  });
  useEffect(() => {
    if (!editingLeg) redrawResetLabels();
  }, [editingLeg]);

  const snapAt = useCallback((pt: { x: number; y: number }, exceptUid?: string): SnapHit | null => {
    const m = mapRef.current;
    if (!m) return null;
    const r = SNAP_RADIUS_PX + 4;
    const nw = m.unproject([pt.x - r, pt.y - r]);
    const se = m.unproject([pt.x + r, pt.y + r]);
    const box = { west: nw.lng, east: se.lng, north: nw.lat, south: se.lat };
    const project = (lon: number, lat: number) => m.project([lon, lat]);
    const own = findSnap(pt, routeCandidates(live.current.shown, exceptUid), project, SNAP_RADIUS_PX, box);
    const ref = findSnap(pt, live.current.candidates, project, SNAP_RADIUS_PX, box);
    return bestSnap(own, ref);
  }, []);

  function showSnap(m: MlMap, hit: SnapHit | null) {
    setData(
      m,
      'snap',
      hit
        ? { type: 'Feature', geometry: { type: 'Point', coordinates: [hit.cand.lon, hit.cand.lat] }, properties: {} }
        : EMPTY,
    );
  }

  const askName = useCallback((at: { x: number; y: number }, title: string, value: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setPrompt({
        x: at.x,
        y: at.y,
        title,
        value,
        confirm: (name) => {
          setPrompt(null);
          resolve(name);
        },
        cancel: () => {
          setPrompt(null);
          resolve(null);
        },
      });
    });
  }, []);

  const placeCustom = useCallback(
    async (lngLat: { lng: number; lat: number }, at: { x: number; y: number }) => {
      const { route: r, props: p } = live.current;
      const name = await askName(at, 'Name this point', autoWaypointName(r));
      if (!name) return;
      const pt: RoutePoint = {
        uid: newUid(),
        kind: 'custom',
        refId: null,
        name,
        lat: +lngLat.lat.toFixed(6),
        lon: +lngLat.lng.toFixed(6),
      };
      p.onRouteChange(addDrawnPoint(live.current.route, pt, live.current.toEnd));
      p.onCustomWaypoint?.(pt);
    },
    [askName],
  );

  const stopDrawing = useCallback(() => {
    setMode('idle');
    setToEnd(false);
    setHover(null);
    const m = mapRef.current;
    if (m) {
      setData(m, 'route-band', EMPTY);
      setData(m, 'snap', EMPTY);
    }
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    let raf = 0;
    let lastMove: MapMouseEvent | null = null;
    let hoverMid: number | undefined;

    // Hit tests against the live route (not the rendered features, which lag one frame behind and
    // would return a just-removed point lying under another).
    const hitPoint = (p: { x: number; y: number }): number | null => {
      const r = live.current.route;
      let best: number | null = null,
        bd = 10;
      for (let i = r.length - 1; i >= 0; i--) {
        const q = m.project([r[i].lon, r[i].lat]);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };
    const hitMid = (p: { x: number; y: number }): number | null => {
      const r = live.current.route;
      for (let i = 0; i + 1 < r.length; i++) {
        const q = m.project(mercatorMid(r[i], r[i + 1]));
        if (Math.hypot(q.x - p.x, q.y - p.y) <= 8) return i;
      }
      return null;
    };

    /** The aerodrome under a screen point: a route point that is an aerodrome, else a charted aerodrome within 10 px. */
    const adAt = (p: { x: number; y: number }, routeIndex: number | null): RefAerodrome | null => {
      const L = live.current;
      if (!L.props.aerodromeInfo) return null;
      const ads = L.props.refData.aerodromes;
      if (routeIndex !== null) {
        const q = L.route[routeIndex];
        return q.kind === 'aerodrome' ? (ads.find((a) => a.id === q.refId) ?? null) : null;
      }
      if (!L.layers.aerodromes) return null;
      let best: RefAerodrome | null = null,
        bd = 10;
      for (const a of ads) {
        const q = m.project([a.lon, a.lat]);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      return best;
    };

    const navAt = (p: { x: number; y: number }): RefNavaid | null => {
      const L = live.current;
      if (!L.layers.navaids) return null;
      const z = m.getZoom();
      let best: RefNavaid | null = null,
        bd = 9;
      for (const n of L.props.refData.navaids ?? []) {
        // locators and aerodrome NDBs are drawn from zoom 7.5 (style.ts navaid-icon)
        if (z < 7.5 && n.unit === 'kHz' && !n.sources.includes('ENR 4.1')) continue;
        const q = m.project([n.lon, n.lat]);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    };

    const onMove = (e: MapMouseEvent) => {
      lastMove = e;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (lastMove) handleMove(lastMove);
        });
    };

    const handleMove = (e: MapMouseEvent) => {
      const L = live.current;
      const he = hintEl.current;
      if (he) {
        // near the bubble it fades out (it never hides what the pilot points at), except near its close
        // button, which stays visible and clickable
        const c = m.getContainer().getBoundingClientRect();
        const x = e.point.x + c.left,
          y = e.point.y + c.top;
        const near = (r: DOMRect, pad: number) =>
          x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
        const close = he.querySelector('[data-testid=map-hint-close]');
        setHintAway(near(he.getBoundingClientRect(), 48) && !(close && near(close.getBoundingClientRect(), 24)));
      }
      const shift = e.originalEvent.shiftKey;
      const d = drag.current;
      if (d || L.mode !== 'idle') setHoverPoint(null);
      if (d) {
        // the button is up but we never got its mouseup (released outside the window, …)
        if ((e.originalEvent.buttons & 1) === 0) {
          cancelDrag();
          return;
        }
        if (!d.moved && Math.hypot(e.point.x - d.start.x, e.point.y - d.start.y) < 3) return;
        d.moved = true;
        const hit = shift ? null : snapAt(e.point, d.uid);
        d.hit = hit;
        showSnap(m, hit);
        const moved: RoutePoint = hit
          ? { ...pointFromCandidate(hit.cand, d.uid) }
          : {
              ...d.orig,
              uid: d.uid,
              lat: e.lngLat.lat,
              lon: e.lngLat.lng,
              kind: 'custom',
              refId: null,
              name: d.orig.name,
            };
        const next = d.base.map((q) => (q.uid === d.uid ? moved : q));
        if (d.insert && !d.base.some((q) => q.uid === d.uid)) next.splice(d.index, 0, moved);
        setDraft(next);
        setHover(hit ? { x: e.point.x, y: e.point.y, name: hit.cand.name, detail: snapDetail(hit), leg: null } : null);
        return;
      }
      if (L.mode !== 'idle') {
        const hit = shift || L.mode === 'custom' ? null : snapAt(e.point);
        showSnap(m, hit);
        const target: LatLon = hit ? hit.cand : { lat: e.lngLat.lat, lon: e.lngLat.lng };
        // the band runs from the point drawn last to the cursor (and on to the closing point of a round trip)
        const at = drawIndex(L.route, L.toEnd);
        const last = L.route[at - 1];
        const next = L.route[at];
        if (last) {
          const coords = [
            [last.lon, last.lat],
            [target.lon, target.lat],
          ];
          if (next) coords.push([next.lon, next.lat]);
          setData(m, 'route-band', {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: {},
          });
        }
        const custom = !hit;
        setHover({
          x: e.point.x,
          y: e.point.y,
          name: hit ? hit.cand.name : null,
          detail: hit
            ? snapDetail(hit)
            : custom
              ? L.route.length
                ? 'Custom point: click and name it'
                : 'Click to start at a custom point'
              : null,
          leg: last ? legReadout(last, target, L.props.date) : null,
        });
        return;
      }
      const pt = hitPoint(e.point);
      setHoverPoint(pt);
      const mid = pt === null ? hitMid(e.point) : null;
      if (hoverMid !== undefined && mid !== hoverMid) {
        m.setFeatureState({ source: 'route-mid', id: hoverMid }, { hover: false });
        hoverMid = undefined;
      }
      if (mid !== null) {
        hoverMid = mid;
        m.setFeatureState({ source: 'route-mid', id: mid }, { hover: true });
      }
      m.getCanvas().style.cursor = pt !== null ? 'grab' : mid !== null ? 'copy' : '';
      const quiet = !L.airPop && !L.adPop && !L.navPop && !notamLive.current.pop;
      const ad = mid === null && quiet ? adAt(e.point, pt) : null;
      setAdTip(ad ? { x: e.point.x, y: e.point.y, a: ad } : null);
      const nav = pt === null && mid === null && quiet ? navAt(e.point) : null;
      setNavTip(nav ? { x: e.point.x, y: e.point.y, n: nav } : null);
      if ((ad || nav) && pt === null) m.getCanvas().style.cursor = 'pointer';
      // weather hazards go in the hover box because their texts are not printed on the chart
      const wx = pt === null && mid === null && !L.airPop ? hazardLabelsAt(m, e.point, L.props.hazards ?? []) : [];
      setWxTip(wx.length ? { x: e.point.x, y: e.point.y, items: wx } : null);
      const nk =
        pt === null && mid === null && !L.airPop && !notamLive.current.pop
          ? notamKeysAt(m, e.point, notamLive.current.marks)
          : [];
      setNotamTip(nk.length ? { x: e.point.x, y: e.point.y, keys: nk } : null);
      const air = pt === null && mid === null && !L.airPop ? airspacesAt(L.airInfos, e.lngLat.lng, e.lngLat.lat) : [];
      highlightAirspace(air[0] ?? null);
      setAirTip(air.length ? { x: e.point.x, y: e.point.y, items: air } : null);
    };

    let hoverAir: AirspaceInfo | null = null;
    const highlightAirspace = (a: AirspaceInfo | null) => {
      if (hoverAir?.id === a?.id) return;
      const src = (x: AirspaceInfo) =>
        x.type === 'CTR' || x.type === 'ATZ' ? 'zones' : isArea(x.type) ? 'areas' : 'airspaces';
      if (hoverAir) m.setFeatureState({ source: src(hoverAir), id: hoverAir.id }, { hover: false });
      hoverAir = a;
      if (a) m.setFeatureState({ source: src(a), id: a.id }, { hover: true });
    };

    const onDown = (e: MapMouseEvent) => {
      const L = live.current;
      if (L.props.readOnly || L.mode !== 'idle' || e.originalEvent.button !== 0) return;
      const index = hitPoint(e.point);
      const mid = index === null ? hitMid(e.point) : null;
      if (index !== null && L.local) {
        e.preventDefault();
        setSelected(L.route[index].uid);
        return;
      }
      if (index !== null) {
        const uid = L.route[index].uid;
        e.preventDefault();
        setSelected(uid);
        drag.current = {
          uid,
          index,
          insert: false,
          start: { x: e.point.x, y: e.point.y },
          moved: false,
          base: L.route,
          orig: L.route[index],
          hit: null,
        };
      } else if (mid !== null) {
        const leg = mid;
        e.preventDefault();
        const uid = newUid();
        const ll = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        drag.current = {
          uid,
          index: leg + 1,
          insert: true,
          start: { x: e.point.x, y: e.point.y },
          moved: false,
          base: L.route,
          orig: { uid, kind: 'custom', refId: null, name: autoWaypointName(L.route), ...ll },
          hit: null,
        };
      } else return;
      setHoverPoint(null);
      m.getCanvas().style.cursor = 'grabbing';
      m.getContainer().classList.add('is-dragging');
      // Capture phase on window: the release must end the drag wherever it happens, also over a leg
      // label or any other element that stops mouseup from bubbling.
      window.addEventListener('mouseup', onUp, { capture: true });
      window.addEventListener('blur', cancelDrag);
    };

    /** Forget the drag without changing the route (Escape, focus loss, a release we never saw). */
    const cancelDrag = () => {
      if (!drag.current) return;
      endDrag();
      setDraft(null);
    };
    cancelDragRef.current = cancelDrag;

    const endDrag = () => {
      const d = drag.current;
      drag.current = null;
      window.removeEventListener('mouseup', onUp, { capture: true });
      window.removeEventListener('blur', cancelDrag);
      m.getContainer().classList.remove('is-dragging');
      m.getCanvas().style.cursor = '';
      showSnap(m, null);
      setHover(null);
      return d;
    };

    const onUp = (ev: MouseEvent) => void release(ev);
    const release = async (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      const d = endDrag();
      if (!d) return;
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      if (!d.moved) {
        setDraft(null);
        return;
      }
      const L = live.current;
      const rect = m.getContainer().getBoundingClientRect();
      const at = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      const ll = m.unproject([at.x, at.y]);
      // snap where the button was released (the last mouse move may not have been handled yet)
      const hit = ev.shiftKey ? null : snapAt(at, d.uid);
      let point: RoutePoint;
      if (hit) point = pointFromCandidate(hit.cand, d.uid);
      else {
        let name = d.orig.kind === 'custom' && !d.insert ? d.orig.name : '';
        if (!name) {
          const asked = await askName(
            at,
            d.insert ? 'Name the new point' : 'Name this point',
            autoWaypointName(L.route),
          );
          if (!asked) {
            setDraft(null);
            return;
          }
          name = asked;
        }
        point = { uid: d.uid, kind: 'custom', refId: null, name, lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6) };
      }
      const base = live.current.route;
      const next = d.insert ? insertPoint(base, d.index, point) : movePoint(base, d.uid, point, newUid);
      setDraft(null);
      live.current.props.onRouteChange(next);
      if (!d.insert)
        setSelected(next.find((q) => q.lat === point.lat && q.lon === point.lon && q.name === point.name)?.uid ?? null);
      if (point.kind === 'custom' && (d.insert || d.orig.kind !== 'custom'))
        live.current.props.onCustomWaypoint?.(next.find((q) => q.lat === point.lat && q.lon === point.lon) ?? point);
    };

    const onClick = (e: MapMouseEvent) => {
      if (suppressClick.current) return;
      const L = live.current;
      setMenu(null);
      if (L.prompt) {
        L.prompt.cancel();
        return;
      }
      if (L.mode === 'idle') {
        const i = hitPoint(e.point);
        setSelected(i === null ? null : L.route[i].uid);
        // a click opens one details box with everything there: aerodrome, navaid, airspaces, NOTAM
        // areas (a second click closes it)
        setAdTip(null);
        setNavTip(null);
        setNotamTip(null);
        setAirTip(null);
        if (L.adPop || L.navPop || L.airPop || notamLive.current.pop) {
          L.closeDetails();
          highlightAirspace(null);
          return;
        }
        if (i !== null) return;
        const at = { x: e.point.x, y: e.point.y };
        const ad = adAt(e.point, null);
        const nav = navAt(e.point);
        const nk = notamKeysAt(m, e.point, notamLive.current.marks);
        const air = airspacesAt(L.airInfos, e.lngLat.lng, e.lngLat.lat);
        setAdPop(ad ? { ...at, a: ad } : null);
        setNavPop(nav ? { ...at, n: nav } : null);
        setNotamPop(nk.length ? { ...at, keys: nk } : null);
        setAirPop(air.length ? { ...at, items: air } : null);
        if (nk.length) L.props.onNotamSelect?.(nk[0]);
        highlightAirspace(air[0] ?? null);
        return;
      }
      const shift = e.originalEvent.shiftKey || L.mode === 'custom';
      const at = drawIndex(L.route, L.toEnd);
      const last = L.route[at - 1];
      const next = L.route[at];
      const near = (q: RoutePoint | undefined) => {
        if (!q) return false;
        const qp = m.project([q.lon, q.lat]);
        return Math.hypot(qp.x - e.point.x, qp.y - e.point.y) <= 8;
      };
      if ((last && L.route.length >= 2 && near(last)) || near(next)) {
        stopDrawing();
        return;
      }
      const hit = shift ? null : snapAt(e.point);
      if (hit) {
        const same = (q: RoutePoint | undefined) => !!q && hit.cand.lat === q.lat && hit.cand.lon === q.lon;
        if (same(last)) return;
        if (same(next)) {
          stopDrawing();
          return;
        }
        L.props.onRouteChange(addDrawnPoint(L.route, pointFromCandidate(hit.cand, newUid()), L.toEnd));
        return;
      }
      void placeCustom(e.lngLat, { x: e.point.x, y: e.point.y });
    };

    const onDbl = (e: MapMouseEvent) => {
      if (live.current.mode !== 'idle') {
        e.preventDefault();
        stopDrawing();
      }
    };

    const onContext = (e: MapMouseEvent) => {
      const L = live.current;
      if (L.props.readOnly) return;
      const i = hitPoint(e.point);
      if (i !== null) {
        e.preventDefault();
        const uid = L.route[i].uid;
        setSelected(uid);
        setMenu({ x: e.point.x, y: e.point.y, uid });
      } else if (L.mode !== 'idle' && L.route.length >= 1) {
        stopDrawing();
      }
    };

    const onOut = () => {
      setHoverPoint(null);
      setAirTip(null);
      setWxTip(null);
      setNotamTip(null);
      setAdTip(null);
      setNavTip(null);
      setHintAway(false);
      if (!live.current.airPop) highlightAirspace(null);
      if (!drag.current) {
        setHover(null);
        if (live.current.mode !== 'idle') {
          setData(m, 'route-band', EMPTY);
          showSnap(m, null);
        }
      }
    };

    // Touch (iPhone, iPad, touch screens): one finger on a route point or a leg's middle dot drags it as
    // the mouse does, and a long press on a point opens its menu; other gestures pan and zoom the map.
    // The touches go through the mouse handlers above.
    const asMouse = (e: MapTouchEvent) =>
      ({
        point: e.point,
        lngLat: e.lngLat,
        originalEvent: { button: 0, buttons: 1, shiftKey: false }, // a finger down is a held button
        preventDefault: () => e.preventDefault(),
      }) as unknown as MapMouseEvent;
    let press = 0;
    const onTouchStart = (e: MapTouchEvent) => {
      window.clearTimeout(press);
      if (e.points.length !== 1) return cancelDrag();
      const me = asMouse(e);
      onDown(me); // a point or a middle dot under the finger: the drag starts and the map does not pan
      const d = drag.current;
      // a local flight's points do not drag, but still open their menu on a long press
      const fixed = !d && live.current.local && hitPoint(me.point) !== null;
      if ((d && !d.insert) || fixed)
        press = window.setTimeout(() => {
          if (fixed || (drag.current === d && !d?.moved)) {
            cancelDrag();
            onContext(me);
          }
        }, LONG_PRESS_MS);
    };
    const onTouchMove = (e: MapTouchEvent) => {
      if (!drag.current) {
        window.clearTimeout(press);
        return;
      }
      e.preventDefault();
      onMove(asMouse(e));
    };
    const onTouchEnd = (e: MapTouchEvent) => {
      window.clearTimeout(press);
      const t = e.originalEvent.changedTouches[0];
      if (!drag.current || !t) return;
      void release({ button: 0, clientX: t.clientX, clientY: t.clientY, shiftKey: false } as MouseEvent);
    };
    const onTouchCancel = () => {
      window.clearTimeout(press);
      cancelDrag();
    };

    m.on('mousemove', onMove);
    m.on('mousedown', onDown);
    m.on('click', onClick);
    m.on('dblclick', onDbl);
    m.on('contextmenu', onContext);
    m.on('mouseout', onOut);
    m.on('touchstart', onTouchStart);
    m.on('touchmove', onTouchMove);
    m.on('touchend', onTouchEnd);
    m.on('touchcancel', onTouchCancel);
    return () => {
      window.clearTimeout(press);
      m.off('touchstart', onTouchStart);
      m.off('touchmove', onTouchMove);
      m.off('touchend', onTouchEnd);
      m.off('touchcancel', onTouchCancel);
      m.off('mousemove', onMove);
      m.off('mousedown', onDown);
      m.off('click', onClick);
      m.off('dblclick', onDbl);
      m.off('contextmenu', onContext);
      m.off('mouseout', onOut);
      cancelDrag();
      cancelDragRef.current = null;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [loaded, snapAt, placeCustom, stopDrawing, askName, setHoverPoint]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the layers popover even while one of its checkboxes has the focus.
      if (e.key === 'Escape' && live.current.layersOpen && !drag.current) {
        e.preventDefault();
        setLayersOpen(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const L = live.current;
      if (e.key === 'Escape') {
        if (drag.current) cancelDragRef.current?.();
        else if (L.adPop || L.navPop || L.airPop || notamLive.current.pop) L.closeDetails();
        else if (L.layersOpen) setLayersOpen(false);
        else if (L.menu) setMenu(null);
        else if (L.mode !== 'idle') stopDrawing();
        else if (L.selected) setSelected(null);
        else return;
        e.preventDefault();
      } else if (e.key === 'Enter' && L.mode !== 'idle') {
        e.preventDefault();
        stopDrawing();
      } else if (L.props.readOnly) {
        return;
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (L.selected) {
          e.preventDefault();
          L.props.onRouteChange(removePoint(L.route, L.selected));
          setSelected(null);
          setMenu(null);
        } else if (L.mode !== 'idle' && L.route.length) {
          e.preventDefault();
          L.props.onRouteChange(removeDrawnPoint(L.route, L.toEnd));
        }
      } else if (L.local) {
        return;
      } else if (e.key === 'd' || e.key === 'D') {
        setToEnd(false);
        setMode((m) => (m === 'draw' ? 'idle' : 'draw'));
      } else if (e.key === 'w' || e.key === 'W') {
        setToEnd(false);
        setMode((m) => (m === 'custom' ? 'idle' : 'custom'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stopDrawing]);

  const menuPoint = menu ? (route.find((p) => p.uid === menu.uid) ?? null) : null;
  const doRename = async () => {
    if (!menu || !menuPoint) return;
    const at = { x: menu.x, y: menu.y };
    setMenu(null);
    const name = await askName(at, 'Rename point', menuPoint.name);
    if (name && name !== menuPoint.name) props.onRouteChange(renamePoint(live.current.route, menuPoint.uid, name));
  };
  const doRemove = () => {
    if (!menuPoint) return;
    props.onRouteChange(removePoint(route, menuPoint.uid));
    setMenu(null);
    setSelected(null);
  };
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  useEffect(() => setSaveErr(null), [menu]);
  const doSave = async () => {
    if (!menuPoint || !props.onSaveWaypoint) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await props.onSaveWaypoint(menuPoint);
      setMenu(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setSaveErr(status === 409 ? 'You already have a waypoint with this name.' : 'Could not save the waypoint.');
    } finally {
      setSaving(false);
    }
  };
  const continueFrom = () => {
    if (!menuPoint) return;
    setMenu(null);
    setSelected(null);
    setToEnd(true);
    setMode('draw');
  };
  const menuItems = (p: RoutePoint): MenuItem[] => {
    const items: MenuItem[] = [];
    if (p.kind === 'custom') {
      items.push({ label: 'Rename…', onSelect: () => void doRename() });
      if (props.onSaveWaypoint)
        items.push({
          label: saving ? 'Saving…' : 'Save to my waypoints',
          onSelect: () => void doSave(),
          disabled: saving,
        });
    }
    if (p.kind === 'aerodrome' && props.onRequest) {
      const onRequest = props.onRequest;
      const idx = route.findIndex((q) => q.uid === p.uid);
      const tng = props.requests?.[p.uid]?.['touch-and-go'];
      const stop = props.requests?.[p.uid]?.stop;
      const set = (kind: AerodromeRequest['kind'], on: boolean, stopMin?: number) => {
        onRequest(p.uid, kind, on, stopMin);
        setMenu(null);
      };
      const end = idx === 0 ? 'departure' : idx === route.length - 1 ? 'destination' : null;
      const askStop = () => {
        const v = window.prompt(
          `${end ? 'Full stop' : 'Intermediate stop'} at ${p.name}: minutes on the ground`,
          String(stop?.stopMin ?? DEFAULT_STOP_MIN),
        );
        const n = v == null ? NaN : Math.round(Number(v));
        if (isFinite(n) && n > 0) set('stop', true, n);
      };
      if (tng)
        items.push({
          label: 'Remove touch-and-go request',
          onSelect: () => set('touch-and-go', false),
          testId: 'menu-tng-remove',
        });
      else if (requestAllowed(route, idx, 'touch-and-go')) {
        items.push({
          label: idx === 0 ? 'Request touch-and-go before leaving' : 'Request touch-and-go',
          onSelect: () => set('touch-and-go', true),
          testId: 'menu-tng',
        });
      }
      if (stop) {
        items.push({ label: `Change stop (${stop.stopMin ?? DEFAULT_STOP_MIN} min)…`, onSelect: askStop });
        items.push({ label: 'Remove stop request', onSelect: () => set('stop', false), testId: 'menu-stop-remove' });
      } else if (requestAllowed(route, idx, 'stop'))
        items.push({
          label:
            end === 'departure'
              ? 'Request full stop before leaving…'
              : end === 'destination'
                ? 'Request full stop, then a circuit…'
                : 'Request intermediate stop…',
          onSelect: askStop,
          testId: 'menu-stop',
        });
    }
    const ad =
      p.kind === 'aerodrome' && props.aerodromeInfo ? refData.aerodromes.find((x) => x.id === p.refId) : undefined;
    if (ad && menu) {
      const at = { x: menu.x, y: menu.y };
      items.push({
        label: 'Aerodrome hours…',
        onSelect: () => {
          setAdPop({ ...at, a: ad });
          setMenu(null);
        },
        testId: 'menu-ad-hours',
      });
    }
    // a VFR reporting point's chart (its id is '<chart>/<NAME>')
    if (p.kind === 'vfr' && p.refId) {
      for (const c of vfrPointCharts(chartIdx, { chart: p.refId.split('/')[0], lat: p.lat, lon: p.lon })) {
        items.push({
          label: `VFR chart ${c.icao} (PDF)`,
          onSelect: () => {
            window.open(c.url, '_blank', 'noopener,noreferrer');
            setMenu(null);
          },
          testId: 'menu-vfr-chart',
        });
      }
    }
    if (local) return items;
    if (route[route.length - 1]?.uid === p.uid) items.push({ label: 'Continue drawing', onSelect: continueFrom });
    items.push({ label: 'Remove point', onSelect: doRemove, danger: true });
    return items;
  };

  const closing = mode !== 'idle' && drawIndex(route, toEnd) < route.length ? route[route.length - 1] : null;
  const hint = props.readOnly
    ? ''
    : local
      ? 'Local flight · untick Local flight in Route to draw a route'
      : mode === 'custom'
        ? closing
          ? `Click to place a custom point before ${closing.name} and name it · Esc to stop`
          : 'Click to place a custom point and name it · Esc to stop'
        : mode === 'draw'
          ? route.length === 0
            ? `${touch ? 'Tap' : 'Click'} your departure aerodrome to start`
            : touch
              ? closing
                ? `Tap to add points before the return to ${closing.name} · tap ${closing.name} to finish`
                : 'Tap to add points · tap the last point to finish'
              : closing
                ? `Click to add points before the return to ${closing.name} · Shift-click for a custom point · click ${closing.name}, Enter or Esc to finish`
                : 'Click to add points · Shift-click for a custom point · click the last point, Enter or Esc to finish'
          : route.length >= 2
            ? touch
              ? 'Drag points to move · drag a leg’s middle dot to insert · press and hold a point for options · tap an altitude to edit'
              : 'Drag points to move · drag a leg’s middle dot to insert · right-click a point for options · click an altitude to edit'
            : '';

  return (
    <div className="pgf-map" data-testid="map" data-ready={loaded ? '1' : undefined}>
      <div ref={el} className="pgf-map-canvas" />
      {failed && <div className="pgf-map-failed">{failed}</div>}

      {!failed && (
        <MapToolbar
          mode={mode}
          readOnly={props.readOnly}
          drawLocked={local}
          hasRoute={route.length > 0}
          onMode={(m) => {
            setToEnd(false);
            setMode(m);
          }}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
          canUndo={props.canUndo}
          canRedo={props.canRedo}
          onFit={fitRoute}
        />
      )}

      {!failed && (
        <LayersControl
          open={layersOpen}
          onOpen={setLayersOpen}
          layers={layers}
          onLayers={props.onLayers}
          tips={prefs.tips}
          onTips={(tips) => setPrefs({ ...prefs, tips })}
          airac={refData.airac.id}
          areaCount={areaCount}
          notamCount={notamMarks.length}
        />
      )}

      {hint && prefs.tips && !failed && (
        <MapHint
          text={hint}
          away={hintAway}
          onClose={() => {
            setPrefs({ ...prefs, tips: false });
            setHintAway(false);
          }}
          hintRef={hintEl}
        />
      )}

      {hover && (hover.name || hover.detail || hover.leg) && !prompt && (
        <MapTip x={hover.x} y={hover.y} className="pgf-snap-tip" testId="snap-tip">
          {hover.name && <b>{hover.name}</b>}
          {hover.detail && <span className="pgf-snap-detail">{hover.detail}</span>}
          {hover.leg && <span className="pgf-snap-leg">{hover.leg}</span>}
        </MapTip>
      )}

      {(() => {
        const at = adTip ?? navTip ?? airTip ?? notamTip ?? wxTip;
        if (!at || hover || menu || mode !== 'idle' || airPop || notamPop || adPop || navPop) return null;
        const notams = notamTip ? notamsOf(notamTip.keys) : [];
        const ad = adTip && props.aerodromeInfo ? adTip : null;
        return (
          <MapTip x={at.x} y={at.y} testId="map-tip">
            {ad && <AerodromeTipRows a={ad.a} info={props.aerodromeInfo!(ad.a)} />}
            {navTip && <NavaidTipRows n={navTip.n} />}
            {airTip && <AirspaceTipRows items={airTip.items} />}
            {notams.length > 0 && <NotamTipRows items={notams} />}
            {wxTip && (
              <div className="pgf-tip-section pgf-wx-tip" data-testid="hazard-tip">
                {wxTip.items.map((h) => (
                  <span key={h.label} className={'is-' + h.level}>
                    {h.label}
                  </span>
                ))}
              </div>
            )}
            {(ad || navTip || airTip || notams.length > 0) && <div className="pgf-air-tip-more">Click for details</div>}
          </MapTip>
        );
      })()}
      {(adPop || navPop || airPop || notamPop) &&
        (() => {
          const at = (adPop ?? navPop ?? notamPop ?? airPop)!;
          const notams = notamPop ? notamsOf(notamPop.keys) : [];
          return (
            <MapPopover x={at.x} y={at.y} label="Details" testId="map-pop" onClose={closeDetails}>
              {adPop && props.aerodromeInfo && (
                <AerodromeDetails
                  a={adPop.a}
                  info={props.aerodromeInfo(adPop.a)}
                  airac={refData.airac.id}
                  charts={aerodromeVfrCharts(chartIdx, adPop.a)}
                />
              )}
              {navPop && (
                <NavaidDetails
                  n={navPop.n}
                  airac={refData.airac.id}
                  charts={vfrChartsAt(chartIdx, navPop.n.lon, navPop.n.lat)}
                />
              )}
              {airPop && (
                <AirspaceDetails
                  items={airPop.items}
                  airac={refData.airac.id}
                  chartsFor={(a) => airspaceVfrCharts(chartIdx, a)}
                  onFocus={setAirFocus}
                />
              )}
              {notams.length > 0 && (
                <NotamDetails
                  items={notams}
                  legName={(i) => (legs[i] ? `${legs[i].from.name} → ${legs[i].to.name}` : '')}
                  onOpen={(k) => props.onNotamSelect?.(k)}
                  onFocus={setNotamFocus}
                />
              )}
            </MapPopover>
          );
        })()}

      {prompt && <NameBox prompt={prompt} />}

      {menu && menuPoint && (
        <PointMenu
          x={menu.x}
          y={menu.y}
          title={menuPoint.name}
          detail={POINT_KIND_LABEL[menuPoint.kind]}
          items={menuItems(menuPoint)}
          error={saveErr}
        />
      )}
    </div>
  );
}
