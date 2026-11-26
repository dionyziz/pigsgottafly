// Editor state shared by the map (map/**), the panels (panels/**) and EditorPage: the flight
// document, undo/redo, debounced offline-tolerant saving, and derived geometry.
//
// SHARED CONTRACT (frozen until integration): map and panels read everything through useEditor()
// and change the flight only through update().
//
// A flight shared with the pilot (Flight.access): it is computed with its owner's details, settings
// and aircraft (flightPilot, withFlightAircraft). A viewer's editor is read-only: update() and the
// other changes do nothing (the map's layers change on screen only) and `readOnly` tells the panels
// (Section disables its controls) and the map (no route editing) to offer no edits.
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type AltitudeDefault, buildLegs, defaultAltitudes, type LegGeometry } from '../../calc';
import { flightStore, type SaveStatus } from '../../data/flightStore';
import { refOfFlight } from '../../data/ref';
import { FlightRefProvider } from '../../data/refContext';
import { useTerrain } from '../../data/terrain';
import type { Aircraft, Flight, FlightDoc, MapLayers, Passenger, Pilot, RefBundle, Waypoint } from '../../shared';
import { autoTitle, EMPTY_SUMMARY, requestTiming } from '../../shared';
import { flightPilot, withFlightAircraft } from '../../shared/sharing';

export interface EditorValue {
  flight: Flight;
  doc: FlightDoc;
  /**
   * Change the flight. Every call is one undo step, except consecutive calls with the same
   * `coalesce` key within 1.5 s (e.g. typing in one field, dragging one point).
   */
  update: (fn: (d: FlightDoc) => FlightDoc, opts?: { coalesce?: string }) => void;
  /**
   * Set derived summary values (navlog ETE and fuel for the lobby). Saved with the flight, but not
   * an undo step and never a reason for a save on its own if nothing changed.
   */
  setDerived: (v: { eteMin: number | null; fuelL: number | null }) => void;
  /** The map's layer selection (options.mapLayers): saved with the flight, not an undo step (undo/redo keep it). */
  setMapLayers: (l: MapLayers) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;
  /** A flight shared with the pilot as a viewer: nothing can be changed (update() does nothing). */
  readOnly: boolean;

  /** The session pilot; on a shared flight with its owner's details and settings (flightPilot). */
  pilot: Pilot;
  /** The pilot's hangar (and a shared flight's aircraft), passengers and saved waypoints (reload after creating one). */
  hangar: Aircraft[];
  passengers: Passenger[];
  waypoints: Waypoint[];
  /** The passenger list was fetched (false: it failed to load, `passengers` is empty for that reason). */
  passengersLoaded: boolean;
  reloadLists: () => Promise<void>;
  aircraft: Aircraft | null;
  /** Reference data (current AIRAC, shipped with the client). */
  ref: RefBundle;

  /** Leg geometry of doc.route (TC, distance, variation, MC). */
  legs: LegGeometry[];
  /** Default altitude of each leg (before overrides). */
  altitudeDefaults: AltitudeDefault[];
  /** Effective altitude of each leg: override ?? default (NaN = unknown). */
  altitudesFt: number[];
}

export const EditorContext = createContext<EditorValue | null>(null);
export function useEditor(): EditorValue {
  const v = use(EditorContext);
  if (!v) throw new Error('useEditor outside <EditorProvider>');
  return v;
}

/** Summary fields the lobby shows; distance/time/fuel come from the navlog when available. */
export function summaryOf(
  doc: FlightDoc,
  aircraft: Aircraft | null,
  legs: LegGeometry[],
  navlog?: { eteMin: number; fuelL: number } | null,
) {
  return {
    ...EMPTY_SUMMARY,
    title: doc.title.trim() || autoTitle(doc),
    date: doc.date,
    blockOff: doc.blockOff,
    aircraft: aircraft?.registration ?? '',
    route: doc.route.map((p) => [+p.lat.toFixed(3), +p.lon.toFixed(3)] as [number, number]),
    from: doc.route[0]?.name ?? '',
    to: doc.route.length > 1 ? doc.route[doc.route.length - 1].name : '',
    distNm: legs.length ? legs.reduce((s, l) => s + Math.round(l.distNm), 0) : null,
    eteMin: navlog ? navlog.eteMin : null,
    fuelL: navlog ? navlog.fuelL : null,
  };
}

interface Props {
  flight: Flight;
  initialDoc: FlightDoc;
  pilot: Pilot;
  hangar: Aircraft[];
  passengers: Passenger[];
  waypoints: Waypoint[];
  passengersLoaded?: boolean;
  reloadLists: () => Promise<void>;
  children: ReactNode;
}

