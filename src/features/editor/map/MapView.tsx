// The editor's map slot: binds the controlled <RouteMap> to the editor state. Every edit is one
// update() call (one undo step); leg overrides of legs that no longer exist are dropped with it.
import { useCallback, useMemo } from 'react';
import { setRequest, type AerodromeRequest, type RoutePoint } from '../../../shared';
import { api } from '../../../data/api';
import { aerodrome } from '../../../data/ref';
import { useEditor } from '../state';
import { RouteMap, type LegAltitude } from './RouteMap';
import { flightLayers } from './mapPrefs';
import { pruneOverrides, setAltitudeOverride } from './routeEdit';
import { mapHazards, type MapHazard } from './hazardLayer';
import { AD_ROLE, useFlightCalc } from '../panels/calc';
import { clockZ } from '../../../calc';
import type { RefAerodrome } from '../../../shared/ref';
import { adDayInfo } from '../AerodromeHours';
import { useNotams } from '../notams';
import { visibleNotams } from '../../../data/notams';

export function MapView() {
  const {
    doc,
    update,
    setMapLayers,
    undo,
    redo,
    canUndo,
    canRedo,
    waypoints,
    ref,
    legs,
    altitudeDefaults,
    altitudesFt,
    pilot,
    reloadLists,
  } = useEditor();

  const { hazards, aerodromeChecks, adEffects } = useFlightCalc();
  // weather hazards, and the route's aerodromes that are closed at the planned time (a ring like an aerodrome hazard)
  const hazardMarks = useMemo(() => {
    const out: MapHazard[] = mapHazards(hazards, legs);
    for (const c of aerodromeChecks) {
      if (c.ad.status !== 'closed' || !Number.isFinite(c.fromMs)) continue;
      out.push({
        level: 'danger',
        coords: [[c.aerodrome.lon, c.aerodrome.lat]],
        legIndex: c.pointIndex > 0 ? c.pointIndex - 1 : legs.length ? 0 : null,
        label: `${AD_ROLE[c.role]} ${c.aerodrome.icao || c.aerodrome.name} closed at ${clockZ(c.ad.at)}Z: ${c.ad.why} (${c.ad.source})`,
      });
    }
    return out;
  }, [hazards, legs, aerodromeChecks]);
  // computed once per aerodrome for the date and NOTAMs (the tooltip re-renders on every mouse move)
  const aerodromeInfo = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof adDayInfo>>();
    return (a: RefAerodrome) => {
      let v = cache.get(a.id);
      if (!v) {
        v = adDayInfo(a, doc.date, adEffects);
        cache.set(a.id, v);
      }
      return v;
    };
  }, [doc.date, adEffects]);
  const { briefing, showAll, selected: selectedNotam, select: selectNotam } = useNotams();
  const notams = useMemo(() => visibleNotams(briefing, showAll), [briefing, showAll]);

  const requests = useMemo(() => {
    const out: Record<string, AerodromeRequest> = {};
    for (const r of doc.options.aerodromeRequests ?? []) out[r.pointUid] = r;
    return out;
  }, [doc.options.aerodromeRequests]);
  const onRequest = useCallback(
    (uid: string, kind: AerodromeRequest['kind'] | null, stopMin?: number) => {
      update((d) => ({
        ...d,
        options: { ...d.options, aerodromeRequests: setRequest(d.options.aerodromeRequests, uid, kind, stopMin) },
      }));
    },
    [update],
  );

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

  const onRouteChange = useCallback(
    (route: RoutePoint[], opts?: { coalesce?: string }) => {
      update((d) => ({ ...d, route, legOverrides: pruneOverrides(d.legOverrides, route) }), opts);
    },
    [update],
  );

  const onAltitudeChange = useCallback(
    (key: string, altFt: number | null) => {
      update((d) => {
        const legOverrides = setAltitudeOverride(d.legOverrides, key, altFt);
        return legOverrides === d.legOverrides ? d : { ...d, legOverrides };
      });
    },
    [update],
  );

  const onSaveWaypoint = useCallback(
    async (p: RoutePoint) => {
      const w = await api.waypoints.create({ name: p.name, lat: p.lat, lon: p.lon, notes: '' });
      await reloadLists();
      update((d) => ({
        ...d,
        route: d.route.map((q) =>
          q.uid === p.uid ? { ...q, kind: 'waypoint' as const, refId: w.id, name: w.name } : q,
        ),
      }));
    },
    [reloadLists, update],
  );

  const layers = useMemo(
    () => flightLayers(doc.options.mapLayers, pilot.settings.mapLayers),
    [doc.options.mapLayers, pilot.settings.mapLayers],
  );

  return (
    <RouteMap
      layers={layers}
      onLayers={setMapLayers}
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
      notams={notams}
      selectedNotam={selectedNotam}
      onNotamSelect={selectNotam}
      requests={requests}
      onRequest={onRequest}
      aerodromeInfo={aerodromeInfo}
    />
  );
}
