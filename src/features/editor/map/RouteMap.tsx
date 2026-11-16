// The route map: a controlled MapLibre component. It draws the VFR-chart layers and the route, and
// reports edits through callbacks; it never changes the flight itself. MapView (./MapView.tsx)
// binds it to the editor state (useEditor().update).
//
// Interaction
//   Draw mode (toolbar "Draw", or automatically while the route has < 2 points or is a bare
//   home → home): click adds a point, snapping to the nearest aerodrome / VFR point / my waypoint / route point within ~12 px.
//   Clicking empty map (or Shift-click anywhere, or "Custom point" mode) places a custom point and
//   asks its name. Click the last point, double-click, Enter or Esc to stop. Backspace removes the
//   last point while drawing. On a round trip (A … A) drawing adds points before the closing A, so
//   the flight keeps returning home; clicking A ends drawing ("Continue drawing" on the last point
//   appends after it instead).
//   Edit mode: drag a point (snaps like drawing; Shift = no snap): dropped on an aerodrome / VFR point /
//   my waypoint it becomes that point (name, position, a new uid when it is another point); dropped on
//   open map it becomes a custom point (a known point asks for a name); drag a leg's middle handle to insert a point;
//   click a point to select it, Backspace/Delete removes it, right-click for more.
//   Leg labels: magnetic course and distance (read-only), altitude (click to edit; Enter/Esc).
import './map.css';

import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
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
import { type AerodromeRequest, DEFAULT_STOP_MIN, requestAllowed, uid as newUid } from '../../../shared';
import type { Notam } from '../../../shared/briefing';
import type { MapLayers } from '../../../shared/mapLayers';
import type { RefAerodrome, RefBundle } from '../../../shared/ref';
import type { MenuItem } from '../../../ui';
import type { AdDayInfo } from '../AerodromeHours';
import { AerodromePopover, AerodromeTip } from './AerodromePopover';
import { type AirspaceInfo, airspaceInfos, airspacesAt, isArea } from './airspace';
import { AirspacePopover, AirspaceTip } from './AirspacePopover';
import {
  aerodromeFeatures,
  airspaceFeatures,
  areaFeatures,
  firFeatures,
  midpointFeatures,
  routeArrowFeatures,
  routeLineFeatures,
  routePointFeatures,
  vfrPointFeatures,
  vfrRouteFeatures,
  waypointFeatures,
  zoneFeatures,
} from './features';
import { hazardLabelsAt, hazardsByLeg, type LegHazards, type MapHazard, setHazardLayer } from './hazardLayer';
import { fmtAltitude, fmtCourse, fmtDistance, labelMode, parseAltitudeInput, placeLabel } from './labels';
import { MapTip } from './MapPopover';
import { airspaceShown, areaToggle, loadPrefs, savePrefs } from './mapPrefs';
import { type DrawMode, LayersControl, MapHint, MapToolbar } from './MapToolbar';
import { type MapNotam, mapNotams, notamKeysAt, setNotamLayer } from './notamLayer';
import { NotamPopover, NotamTip } from './NotamPopover';
import { NameBox, type NamePrompt, PointMenu } from './PointMenu';
import {
  addDrawnPoint,
  drawIndex,
  insertPoint,
  isBareRoundTrip,
  mercatorMid,
  movePoint,
  removeDrawnPoint,
  removePoint,
  renamePoint,
} from './routeEdit';
import {
  autoWaypointName,
  buildCandidates,
  findSnap,
  pointFromCandidate,
  routeCandidates,
  SNAP_RADIUS_PX,
  type SnapCandidate,
  type SnapHit,
} from './snap';
import {
  BASE_MAPS,
  type BaseLayers,
  buildStyle,
  type DataSourceId,
  LAYER_GROUPS,
  LGGG_BOUNDS,
  loadChartTokens,
  loadVectorBase,
} from './style';
import { addSymbols } from './symbols';

export interface LegAltitude {
  /** Effective altitude, ft (NaN = unknown). */
  altFt: number;
  /** The pilot typed it (LegOverride.altFt). */
  overridden: boolean;
  /** Rule that gave the default. */
  source: AltitudeDefault['source'];
}