export function EditorProvider({
  flight,
  initialDoc,
  pilot: sessionPilot,
  hangar: ownHangar,
  passengers,
  waypoints,
  passengersLoaded = true,
  reloadLists,
  children,
}: Props) {
  const readOnly = flight.access?.role === 'view';
  const pilot = useMemo(() => flightPilot(sessionPilot, flight), [sessionPilot, flight]);
  const hangar = useMemo(() => withFlightAircraft(ownHangar, flight), [ownHangar, flight]);
  const [doc, setDoc] = useState<FlightDoc>(initialDoc);
  const hist = useRef({ past: [] as FlightDoc[], future: [] as FlightDoc[], key: '', t: 0 });
  const [, bump] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(flightStore.status);
  useEffect(() => flightStore.onStatus(setSaveStatus), []);

  const aircraft = useMemo(() => hangar.find((a) => a.id === doc.aircraftId) ?? null, [hangar, doc.aircraftId]);
  const legs = useMemo(() => buildLegs(doc.route, doc.date), [doc.route, doc.date]);
  const overrides = useMemo(() => legs.map((l) => doc.legOverrides[l.key]?.altFt), [legs, doc.legOverrides]);
  const circuitMin = pilot.settings.circuitMin;
  const requestTimes = useMemo(
    () => requestTiming(doc.route, doc.options, circuitMin),
    [doc.route, doc.options, circuitMin],
  );
  const terrain = useTerrain();
  const ref = useMemo(() => refOfFlight(doc.date).ref, [doc.date]);
  const altitudeDefaults = useMemo(
    () =>
      defaultAltitudes(
        doc.route,
        {
          aerodromes: ref.aerodromes,
          vfrPoints: ref.vfrPoints,
          vfrRoutes: ref.vfrRoutes,
          terrain,
          layers: doc.options.mapLayers,
        },
        overrides,
        requestTimes.patternPoints,
      ),
    [doc.route, ref, overrides, requestTimes, terrain, doc.options.mapLayers],
  );
  const altitudesFt = useMemo(
    () => altitudeDefaults.map((d, i) => overrides[i] ?? d.altFt),
    [altitudeDefaults, overrides],
  );

  // The current doc mirrored in a ref so updates compose synchronously and side effects (history,
  // saving) stay out of React state updaters (which StrictMode runs twice).
  const docRef = useRef(doc);
  const commit = useCallback(
    (next: FlightDoc) => {
      docRef.current = next;
      setDoc(next);
      flightStore.save(flight.id, next);
      bump((x) => x + 1);
    },
    [flight.id],
  );

  const update = useCallback<EditorValue['update']>(
    (fn, opts) => {
      if (readOnly) return;
      const cur = docRef.current;
      const raw = fn(cur);
      if (raw === cur) return;
      const h = hist.current;
      const now = Date.now();
      if (!(opts?.coalesce && opts.coalesce === h.key && now - h.t < 1500)) {
        h.past.push(cur);
        if (h.past.length > 300) h.past.shift();
      }
      h.future = [];
      h.key = opts?.coalesce ?? '';
      h.t = now;
      const ac = hangar.find((a) => a.id === raw.aircraftId) ?? null;
      const sum = summaryOf(raw, ac, buildLegs(raw.route, raw.date));
      commit({ ...raw, summary: { ...sum, eteMin: raw.summary.eteMin, fuelL: raw.summary.fuelL } });
    },
    [commit, hangar, readOnly],
  );

  const setDerived = useCallback<EditorValue['setDerived']>(
    ({ eteMin, fuelL }) => {
      if (readOnly) return;
      const cur = docRef.current;
      // recompute the whole summary from the current document, so it can never lag behind the route
      const ac = hangar.find((a) => a.id === cur.aircraftId) ?? null;
      const summary = { ...summaryOf(cur, ac, buildLegs(cur.route, cur.date)), eteMin, fuelL };
      if (JSON.stringify(summary) === JSON.stringify(cur.summary)) return;
      const next = { ...cur, summary };
      // history entries keep their own summaries; the next recompute fixes them up after undo/redo
      docRef.current = next;
      setDoc(next);
      flightStore.save(flight.id, next);
    },
    [flight.id, hangar, readOnly],
  );

  const setMapLayers = useCallback(
    (mapLayers: MapLayers) => {
      const cur = docRef.current;
      const next = { ...cur, options: { ...cur.options, mapLayers } };
      docRef.current = next;
      setDoc(next);
      if (!readOnly) flightStore.save(flight.id, next);
    },
    [flight.id, readOnly],
  );
  /** A history entry with the current map layers (they are not part of undo). */
  const withView = (d: FlightDoc): FlightDoc => {
    const l = docRef.current.options.mapLayers;
    return l === d.options.mapLayers ? d : { ...d, options: { ...d.options, mapLayers: l } };
  };

  const undo = useCallback(() => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(docRef.current);
    h.key = '';
    commit(withView(prev));
  }, [commit]);
  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(docRef.current);
    h.key = '';
    commit(withView(next));
  }, [commit]);

  const value: EditorValue = {
    flight,
    doc,
    update,
    setDerived,
    setMapLayers,
    undo,
    redo,
    canUndo: hist.current.past.length > 0,
    canRedo: hist.current.future.length > 0,
    saveStatus,
    readOnly,
    pilot,
    hangar,
    passengers,
    waypoints,
    passengersLoaded,
    reloadLists,
    aircraft,
    ref,
    legs,
    altitudeDefaults,
    altitudesFt,
  };
  return (
    <EditorContext value={value}>
      <FlightRefProvider date={doc.date}>{children}</FlightRefProvider>
    </EditorContext>
  );
}
