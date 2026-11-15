// The editor's map slot: binds the controlled <RouteMap> to the editor state. Every edit is one
// update() call (one undo step); leg overrides of legs that no longer exist are dropped with it.
import { useCallback, useMemo } from 'react';
import type { RoutePoint } from '../../../shared';
import { api } from '../../../data/api';
import { aerodrome } from '../../../data/ref';
import { useEditor } from '../state';
import { RouteMap, type LegAltitude } from './RouteMap';
import { pruneOverrides, setAltitudeOverride } from './routeEdit';
import { mapHazards } from './hazardLayer';
import { useFlightCalc } from '../panels/calc';

export function MapView() {
  const { doc, update, undo, redo, canUndo, canRedo, waypoints, ref, legs, altitudeDefaults, altitudesFt, pilot, reloadLists } = useEditor();

  const { hazards } = useFlightCalc();
  const hazardMarks = useMemo(() => mapHazards(hazards, legs), [hazards, legs]);

  const altitudes = useMemo(() => {
    const out: Record<string, LegAltitude> = {};
    legs.forEach((l, i) => {
      out[l.key] = {
        altFt: altitudesFt[i] ?? NaN,
        overridden: doc.legOverrides[l.key]?.altFt !== undefined,
        source: altitudeDefaults[i]?.source ?? 'none',
      };
    });
    return out;
  }, [legs, altitudesFt, altitudeDefaults, doc.legOverrides]);

  const home = useMemo(() => {
    const a = aerodrome(pilot.homeAerodrome);
    return a ? { lat: a.lat, lon: a.lon } : null;
  }, [pilot.homeAerodrome]);

  const onRouteChange = useCallback((route: RoutePoint[], opts?: { coalesce?: string }) => {
    update((d) => ({ ...d, route, legOverrides: pruneOverrides(d.legOverrides, route) }), opts);
  }, [update]);

  const onAltitudeChange = useCallback((key: string, altFt: number | null) => {
    update((d) => {
      const legOverrides = setAltitudeOverride(d.legOverrides, key, altFt);
      return legOverrides === d.legOverrides ? d : { ...d, legOverrides };
    });
  }, [update]);

  const onSaveWaypoint = useCallback(async (p: RoutePoint) => {
    const w = await api.waypoints.create({ name: p.name, lat: p.lat, lon: p.lon, notes: '' });
    await reloadLists();
    update((d) => ({
      ...d,
      route: d.route.map((q) => (q.uid === p.uid ? { ...q, kind: 'waypoint' as const, refId: w.id, name: w.name } : q)),
    }));
  }, [reloadLists, update]);

  return (
    <RouteMap
      route={doc.route}
      date={doc.date}
      altitudes={altitudes}
      refData={ref}
      waypoints={waypoints}
      home={home}
      onRouteChange={onRouteChange}
      onAltitudeChange={onAltitudeChange}
      onSaveWaypoint={onSaveWaypoint}
      onUndo={undo}
      onRedo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
      hazards={hazardMarks}
    />
  );
}