export interface RouteMapProps {
  route: RoutePoint[];
  /** Flight date (magnetic variation of the labels). */
  date: string;
  /** Altitude per leg key (legKey(from, to)). */
  altitudes: Record<string, LegAltitude>;
  refData: RefBundle;
  waypoints: Waypoint[];
  /** Where to look when the route is empty (the pilot's home aerodrome), or null. */
  home: LatLon | null;
  onRouteChange: (route: RoutePoint[], opts?: { coalesce?: string }) => void;
  /** null = remove the override (back to the default). */
  onAltitudeChange: (legKey: string, altFt: number | null) => void;
  /** A custom point was named and placed (informational). */
  onCustomWaypoint?: (p: RoutePoint) => void;
  /** "Save to my waypoints" on a custom point; resolves when saved. */
  onSaveWaypoint?: (p: RoutePoint) => Promise<void>;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Weather hazard marks on the affected stretches of the legs (hazardLayer.ts). */
  hazards?: MapHazard[];
  /** NOTAMs to draw (the panel's list); those with a Q-line circle get an area (notamLayer.ts). */
  notams?: Notam[];
  /** The NOTAM picked in the panel or on the map (highlighted). */
  selectedNotam?: string | null;
  onNotamSelect?: (key: string | null) => void;
  /** Touch-and-go / stop request per route point uid (FlightOptions.aerodromeRequests). */
  requests?: Record<string, AerodromeRequest>;
  /** Sets (kind) or removes (null) the request on an aerodrome point of the route. */
  onRequest?: (uid: string, kind: AerodromeRequest['kind'] | null, stopMin?: number) => void;
  /** An aerodrome's hours on the flight's date (AIP + NOTAMs), for its tooltip and details. */
  aerodromeInfo?: (a: RefAerodrome) => AdDayInfo;
  /** The layers shown (the flight's selection); the route is always drawn. */
  layers: MapLayers;
  onLayers: (l: MapLayers) => void;
}

type Mode = DrawMode;

interface Drag {
  uid: string;
  index: number;
  insert: boolean;
  start: { x: number; y: number };
  moved: boolean;
  /** Route before the drag. */
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
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/** Second line of the snap tooltip; says when a nearby point was passed over for the aerodrome. */
function snapDetail(hit: SnapHit): string {
  if (!hit.shadowed) return hit.cand.detail;
  const nm = distanceNm(hit.cand, hit.shadowed);
  return `${hit.cand.detail} · ${hit.shadowed.name} (${nm.toFixed(1)} NM away): zoom in to pick it`;
}

/** MC/distance read-out for a leg being drawn. */
function legReadout(a: LatLon, b: LatLon, date: string): string {
  const d = distanceNm(a, b);
  if (d < 0.05) return '';
  const mid = midpoint(a, b);
  const mc = norm360(
    trueCourse(a, b) - magneticVariation(mid.lat, mid.lon, date || new Date().toISOString().slice(0, 10)),
  );
  return `${fmtCourse(mc)}  ${fmtDistance(d)}`;
}

/** What a leg label shows (it is re-rendered when this changes). */
function labelKey(
  leg: { mcMag: number; distNm: number },
  alt: LegAltitude | undefined,
  haz: LegHazards | undefined,
): string {
  const altFt = alt?.altFt ?? NaN;
  return `${fmtCourse(leg.mcMag)}|${fmtDistance(leg.distNm)}|${fmtAltitude(altFt)}|${alt?.overridden ? 1 : 0}|${alt?.source ?? ''}|${haz ? haz.level + ':' + haz.labels.join(';') : ''}`;
}

export function RouteMap(props: RouteMapProps) {
  const { route, date, altitudes, refData, waypoints } = props;
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const [prefs, setPrefs] = useState(loadPrefs);
  const layers = props.layers;
  const [layersOpen, setLayersOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (route.length < 2 || isBareRoundTrip(route) ? 'draw' : 'idle'));
  /** Drawing appends after the last point even on a round trip ("Continue drawing" on it). */
  const [toEnd, setToEnd] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoutePoint[] | null>(null);
  const [prompt, setPrompt] = useState<NamePrompt | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  /** Airspaces under the cursor (idle mode), smallest first. */
  const [airTip, setAirTip] = useState<{ x: number; y: number; items: AirspaceInfo[] } | null>(null);
  /** Weather hazard texts under the cursor (idle mode). */
  const [wxTip, setWxTip] = useState<{
    x: number;
    y: number;
    items: { level: 'danger' | 'warn'; label: string }[];
  } | null>(null);
  /** Airspace details opened by a click. */
  const [airPop, setAirPop] = useState<{ x: number; y: number; items: AirspaceInfo[] } | null>(null);
  /** NOTAM areas under the cursor (keys, smallest first) and the NOTAM details opened by a click. */
  const [notamTip, setNotamTip] = useState<{ x: number; y: number; keys: string[] } | null>(null);
  const [notamPop, setNotamPop] = useState<{ x: number; y: number; keys: string[] } | null>(null);
  /** Aerodrome under the cursor (idle mode) and the aerodrome details opened by a click. */
  const [adTip, setAdTip] = useState<{ x: number; y: number; a: RefAerodrome } | null>(null);
  const [adPop, setAdPop] = useState<{ x: number; y: number; a: RefAerodrome } | null>(null);
  const [editingLeg, setEditingLeg] = useState<string | null>(null);
  /** The cursor is near the hint bubble: it fades out so it never hides what the pilot points at. */
  const hintEl = useRef<HTMLDivElement>(null);
  const [hintAway, setHintAway] = useState(false);

  const shown = draft ?? route;
  const legs = useMemo(() => buildLegs(shown, date), [shown, date]);
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
  const allInfos = useMemo(
    () => airspaceInfos(refData.airspaces, refData.adAirspaces ?? [], refData.areas ?? []),
    [refData],
  );
  const airInfos = useMemo(() => allInfos.filter((a) => airspaceShown(layers, a.type)), [allInfos, layers]);
  const areaCount = useMemo(() => {
    const n = { prd: 0, mil: 0, act: 0 };
    for (const a of allInfos) if (isArea(a.type)) n[areaToggle(a.type)]++;
    return n;
  }, [allInfos]);
  const live = useRef({
    props,
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
  });
  live.current = {
    props,
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
  };
  const drag = useRef<Drag | null>(null);
  const cancelDragRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);

