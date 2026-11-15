// Editor state shared by the map (map/**), the panels (panels/**) and EditorPage: the flight
// document, undo/redo, debounced offline-tolerant saving, and derived geometry.
//
// SHARED CONTRACT (frozen until integration): map and panels read everything through useEditor()
// and change the flight only through update().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Aircraft, Flight, FlightDoc, Passenger, Pilot, RefBundle, Waypoint } from '../../shared';
import { autoTitle, EMPTY_SUMMARY, requestTiming } from '../../shared';
import { buildLegs, defaultAltitudes, type AltitudeDefault, type LegGeometry } from '../../calc';
import { REF } from '../../data/ref';
import { flightStore, type SaveStatus } from '../../data/flightStore';

export interface EditorValue {
  flight: Flight;
  doc: FlightDoc;
  /**
   * Change the flight. Every call is one undo step, except consecutive calls with the same
   * `coalesce` key within 1.5 s (e.g. typing in one field, dragging one point).
   */
  update(fn: (d: FlightDoc) => FlightDoc, opts?: { coalesce?: string }): void;
  /**
   * Set derived summary values (navlog ETE and fuel for the lobby). Saved with the flight, but not
   * an undo step and never a reason for a save on its own if nothing changed.
   */
  setDerived(v: { eteMin: number | null; fuelL: number | null }): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;

  pilot: Pilot;
  /** The pilot's hangar, passengers and saved waypoints (reload after creating one). */
  hangar: Aircraft[];
  passengers: Passenger[];
  waypoints: Waypoint[];
  reloadLists(): Promise<void>;
  /** The flight's aircraft (doc.aircraftId), or null. */
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
  const v = useContext(EditorContext);
  if (!v) throw new Error('useEditor outside <EditorProvider>');
  return v;
}

/** Summary fields the lobby shows; distance/time/fuel come from the navlog when available. */
export function summaryOf(doc: FlightDoc, aircraft: Aircraft | null, legs: LegGeometry[], navlog?: { eteMin: number; fuelL: number } | null) {
  return {
    ...EMPTY_SUMMARY,
    title: doc.title.trim() || autoTitle(doc.route),
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
  reloadLists(): Promise<void>;
  children: ReactNode;
}

export function EditorProvider({ flight, initialDoc, pilot, hangar, passengers, waypoints, reloadLists, children }: Props) {
  const [doc, setDoc] = useState<FlightDoc>(initialDoc);
  const hist = useRef({ past: [] as FlightDoc[], future: [] as FlightDoc[], key: '', t: 0 });
  const [, bump] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(flightStore.status);
  useEffect(() => flightStore.onStatus(setSaveStatus), []);

  const aircraft = useMemo(() => hangar.find((a) => a.id === doc.aircraftId) ?? null, [hangar, doc.aircraftId]);
  const legs = useMemo(() => buildLegs(doc.route, doc.date), [doc.route, doc.date]);
  const overrides = useMemo(() => legs.map((l) => doc.legOverrides[l.key]?.altFt), [legs, doc.legOverrides]);
  const requestTimes = useMemo(() => requestTiming(doc.route, doc.options), [doc.route, doc.options]);
  const altitudeDefaults = useMemo(
    () => defaultAltitudes(doc.route, { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes }, overrides, requestTimes.patternPoints),
    [doc.route, overrides, requestTimes],
  );
  const altitudesFt = useMemo(() => altitudeDefaults.map((d, i) => overrides[i] ?? d.altFt), [altitudeDefaults, overrides]);

  // The current doc mirrored in a ref so updates compose synchronously and side effects (history,
  // saving) stay out of React state updaters (which StrictMode runs twice).
  const docRef = useRef(doc);
  const commit = useCallback((next: FlightDoc) => {
    docRef.current = next;
    setDoc(next);
    flightStore.save(flight.id, next);
    bump((x) => x + 1);
  }, [flight.id]);

  const update = useCallback<EditorValue['update']>((fn, opts) => {
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
  }, [commit, hangar]);

  const setDerived = useCallback<EditorValue['setDerived']>(({ eteMin, fuelL }) => {
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
  }, [flight.id, hangar]);

  const undo = useCallback(() => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(docRef.current);
    h.key = '';
    commit(prev);
  }, [commit]);
  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(docRef.current);
    h.key = '';
    commit(next);
  }, [commit]);

  const value: EditorValue = {
    flight, doc, update, setDerived, undo, redo,
    canUndo: hist.current.past.length > 0, canRedo: hist.current.future.length > 0, saveStatus,
    pilot, hangar, passengers, waypoints, reloadLists, aircraft, ref: REF,
    legs, altitudeDefaults, altitudesFt,
  };
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
