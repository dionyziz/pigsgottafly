// The MD 4.2 navigation log ("Flight Planner" sheet), one sheet per 9 legs: a faithful port of the
// v2 print sheet (legacy index.html / css/style.css / js/app.js sheetHtml). The sheets themselves
// are NavlogSheet.tsx, which also draws the PDF e-mailed to the pilot (./MailPanel.tsx).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { refOfFlight } from '../../../data/ref';
import { useTerrain } from '../../../data/terrain';
import { useFlightWeather } from '../../../data/useFlightWeather';
import type { Flight } from '../../../shared';
import { Loading, Panel } from '../../../ui';
import { useFlightAircraft, useFlightPilot } from '../useExportData';
import { ExportWarnings } from '../WarningList';
import { fitSheets, SHEET_UNITS } from './fit';
import { NavlogMailPanel } from './MailPanel';
import { type NavlogDocument, navlogDocumentOf } from './model';
import { NavlogStage } from './NavlogSheet';

export function NavlogExport({ flight }: { flight: Flight }) {
  const pilot = useFlightPilot(flight);
  const ac = useFlightAircraft(flight);
  const aircraft = ac.aircraft;

  // ---- weather: winds aloft at leg midpoints, surface at both ends and every stop (Open-Meteo), METAR/TAF
  const wx = useFlightWeather({
    date: flight.date,
    route: flight.route,
    options: flight.options,
    model: flight.options.windModel || pilot.settings.windModel,
  });
  const { weather, metar, legs } = wx;
  const terrain = useTerrain();
  // the cycle in effect on the flight's date
  const rd = refOfFlight(flight.date);

  const doc: NavlogDocument | null = useMemo(() => {
    if (ac.loading) return null;
    return navlogDocumentOf({
      flight,
      aircraft,
      settings: pilot.settings,
      weather,
      metar,
      ref: {
        aerodromes: rd.ref.aerodromes,
        vfrPoints: rd.ref.vfrPoints,
        vfrRoutes: rd.ref.vfrRoutes,
        sunTables: rd.sun,
        terrain,
        airspaces: rd.ref.airspaces,
        fis: rd.ref.fis,
      },
      nowMs: Date.now(),
    });
  }, [ac.loading, flight, aircraft, pilot, weather, metar, terrain, rd]);

  // ---- scale to the container on screen; fit text after every render
  const host = useRef<HTMLDivElement>(null);
  const [fitPx, setFitPx] = useState(0.9);
  // the sheet host renders once there is a document
  const hasDoc = doc !== null;
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setFitPx(Math.max(0.3, Math.min(1.4, w / SHEET_UNITS)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDoc]);
  useLayoutEffect(() => {
    fitSheets(host.current);
  }, [doc, fitPx]);
  useEffect(() => {
    // web fonts can change the metrics after the first fit
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) fitSheets(host.current);
    });
    return () => {
      live = false;
    };
  }, [doc]);

  if (!doc) return <Loading />;
  const wxPending = wx.weatherLoading && legs.length > 0;

  return (
    <div
      className="md42-doc print-sheet-page"
      data-testid="navlog-export"
      data-ready={wxPending ? 'false' : 'true'}
      data-sheets={doc.sheets.length}
    >
      {legs.length > 0 && (
        <Panel
          title="Weather"
          className="md42-status"
          status={
            <span className="md42-sources" data-testid="navlog-sources">
              {wxPending ? 'Loading…' : doc.sources.join(' · ')}
            </span>
          }
          actions={
            <button className="ghost" onClick={wx.refresh} disabled={wxPending}>
              Refresh weather
            </button>
          }
        >
          <ExportWarnings warnings={doc.warnings} aircraftId={flight.aircraftId} testId="navlog-warnings" />
        </Panel>
      )}
      <NavlogMailPanel flightId={flight.id} content={wxPending ? null : { sheets: doc.sheets }} />
      <NavlogStage ref={host} sheets={doc.sheets} fitPx={fitPx} />
    </div>
  );
}