  // ---------------------------------------------------------------------------------- map setup
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
    m.on('load', () => {
      addSymbols(m);
      const { refData: r, waypoints: w } = live.current.props;
      const variation = magneticVariation(38, 24, new Date().toISOString().slice(0, 10));
      setData(m, 'airspaces', airspaceFeatures(r.airspaces));
      setData(m, 'zones', zoneFeatures(allInfos));
      setData(m, 'areas', areaFeatures(live.current.airInfos));
      setData(m, 'fir', firFeatures(r.fir));
      setData(m, 'vfr-routes', vfrRouteFeatures(r.vfrRoutes, r.vfrPoints));
      setData(m, 'vfr-points', vfrPointFeatures(r.vfrPoints));
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

  // ------------------------------------------------------------------------------- layer prefs
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

  // ---------------------------------------------------------------------------- weather hazards
  const hazardMarks = props.hazards;
  useEffect(() => {
    const m = mapRef.current;
    if (m && loaded) setHazardLayer(m, hazardMarks ?? [], 'route-casing');
  }, [hazardMarks, loaded]);

  // ---------------------------------------------------------------------------------- NOTAMs
  const notamList = props.notams;
  const notamMarks = useMemo(() => mapNotams(notamList ?? []), [notamList]);
  const notamLive = useRef<{ marks: MapNotam[]; pop: boolean }>({ marks: [], pop: false });
  notamLive.current = { marks: layers.notams ? notamMarks : [], pop: !!notamPop };
  useEffect(() => {
    const m = mapRef.current;
    if (m && loaded) setNotamLayer(m, notamMarks, props.selectedNotam ?? null, layers.notams, 'route-casing');
  }, [notamMarks, props.selectedNotam, layers.notams, loaded]);
  // a NOTAM picked in the panel: bring its area into view
  const selectedNotam = props.selectedNotam ?? null;
  const showNotam = useEffectEvent((key: string | null) => {
    const m = mapRef.current;
    const mk = key && layers.notams ? notamMarks.find((n) => n.key === key) : undefined;
    if (!m || !loaded || !mk) return;
    const view = m.getBounds();
    if (mk.ring.some((c) => view.contains(c))) return;
    const b = new maplibregl.LngLatBounds();
    for (const c of mk.ring) b.extend(c);
    m.fitBounds(b, { padding: 80, maxZoom: Math.max(m.getZoom(), 8) });
  });
  useEffect(() => showNotam(selectedNotam), [selectedNotam, loaded]);
  const notamsOf = (keys: string[]) =>
    keys.map((k) => (notamList ?? []).find((n) => n.key === k)).filter((n): n is Notam => !!n);

  // ------------------------------------------------------------------------------ route layers
  const drawing = mode !== 'idle';
  /** The route point under the cursor (idle mode): its index, which is its feature id (generateId). */
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
    if (!layers.notams) {
      setNotamTip(null);
      setNotamPop(null);
    }
  }, [layers.notams]);

