// The route map: a controlled MapLibre component. It draws the VFR-chart layers and the route, and
// reports edits through callbacks; it never changes the flight itself. MapView (./MapView.tsx)
// binds it to the editor state (useEditor().update).
//
// Interaction
//   Draw mode (toolbar "Draw", or automatically while the route has < 2 points): click adds a point,
//   snapping to the nearest aerodrome / VFR point / my waypoint / route point within ~12 px.
//   Clicking empty map (or Shift-click anywhere, or "Custom point" mode) places a custom point and
//   asks its name. Click the last point, double-click, Enter or Esc to stop. Backspace removes the
//   last point while drawing.
//   Edit mode: drag a point (snaps; Shift = no snap); drag a leg's middle handle to insert a point;
//   click a point to select it, Backspace/Delete removes it, right-click for more.
//   Leg labels: magnetic course and distance (read-only), altitude (click to edit; Enter/Esc).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import type { LatLon, RoutePoint, Waypoint } from '../../../shared';
import type { RefBundle } from '../../../shared/ref';
import { uid as newUid } from '../../../shared';
import { buildLegs, distanceNm, magneticVariation, midpoint, norm360, trueCourse, type AltitudeDefault } from '../../../calc';
import {
  airspaceFeatures, aerodromeFeatures, fisFeatures, midpointFeatures, routeLineFeatures, routePointFeatures,
  vfrPointFeatures, vfrRouteFeatures, waypointFeatures, zoneFeatures,
} from './features';
import { fmtAltitude, fmtCourse, fmtDistance, labelMode, parseAltitudeInput, placeLabel } from './labels';
import {
  autoWaypointName, buildCandidates, cleanWaypointName, findSnap, pointFromCandidate, routeCandidates,
  SNAP_RADIUS_PX, type SnapCandidate, type SnapHit,
} from './snap';
import { appendPoint, insertPoint, mercatorMid, removePoint, renamePoint, replacePoint } from './routeEdit';
import { addSymbols } from './symbols';
import { BASE_MAPS, buildStyle, CHART_LAYER_IDS, LGGG_BOUNDS, loadVectorBase, type BaseLayers, type BaseMapId, type DataSourceId } from './style';
import './map.css';

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
  onRouteChange(route: RoutePoint[], opts?: { coalesce?: string }): void;
  /** null = remove the override (back to the default). */
  onAltitudeChange(legKey: string, altFt: number | null): void;
  /** A custom point was named and placed (informational). */
  onCustomWaypoint?(p: RoutePoint): void;
  /** "Save to my waypoints" on a custom point; resolves when saved. */
  onSaveWaypoint?(p: RoutePoint): Promise<void>;
  onUndo?(): void;
  onRedo?(): void;
  canUndo?: boolean;
  canRedo?: boolean;
}

type Mode = 'idle' | 'draw' | 'custom';

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

interface NamePrompt {
  x: number;
  y: number;
  title: string;
  value: string;
  confirm(name: string): void;
  cancel(): void;
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

const PREFS_KEY = 'pgf:map';
function loadPrefs(): { base: BaseMapId; ofm: boolean; chart: boolean } {
  const def = { base: 'light' as BaseMapId, ofm: false, chart: true };
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (v && BASE_MAPS.some((b) => b.id === v.base)) return { base: v.base, ofm: !!v.ofm, chart: v.chart !== false };
  } catch { /* storage unavailable */ }
  return def;
}
function savePrefs(p: { base: BaseMapId; ofm: boolean; chart: boolean }) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

function setData(map: MlMap, id: DataSourceId, data: unknown) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/** MC/distance read-out for a leg being drawn. */
function legReadout(a: LatLon, b: LatLon, date: string): string {
  const d = distanceNm(a, b);
  if (d < 0.05) return '';
  const mid = midpoint(a, b);
  const mc = norm360(trueCourse(a, b) - magneticVariation(mid.lat, mid.lon, date || new Date().toISOString().slice(0, 10)));
  return `${fmtCourse(mc)}  ${fmtDistance(d)}`;
}

