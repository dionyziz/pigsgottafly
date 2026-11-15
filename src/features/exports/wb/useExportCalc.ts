// Loads what the W&B and performance exports need (pilot, aircraft, Open-Meteo winds aloft and
// surface forecast, METAR when the flight is near) and runs computeExportCalc. Same fetching as
// the navlog export, so the three printouts agree.
import { usePilot } from '../../../app/session';
import { useEffect, useMemo, useState } from 'react';
import type { Aircraft, Flight, Pilot } from '../../../shared';
import { buildLegs } from '../../../calc';
import { landingPointIndices } from '../../../shared';
import { api } from '../../../data/api';
import { useAsync } from '../../../data/useAsync';
import { REF, SUN_TABLES, runwaysOf } from '../../../data/ref';
import { endpointAerodrome } from '../../../data/atc';
import { fetchRouteWeather, type RouteWeather } from '../../../data/weather';
import { fetchMetarTaf, type MetarTafResult } from '../../../data/weatherMetar';
import { computeExportCalc, type ExportCalc } from './exportCalc';

/** METAR/TAF are fetched only when the flight is within this long of now (otherwise the forecast is used). */
const METAR_HORIZON_MS = 6 * 3600 * 1000;

export interface ExportCalcState {
  loading: boolean;
  pilot: Pilot | null;
  aircraft: Aircraft | null;
  weather: RouteWeather | null;
  metar: MetarTafResult | null;
  /** Winds/surface forecast still loading. */
  weatherPending: boolean;
  refresh(): void;
  calc: ExportCalc | null;
  nowMs: number;
}

export function useExportCalc(flight: Flight): ExportCalcState {
  // the session's pilot: one copy for the whole app, so profile edits show here at once
  const pilot: Pilot | null = usePilot();
  const acQ = useAsync<Aircraft | null>(
    () => (flight.aircraftId ? api.aircraft.get(flight.aircraftId).catch(() => null) : Promise.resolve(null)),
    [flight.aircraftId],
  );
  const aircraft = acQ.data ?? null;

  const legs = useMemo(() => buildLegs(flight.route, flight.date), [flight.route, flight.date]);
  const model = flight.options.windModel || pilot?.settings.windModel;
  const dep = flight.route[0] ?? null;
  const dest = flight.route.length > 1 ? flight.route[flight.route.length - 1] : null;
  // Intermediate full stops and touch-and-goes: surface weather and METAR there too (landing and take-off checks).
  const stopPts = useMemo(() => landingPointIndices(flight.route, flight.options).map((i) => flight.route[i]), [flight.route, flight.options]);
  const wxKey = JSON.stringify([
    flight.date, model, legs.map((l) => [l.mid.lat.toFixed(3), l.mid.lon.toFixed(3)]),
    dep && [dep.lat.toFixed(3), dep.lon.toFixed(3)], dest && [dest.lat.toFixed(3), dest.lon.toFixed(3)],
    stopPts.map((p) => [p.lat.toFixed(3), p.lon.toFixed(3)]),
  ]);
  const [weather, setWeather] = useState<RouteWeather | null>(null);
  const [wxBusy, setWxBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if ((!legs.length && !dep) || !flight.date) { setWeather(null); setWxBusy(false); return; }
    let live = true;
    setWxBusy(true);
    fetchRouteWeather({
      date: flight.date, model,
      legMidpoints: legs.map((l) => l.mid),
      departure: dep, destination: dest, stops: stopPts,
      force: refresh > 0,
    }).then(
      (w) => { if (live) { setWeather(w); setWxBusy(false); } },
      () => { if (live) { setWeather(null); setWxBusy(false); } },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wxKey, refresh]);

  const endIcaos = useMemo(() => {
    const ids = [dep, ...stopPts, dest].map((p) => (p ? endpointAerodrome(p, REF.aerodromes)?.icao ?? null : null)).filter((x): x is string => !!x);
    return [...new Set(ids)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight.route, stopPts]);
  const nearNow = useMemo(() => {
    const day = Date.parse(flight.date + 'T00:00:00Z');
    return isFinite(day) && Math.abs(day + 12 * 3600000 - Date.now()) < 12 * 3600000 + METAR_HORIZON_MS;
  }, [flight.date]);
  const [metar, setMetar] = useState<MetarTafResult | null>(null);
  useEffect(() => {
    if (!nearNow || !endIcaos.length) { setMetar(null); return; }
    let live = true;
    fetchMetarTaf(endIcaos, { force: refresh > 0 }).then((m) => { if (live) setMetar(m); }, () => { if (live) setMetar(null); });
    return () => { live = false; };
  }, [endIcaos.join(','), nearNow, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = acQ.loading;
  const [nowMs] = useState(() => Date.now());
  const calc = useMemo(() => {
    if (loading) return null;
    return computeExportCalc({
      doc: flight, aircraft, settings: pilot?.settings ?? null, weather, metar, nowMs: Date.now(),
      ref: { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes, sunTables: SUN_TABLES, runwaysOf },
    });
  }, [loading, flight, aircraft, pilot, weather, metar]);

  return {
    loading, pilot, aircraft, weather, metar,
    weatherPending: wxBusy && (legs.length > 0 || !!dep),
    refresh: () => setRefresh((x) => x + 1),
    calc, nowMs,
  };
}