  // The route may shrink below 2 points from elsewhere (undo, panel): offer drawing again.
  useEffect(() => {
    if (route.length === 0 && mode === 'idle') setMode('draw');
    if (selected && !route.some((p) => p.uid === selected)) setSelected(null);
  }, [route, mode, selected]);

  // ------------------------------------------------------------------------------- leg labels
  // (none while a point is dragged: the hazards belong to the legs before the drag)
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

  /** Rotate/offset/size the labels of these legs (all when omitted). */
  const layoutLabels = useCallback(
    (only?: Set<string>) => {
      const m = mapRef.current;
      if (!m) return;
      for (const leg of legs) {
        if (only && !only.has(leg.key)) continue;
        const rec = markers.current.get(leg.key);
        if (!rec) continue;
        const a = m.project([leg.from.lon, leg.from.lat]);
        const b = m.project([leg.to.lon, leg.to.lat]);
        const pl = placeLabel(a, b);
        const editing = live.current.editingLeg === leg.key;
        const lm = editing ? 'full' : labelMode(pl.lengthPx);
        rec.el.dataset.mode = lm;
        // distance from the line to the label's centre: half the label's height plus a small gap
        const off = lm === 'compact' ? 21 : 17;
        const k = off * pl.side;
        rec.inner.style.transform = `translate(${(pl.normal.x * k).toFixed(1)}px, ${(pl.normal.y * k).toFixed(1)}px) rotate(${pl.angleDeg.toFixed(1)}deg)`;
      }
    },
    [legs],
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
  }, [legs, altitudes, legHazards, loaded, drawing, layoutLabels]);

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
        // weather on this leg: a small badge; its texts show on hover (and in the navlog strip)
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
      'wheel',
      'contextmenu',
    ] as const) {
      node.addEventListener(t, (e) => e.stopPropagation(), { passive: t === 'touchstart' || t === 'wheel' });
    }
  }

  function startAltEdit(key: string) {
    const rec = markers.current.get(key);
    if (!rec) return;
    setEditingLeg(key);
    live.current.editingLeg = key;
    const btn = rec.inner.querySelector('.pgf-leg-alt') as HTMLButtonElement | null;
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
    // force the label effect to redraw labels whose text was reset
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

  // ---------------------------------------------------------------------------------- snapping
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
    // the aerodrome keeps its priority over the route's own copy of the point it shadowed
    const shadowedOwn = !!(
      own &&
      ref?.shadowed &&
      own.cand.lat === ref.shadowed.lat &&
      own.cand.lon === ref.shadowed.lon
    );
    if (own && !shadowedOwn && (!ref || own.distPx <= ref.distPx + ref.cand.penaltyPx)) return own;
    return ref;
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

  // ------------------------------------------------------------------------------- name prompt
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

  // --------------------------------------------------------------------------- map interaction
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
      // idle: hover feedback
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
      // an aerodrome under the cursor: its hours on the flight's date
      const ad = mid === null && !L.airPop && !L.adPop && !notamLive.current.pop ? adAt(e.point, pt) : null;
      setAdTip(ad ? { x: e.point.x, y: e.point.y, a: ad } : null);
      if (ad && pt === null) m.getCanvas().style.cursor = 'pointer';
      // weather hazard bands/rings under the cursor: their texts (they are not printed on the chart)
      const wx =
        pt === null && mid === null && !L.airPop && !ad ? hazardLabelsAt(m, e.point, L.props.hazards ?? []) : [];
      setWxTip(wx.length ? { x: e.point.x, y: e.point.y, items: wx } : null);
      // NOTAM areas under the cursor: ID, validity and limits
      const nk =
        pt === null && mid === null && !ad && !wx.length && !L.airPop && !notamLive.current.pop
          ? notamKeysAt(m, e.point, notamLive.current.marks)
          : [];
      setNotamTip(nk.length ? { x: e.point.x, y: e.point.y, keys: nk } : null);
      // airspace under the cursor: name, class and limits; the smallest one is highlighted
      const air =
        pt === null && mid === null && !ad && !wx.length && !nk.length && !L.airPop
          ? airspacesAt(L.airInfos, e.lngLat.lng, e.lngLat.lat)
          : [];
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
      if (L.mode !== 'idle' || e.originalEvent.button !== 0) return;
      const index = hitPoint(e.point);
      const mid = index === null ? hitMid(e.point) : null;
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

    const onUp = async (ev: MouseEvent) => {
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
      // keep the point selected under its (possibly new) uid
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
        // a click on a charted aerodrome opens its hours (a second click closes them)
        setAdTip(null);
        if (L.adPop) {
          setAdPop(null);
          return;
        }
        const ad = i === null && !L.airPop && !notamLive.current.pop ? adAt(e.point, null) : null;
        if (ad) {
          setAdPop({ x: e.point.x, y: e.point.y, a: ad });
          setNotamTip(null);
          setAirTip(null);
          highlightAirspace(null);
          return;
        }
        // a click on a NOTAM area opens its details (a second click closes them)
        setNotamTip(null);
        if (notamLive.current.pop) {
          setNotamPop(null);
          return;
        }
        const nk = i === null && !L.airPop ? notamKeysAt(m, e.point, notamLive.current.marks) : [];
        if (nk.length) {
          setNotamPop({ x: e.point.x, y: e.point.y, keys: nk });
          L.props.onNotamSelect?.(nk[0]);
          setAirTip(null);
          highlightAirspace(null);
          return;
        }
        // a click on open map shows the airspace there (a second click closes it)
        const air = i === null && !L.airPop ? airspacesAt(L.airInfos, e.lngLat.lng, e.lngLat.lat) : [];
        setAirPop(air.length ? { x: e.point.x, y: e.point.y, items: air } : null);
        setAirTip(null);
        highlightAirspace(air[0] ?? null);
        return;
      }
      const shift = e.originalEvent.shiftKey || L.mode === 'custom';
      // clicking the last point again, the closing point of a round trip (or a double-click) ends drawing
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

    m.on('mousemove', onMove);
    m.on('mousedown', onDown);
    m.on('click', onClick);
    m.on('dblclick', onDbl);
    m.on('contextmenu', onContext);
    m.on('mouseout', onOut);
    return () => {
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

  // ---------------------------------------------------------------------------------- keyboard
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
        else if (L.adPop) setAdPop(null);
        else if (notamLive.current.pop) setNotamPop(null);
        else if (L.airPop) setAirPop(null);
        else if (L.layersOpen) setLayersOpen(false);
        else if (L.menu) setMenu(null);
        else if (L.mode !== 'idle') stopDrawing();
        else if (L.selected) setSelected(null);
        else return;
        e.preventDefault();
      } else if (e.key === 'Enter' && L.mode !== 'idle') {
        e.preventDefault();
        stopDrawing();
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

  // ------------------------------------------------------------------------------- menu actions
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
      const cur = props.requests?.[p.uid];
      const set = (kind: AerodromeRequest['kind'] | null, stopMin?: number) => {
        onRequest(p.uid, kind, stopMin);
        setMenu(null);
      };
      const askStop = () => {
        const v = window.prompt(
          `Intermediate stop at ${p.name}: minutes on the ground`,
          String(cur?.stopMin ?? DEFAULT_STOP_MIN),
        );
        const n = v == null ? NaN : Math.round(Number(v));
        if (isFinite(n) && n > 0) set('stop', n);
      };
      if (cur?.kind === 'touch-and-go')
        items.push({ label: 'Remove touch-and-go request', onSelect: () => set(null), testId: 'menu-tng-remove' });
      else if (requestAllowed(route, idx, 'touch-and-go')) {
        items.push({
          label: idx === 0 ? 'Request touch-and-go before leaving' : 'Request touch-and-go',
          onSelect: () => set('touch-and-go'),
          testId: 'menu-tng',
        });
      }
      if (cur?.kind === 'stop') {
        items.push({ label: `Change stop (${cur.stopMin ?? DEFAULT_STOP_MIN} min)…`, onSelect: askStop });
        items.push({ label: 'Remove stop request', onSelect: () => set(null), testId: 'menu-stop-remove' });
      } else if (requestAllowed(route, idx, 'stop'))
        items.push({ label: 'Request intermediate stop…', onSelect: askStop, testId: 'menu-stop' });
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
    if (route[route.length - 1]?.uid === p.uid) items.push({ label: 'Continue drawing', onSelect: continueFrom });
    items.push({ label: 'Remove point', onSelect: doRemove, danger: true });
    return items;
  };

  // ----------------------------------------------------------------------------------- render
  const closing = mode !== 'idle' && drawIndex(route, toEnd) < route.length ? route[route.length - 1] : null;
  const hint =
    mode === 'custom'
      ? closing
        ? `Click to place a custom point before ${closing.name} and name it · Esc to stop`
        : 'Click to place a custom point and name it · Esc to stop'
      : mode === 'draw'
        ? route.length === 0
          ? 'Click your departure aerodrome to start'
          : closing
            ? `Click to add points before the return to ${closing.name} · Shift-click for a custom point · click ${closing.name}, Enter or Esc to finish`
            : 'Click to add points · Shift-click for a custom point · click the last point, Enter or Esc to finish'
        : route.length >= 2
          ? 'Drag points to move · drag a leg’s middle dot to insert · right-click a point for options · click an altitude to edit'
          : '';

  return (
    <div className="pgf-map" data-testid="map" data-ready={loaded ? '1' : undefined}>
      <div ref={el} className="pgf-map-canvas" />
      {failed && <div className="pgf-map-failed">{failed}</div>}

      {!failed && (
        <MapToolbar
          mode={mode}
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

      {wxTip && !airPop && !hover && mode === 'idle' && (
        <MapTip x={wxTip.x} y={wxTip.y} className="pgf-snap-tip pgf-wx-tip" testId="hazard-tip">
          {wxTip.items.map((h) => (
            <span key={h.label} className={'is-' + h.level}>
              {h.label}
            </span>
          ))}
        </MapTip>
      )}
      {notamTip && !notamPop && !airPop && !hover && mode === 'idle' && (
        <NotamTip x={notamTip.x} y={notamTip.y} items={notamsOf(notamTip.keys)} />
      )}
      {notamPop && notamsOf(notamPop.keys).length > 0 && (
        <NotamPopover
          x={notamPop.x}
          y={notamPop.y}
          items={notamsOf(notamPop.keys)}
          legName={(i) => (legs[i] ? `${legs[i].from.name} → ${legs[i].to.name}` : '')}
          onOpen={(k) => props.onNotamSelect?.(k)}
          onClose={() => setNotamPop(null)}
        />
      )}
      {airTip && !airPop && !hover && mode === 'idle' && <AirspaceTip x={airTip.x} y={airTip.y} items={airTip.items} />}
      {adTip && !adPop && !airPop && !notamPop && !hover && !menu && mode === 'idle' && props.aerodromeInfo && (
        <AerodromeTip x={adTip.x} y={adTip.y} a={adTip.a} info={props.aerodromeInfo(adTip.a)} />
      )}
      {adPop && props.aerodromeInfo && (
        <AerodromePopover
          x={adPop.x}
          y={adPop.y}
          a={adPop.a}
          info={props.aerodromeInfo(adPop.a)}
          airac={refData.airac.id}
          onClose={() => setAdPop(null)}
        />
      )}
      {airPop && (
        <AirspacePopover
          x={airPop.x}
          y={airPop.y}
          items={airPop.items}
          airac={refData.airac.id}
          onClose={() => setAirPop(null)}
        />
      )}

      {prompt && <NameBox prompt={prompt} />}

      {menu && menuPoint && (
        <PointMenu
          x={menu.x}
          y={menu.y}
          title={menuPoint.name}
          detail={KIND_LABEL[menuPoint.kind]}
          items={menuItems(menuPoint)}
          error={saveErr}
        />
      )}
    </div>
  );
}

const KIND_LABEL: Record<RoutePoint['kind'], string> = {
  aerodrome: 'aerodrome',
  vfr: 'VFR reporting point',
  waypoint: 'my waypoint',
  custom: 'custom point',
};

export type { SnapCandidate };