export function RouteMap(props: RouteMapProps) {
  const { route, date, altitudes, refData, waypoints, home } = props;
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const [prefs, setPrefs] = useState(loadPrefs);
  const [layersOpen, setLayersOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (route.length < 2 ? 'draw' : 'idle'));
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoutePoint[] | null>(null);
  const [prompt, setPrompt] = useState<NamePrompt | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [editingLeg, setEditingLeg] = useState<string | null>(null);

  const shown = draft ?? route;
  const legs = useMemo(() => buildLegs(shown, date), [shown, date]);
  const candidates = useMemo(() => buildCandidates(refData.aerodromes, refData.vfrPoints, waypoints), [refData, waypoints]);

  // Everything the (once-bound) map handlers read.
  const live = useRef({ props, mode, route, shown, candidates, selected, prompt, menu, editingLeg });
  live.current = { props, mode, route, shown, candidates, selected, prompt, menu, editingLeg };
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);

  // ---------------------------------------------------------------------------------- map setup
  const baseLayers = useRef<BaseLayers | null>(null);
  useEffect(() => {
    let cancelled = false;
    let m: MlMap | null = null;
    void loadVectorBase().then((vector) => {
      if (cancelled || !el.current) return;
      const built = buildStyle(prefs.base, prefs.ofm, vector);
      baseLayers.current = built.baseLayers;
      m = createMap(el.current, built.style);
    });
    return () => {
      cancelled = true;
      m?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setData(m, 'zones', zoneFeatures(r.aerodromes));
      setData(m, 'fis', fisFeatures(r.fis));
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
    if (route.length === 1) { m.easeTo({ center: [route[0].lon, route[0].lat], zoom: Math.max(m.getZoom(), 9) }); return; }
    const b = new maplibregl.LngLatBounds();
    for (const q of route) b.extend([q.lon, q.lat]);
    m.fitBounds(b, { padding: 90, maxZoom: 11 });
  }, [route]);

  // ------------------------------------------------------------------------------- layer prefs
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    const bl = baseLayers.current;
    if (bl) for (const b of BASE_MAPS) for (const l of bl[b.id]) if (m.getLayer(l.id)) m.setLayoutProperty(l.id, 'visibility', b.id === prefs.base && l.visible ? 'visible' : 'none');
    m.setLayoutProperty('ofm', 'visibility', prefs.ofm ? 'visible' : 'none');
    for (const id of CHART_LAYER_IDS) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', prefs.chart ? 'visible' : 'none');
    savePrefs(prefs);
  }, [prefs, loaded]);

  useEffect(() => {
    const m = mapRef.current;
    if (m && loaded) setData(m, 'waypoints', waypointFeatures(waypoints));
  }, [waypoints, loaded]);

  // ------------------------------------------------------------------------------ route layers
  const drawing = mode !== 'idle';
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    setData(m, 'route-line', routeLineFeatures(shown));
    setData(m, 'route-points', routePointFeatures(shown, selected));
    setData(m, 'route-mid', drawing || draft ? EMPTY : midpointFeatures(shown));
  }, [shown, selected, loaded, drawing, draft]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    if (!drawing) { setData(m, 'route-band', EMPTY); setData(m, 'snap', EMPTY); }
    m.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    m.getContainer().classList.toggle('is-drawing', drawing);
  }, [drawing, loaded]);

  // The route may shrink below 2 points from elsewhere (undo, panel): offer drawing again.
  useEffect(() => {
    if (route.length === 0 && mode === 'idle') setMode('draw');
    if (selected && !route.some((p) => p.uid === selected)) setSelected(null);
  }, [route, mode, selected]);

  // ------------------------------------------------------------------------------- leg labels
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement; inner: HTMLDivElement; text: string; at: string }>());

  /** Rotate/offset/size the labels of these legs (all when omitted). */
  const layoutLabels = useCallback((only?: Set<string>) => {
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
      const off = lm === 'full' ? 17 : 15;
      rec.inner.style.transform = `translate(${(pl.normal.x * off).toFixed(1)}px, ${(pl.normal.y * off).toFixed(1)}px) rotate(${pl.angleDeg.toFixed(1)}deg)`;
    }
  }, [legs]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    const keep = new Set<string>();
    const moved = new Set<string>();
    for (const leg of legs) {
      keep.add(leg.key);
      const alt = altitudes[leg.key];
      const altFt = alt?.altFt ?? NaN;
      const text = `${fmtCourse(leg.mcMag)}|${fmtDistance(leg.distNm)}|${fmtAltitude(altFt)}|${alt?.overridden ? 1 : 0}|${alt?.source ?? ''}`;
      let rec = markers.current.get(leg.key);
      if (!rec) {
        const elx = document.createElement('div');
        elx.className = 'pgf-leg';
        elx.dataset.testid = 'leg-label';
        elx.dataset.leg = leg.key;
        const inner = document.createElement('div');
        inner.className = 'pgf-leg-inner';
        elx.appendChild(inner);
        const marker = new maplibregl.Marker({ element: elx, anchor: 'center' }).setLngLat(mercatorMid(leg.from, leg.to)).addTo(m);
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
        renderLegLabel(rec.inner, leg.key, leg.mcMag, leg.distNm, altFt, alt);
      }
      rec.el.dataset.drawing = drawing ? '1' : '';
    }
    for (const [k, rec] of markers.current) {
      if (!keep.has(k)) { rec.marker.remove(); markers.current.delete(k); }
    }
    layoutLabels(moved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, altitudes, loaded, drawing, layoutLabels]);

  useEffect(() => () => { for (const r of markers.current.values()) r.marker.remove(); markers.current.clear(); }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    let raf = 0;
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; layoutLabels(); }); };
    m.on('zoom', on);
    m.on('resize', on);
    return () => { m.off('zoom', on); m.off('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, [loaded, layoutLabels]);

  function renderLegLabel(inner: HTMLDivElement, key: string, mc: number, dist: number, altFt: number, alt: LegAltitude | undefined) {
    inner.textContent = '';
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
    btn.title = alt?.overridden
      ? 'Altitude set by you. Click to edit; clear it to go back to the default.'
      : alt?.source === 'vfr-route' ? 'Charted VFR route altitude. Click to edit.'
        : alt?.source === 'closest-route' ? 'Altitude of the closest charted VFR route. Click to edit.'
          : alt?.source === 'pattern' ? 'Pattern altitude of the destination. Click to edit.'
            : !isFinite(altFt) ? 'No default altitude. Click to set one.' : 'Altitude. Click to edit.';
    btn.dataset.testid = 'leg-alt';
    stopMapEvents(btn);
    btn.addEventListener('click', (e) => { e.stopPropagation(); startAltEdit(key); });
    inner.append(course, d, btn);
  }

  function stopMapEvents(node: HTMLElement) {
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'touchstart', 'wheel', 'contextmenu'] as const) {
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
    input.setAttribute('aria-label', 'Leg altitude, feet (empty = default)');
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
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else input.classList.remove('is-invalid');
    });
    input.addEventListener('blur', () => {
      // a typo on blur is dropped rather than trapping focus
      const v = parseAltitudeInput(input.value);
      if (typeof v === 'number' && !isFinite(v)) finish(false);
      else finish(true);
    });
    if (btn) btn.replaceWith(input); else rec.inner.appendChild(input);
    rec.el.dataset.mode = 'full';
    rec.el.classList.add('is-editing');
    input.focus();
    input.select();
  }

  // After an edit ends, re-render that label (its text key was reset).
  useEffect(() => {
    if (editingLeg) return;
    for (const rec of markers.current.values()) rec.el.classList.remove('is-editing');
    // force the label effect to redraw labels whose text was reset
    const m = mapRef.current;
    if (!m) return;
    for (const leg of legs) {
      const rec = markers.current.get(leg.key);
      if (rec && rec.text === '') {
        const alt = altitudes[leg.key];
        const altFt = alt?.altFt ?? NaN;
        rec.text = `${fmtCourse(leg.mcMag)}|${fmtDistance(leg.distNm)}|${fmtAltitude(altFt)}|${alt?.overridden ? 1 : 0}|${alt?.source ?? ''}`;
        renderLegLabel(rec.inner, leg.key, leg.mcMag, leg.distNm, altFt, alt);
      }
    }
    layoutLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (own && (!ref || own.distPx <= ref.distPx + ref.cand.penaltyPx)) return own;
    return ref;
  }, []);

  function showSnap(m: MlMap, hit: SnapHit | null) {
    setData(m, 'snap', hit ? { type: 'Feature', geometry: { type: 'Point', coordinates: [hit.cand.lon, hit.cand.lat] }, properties: {} } : EMPTY);
  }

  // ------------------------------------------------------------------------------- name prompt
  const askName = useCallback((at: { x: number; y: number }, title: string, value: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setPrompt({
        x: at.x, y: at.y, title, value,
        confirm: (name) => { setPrompt(null); resolve(name); },
        cancel: () => { setPrompt(null); resolve(null); },
      });
    });
  }, []);

  const placeCustom = useCallback(async (lngLat: { lng: number; lat: number }, at: { x: number; y: number }) => {
    const { route: r, props: p } = live.current;
    const name = await askName(at, 'Name this point', autoWaypointName(r));
    if (!name) return;
    const pt: RoutePoint = { uid: newUid(), kind: 'custom', refId: null, name, lat: +lngLat.lat.toFixed(6), lon: +lngLat.lng.toFixed(6) };
    p.onRouteChange(appendPoint(live.current.route, pt));
    p.onCustomWaypoint?.(pt);
  }, [askName]);

  const stopDrawing = useCallback(() => {
    setMode('idle');
    setHover(null);
    const m = mapRef.current;
    if (m) { setData(m, 'route-band', EMPTY); setData(m, 'snap', EMPTY); }
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
      let best: number | null = null, bd = 10;
      for (let i = r.length - 1; i >= 0; i--) {
        const q = m.project([r[i].lon, r[i].lat]);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) { bd = d; best = i; }
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

    const onMove = (e: MapMouseEvent) => {
      lastMove = e;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (lastMove) handleMove(lastMove); });
    };

    const handleMove = (e: MapMouseEvent) => {
      const L = live.current;
      const shift = e.originalEvent.shiftKey;
      const d = drag.current;
      if (d) {
        if (!d.moved && Math.hypot(e.point.x - d.start.x, e.point.y - d.start.y) < 3) return;
        d.moved = true;
        const hit = shift ? null : snapAt(e.point, d.uid);
        d.hit = hit;
        showSnap(m, hit);
        const moved: RoutePoint = hit
          ? { ...pointFromCandidate(hit.cand, d.uid) }
          : { ...d.orig, uid: d.uid, lat: e.lngLat.lat, lon: e.lngLat.lng, kind: 'custom', refId: null, name: d.orig.name };
        const next = d.base.map((q) => (q.uid === d.uid ? moved : q));
        if (d.insert && !d.base.some((q) => q.uid === d.uid)) next.splice(d.index, 0, moved);
        setDraft(next);
        setHover(hit ? { x: e.point.x, y: e.point.y, name: hit.cand.name, detail: hit.cand.detail, leg: null } : null);
        return;
      }
      if (L.mode !== 'idle') {
        const hit = shift || L.mode === 'custom' ? null : snapAt(e.point);
        showSnap(m, hit);
        const target: LatLon = hit ? hit.cand : { lat: e.lngLat.lat, lon: e.lngLat.lng };
        const last = L.route[L.route.length - 1];
        if (last) {
          setData(m, 'route-band', { type: 'Feature', geometry: { type: 'LineString', coordinates: [[last.lon, last.lat], [target.lon, target.lat]] }, properties: {} });
        }
        const custom = !hit;
        setHover({
          x: e.point.x, y: e.point.y,
          name: hit ? hit.cand.name : null,
          detail: hit ? hit.cand.detail : custom ? (L.route.length ? 'Custom point: click and name it' : 'Click to start at a custom point') : null,
          leg: last ? legReadout(last, target, L.props.date) : null,
        });
        return;
      }
      // idle: hover feedback
      const pt = hitPoint(e.point);
      const mid = pt === null ? hitMid(e.point) : null;
      if (hoverMid !== undefined && mid !== hoverMid) { m.setFeatureState({ source: 'route-mid', id: hoverMid }, { hover: false }); hoverMid = undefined; }
      if (mid !== null) { hoverMid = mid; m.setFeatureState({ source: 'route-mid', id: mid }, { hover: true }); }
      m.getCanvas().style.cursor = pt !== null ? 'grab' : mid !== null ? 'copy' : '';
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
        drag.current = { uid, index, insert: false, start: { x: e.point.x, y: e.point.y }, moved: false, base: L.route, orig: L.route[index], hit: null };
      } else if (mid !== null) {
        const leg = mid;
        e.preventDefault();
        const uid = newUid();
        const ll = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        drag.current = {
          uid, index: leg + 1, insert: true, start: { x: e.point.x, y: e.point.y }, moved: false, base: L.route,
          orig: { uid, kind: 'custom', refId: null, name: autoWaypointName(L.route), ...ll }, hit: null,
        };
      } else return;
      m.getCanvas().style.cursor = 'grabbing';
      window.addEventListener('mouseup', onUp, { once: true });
    };

    const onUp = async (ev: MouseEvent) => {
      const d = drag.current;
      drag.current = null;
      m.getCanvas().style.cursor = '';
      showSnap(m, null);
      setHover(null);
      if (!d) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      if (!d.moved) { setDraft(null); return; }
      const L = live.current;
      const rect = m.getContainer().getBoundingClientRect();
      const at = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      const ll = m.unproject([at.x, at.y]);
      let point: RoutePoint;
      if (d.hit) point = pointFromCandidate(d.hit.cand, d.uid);
      else {
        let name = d.orig.kind === 'custom' && !d.insert ? d.orig.name : '';
        if (!name) {
          const asked = await askName(at, d.insert ? 'Name the new point' : 'Name this point', autoWaypointName(L.route));
          if (!asked) { setDraft(null); return; }
          name = asked;
        }
        point = { uid: d.uid, kind: 'custom', refId: null, name, lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6) };
      }
      const base = live.current.route;
      const next = d.insert ? insertPoint(base, d.index, point) : replacePoint(base, d.uid, point);
      setDraft(null);
      live.current.props.onRouteChange(next);
      if (point.kind === 'custom' && (d.insert || d.orig.kind !== 'custom')) live.current.props.onCustomWaypoint?.(point);
    };

    const onClick = (e: MapMouseEvent) => {
      if (suppressClick.current) return;
      const L = live.current;
      setMenu(null);
      if (L.prompt) { L.prompt.cancel(); return; }
      if (L.mode === 'idle') {
        const i = hitPoint(e.point);
        setSelected(i === null ? null : L.route[i].uid);
        return;
      }
      const shift = e.originalEvent.shiftKey || L.mode === 'custom';
      // clicking the last point again (or a double-click) ends drawing
      const last = L.route[L.route.length - 1];
      if (last && L.route.length >= 2) {
        const lp = m.project([last.lon, last.lat]);
        if (Math.hypot(lp.x - e.point.x, lp.y - e.point.y) <= 8) { stopDrawing(); return; }
      }
      const hit = shift ? null : snapAt(e.point);
      if (hit) {
        if (last && hit.cand.lat === last.lat && hit.cand.lon === last.lon) return;
        L.props.onRouteChange(appendPoint(L.route, pointFromCandidate(hit.cand, newUid())));
        return;
      }
      void placeCustom(e.lngLat, { x: e.point.x, y: e.point.y });
    };

    const onDbl = (e: MapMouseEvent) => {
      if (live.current.mode !== 'idle') { e.preventDefault(); stopDrawing(); }
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

    const onOut = () => { if (!drag.current) { setHover(null); if (live.current.mode !== 'idle') { setData(m, 'route-band', EMPTY); showSnap(m, null); } } };

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
      window.removeEventListener('mouseup', onUp);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [loaded, snapAt, placeCustom, stopDrawing, askName]);

  // ---------------------------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const L = live.current;
      if (e.key === 'Escape') {
        if (L.menu) setMenu(null);
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
          L.props.onRouteChange(L.route.slice(0, -1));
        }
      } else if (e.key === 'd' || e.key === 'D') {
        setMode((m) => (m === 'draw' ? 'idle' : 'draw'));
      } else if (e.key === 'w' || e.key === 'W') {
        setMode((m) => (m === 'custom' ? 'idle' : 'custom'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stopDrawing]);

  // ------------------------------------------------------------------------------- menu actions
  const menuPoint = menu ? route.find((p) => p.uid === menu.uid) ?? null : null;
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
    setMode('draw');
  };

  // ----------------------------------------------------------------------------------- render
  const hint = mode === 'custom'
    ? 'Click to place a custom point and name it · Esc to stop'
    : mode === 'draw'
      ? route.length === 0
        ? 'Click your departure aerodrome to start · points snap to aerodromes, VFR points and your waypoints'
        : 'Click to add points (they snap) · Shift-click for a custom point · click the last point, Enter or Esc to finish'
      : route.length >= 2
        ? 'Drag points to move · drag a leg’s middle dot to insert · right-click a point for options · click an altitude to edit'
        : '';

  return (
    <div className="pgf-map" data-testid="map" data-ready={loaded ? '1' : undefined}>
      <div ref={el} className="pgf-map-canvas" />
      {failed && <div className="pgf-map-failed">{failed}</div>}

      {!failed && (
        <div className="pgf-map-toolbar" role="toolbar" aria-label="Route tools">
          <ToolButton active={mode === 'draw'} onClick={() => setMode(mode === 'draw' ? 'idle' : 'draw')} title="Draw route (D)" testid="map-draw">
            <IconPen /> <span>{route.length ? 'Extend' : 'Draw'}</span>
          </ToolButton>
          <ToolButton active={mode === 'custom'} onClick={() => setMode(mode === 'custom' ? 'idle' : 'custom')} title="Place a custom named point (W, or Shift-click while drawing)" testid="map-custom">
            <IconPin /> <span>Custom point</span>
          </ToolButton>
          <span className="pgf-map-sep" />
          <ToolButton onClick={() => props.onUndo?.()} disabled={!props.canUndo} title="Undo (⌘Z)" testid="map-undo"><IconUndo /></ToolButton>
          <ToolButton onClick={() => props.onRedo?.()} disabled={!props.canRedo} title="Redo (⇧⌘Z)" testid="map-redo"><IconRedo /></ToolButton>
          <span className="pgf-map-sep" />
          <ToolButton onClick={fitRoute} disabled={!route.length} title="Zoom to the route" testid="map-fit"><IconFit /></ToolButton>
        </div>
      )}

      {!failed && (
        <div className="pgf-map-layers">
          <button type="button" className={'pgf-map-btn' + (layersOpen ? ' is-active' : '')} onClick={() => setLayersOpen((v) => !v)} title="Map layers" aria-expanded={layersOpen} data-testid="map-layers">
            <IconLayers />
          </button>
          {layersOpen && (
            <div className="pgf-map-pop" role="dialog" aria-label="Map layers">
              <div className="pgf-map-pop-h">Base map</div>
              <div className="pgf-seg">
                {BASE_MAPS.map((b) => (
                  <button key={b.id} type="button" className={prefs.base === b.id ? 'is-on' : ''} onClick={() => setPrefs({ ...prefs, base: b.id })}>{b.label}</button>
                ))}
              </div>
              <label className="pgf-check"><input type="checkbox" checked={prefs.chart} onChange={(e) => setPrefs({ ...prefs, chart: e.target.checked })} /> Chart layers <span className="muted">AIRAC {refData.airac.id}</span></label>
              <label className="pgf-check"><input type="checkbox" checked={prefs.ofm} onChange={(e) => setPrefs({ ...prefs, ofm: e.target.checked })} /> openflightmaps overlay</label>
              <div className="pgf-legend">
                <span><i className="lg-tma" /> TMA</span><span><i className="lg-mtma" /> MTMA</span><span><i className="lg-zone" /> ATZ</span>
                <span><i className="lg-vfr" /> VFR route</span><span><i className="lg-route" /> Your route</span>
              </div>
            </div>
          )}
        </div>
      )}

      {hint && !failed && <div className="pgf-map-hint" data-testid="map-hint">{hint}</div>}

      {hover && (hover.name || hover.detail || hover.leg) && !prompt && (
        <div className="pgf-snap-tip" style={{ left: hover.x + 16, top: hover.y + 14 }} data-testid="snap-tip">
          {hover.name && <b>{hover.name}</b>}
          {hover.detail && <span className="pgf-snap-detail">{hover.detail}</span>}
          {hover.leg && <span className="pgf-snap-leg">{hover.leg}</span>}
        </div>
      )}

      {prompt && <NameBox prompt={prompt} />}

      {menu && menuPoint && (
        <div className="pgf-menu" style={{ left: menu.x + 6, top: menu.y + 6 }} role="menu" data-testid="point-menu" onMouseDown={(e) => e.stopPropagation()}>
          <div className="pgf-menu-h">{menuPoint.name}<span className="muted"> · {KIND_LABEL[menuPoint.kind]}</span></div>
          {menuPoint.kind === 'custom' && <button type="button" role="menuitem" onClick={doRename}>Rename…</button>}
          {menuPoint.kind === 'custom' && props.onSaveWaypoint && (
            <button type="button" role="menuitem" onClick={doSave} disabled={saving}>{saving ? 'Saving…' : 'Save to my waypoints'}</button>
          )}
          {route[route.length - 1]?.uid === menuPoint.uid && <button type="button" role="menuitem" onClick={continueFrom}>Continue drawing</button>}
          <button type="button" role="menuitem" className="danger" onClick={doRemove}>Remove point</button>
          {saveErr && <div className="pgf-menu-err">{saveErr}</div>}
        </div>
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

function NameBox({ prompt }: { prompt: NamePrompt }) {
  const [value, setValue] = useState(prompt.value);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const submit = () => {
    const n = cleanWaypointName(value);
    if (!n) { setBad(true); ref.current?.focus(); return; }
    prompt.confirm(n);
  };
  return (
    <form
      className="pgf-name"
      style={{ left: prompt.x, top: prompt.y }}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onMouseDown={(e) => e.stopPropagation()}
      data-testid="name-prompt"
    >
      <label htmlFor="pgf-name-input">{prompt.title}</label>
      <div className="pgf-name-row">
        <input
          id="pgf-name-input"
          ref={ref}
          value={value}
          maxLength={24}
          autoComplete="off"
          spellCheck={false}
          className={bad ? 'is-invalid' : ''}
          onChange={(e) => { setValue(e.target.value.toUpperCase()); setBad(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); prompt.cancel(); } }}
        />
        <button type="submit" className="pgf-name-ok">OK</button>
      </div>
      {bad && <div className="pgf-name-err">Letters, digits, spaces and . / _ -</div>}
    </form>
  );
}

function ToolButton({ children, onClick, title, active, disabled, testid }: { children: ReactNode; onClick(): void; title: string; active?: boolean; disabled?: boolean; testid?: string }) {
  return (
    <button type="button" className={'pgf-map-btn' + (active ? ' is-active' : '')} onClick={onClick} title={title} aria-label={title} aria-pressed={active} disabled={disabled} data-testid={testid}>
      {children}
    </button>
  );
}

// Icons (24-unit stroke icons)
const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const IconPen = () => svg(<><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /><path d="M6.5 17.5 10 11l4 2 3.5-6.5" /></>);
const IconPin = () => svg(<><path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21Z" /><path d="M10 10.5h4M12 8.5v4" /></>);
const IconUndo = () => svg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>);
const IconRedo = () => svg(<><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>);
const IconFit = () => svg(<><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><path d="M8.5 15.5 12 9l3.5 6.5" /></>);
const IconLayers = () => svg(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>);

export type { SnapCandidate };
