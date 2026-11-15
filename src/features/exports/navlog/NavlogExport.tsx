// Export (a): the MD 4.2 navigation log ("Flight Planner" sheet), A4 landscape, one sheet per 9
// legs. A faithful port of the v2 print sheet (legacy index.html / css/style.css / js/app.js
// sheetHtml), read-only and fed by the v3 flight model: calc/computeNavlog with live Open-Meteo
// winds aloft, METAR (when current) or forecast surface conditions at each end, and the flight's
// ATC list as the terminal information.
//
// Usage (ExportPage): <NavlogExport flight={flight} />. On screen the sheets are scaled to the
// container width; in print each sheet fills one A4 landscape page (named page "md42").
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Aircraft, Flight, Pilot } from '../../../shared';
import { buildLegs } from '../../../calc';
import { api } from '../../../data/api';
import { useAsync } from '../../../data/useAsync';
import { REF, SUN_TABLES } from '../../../data/ref';
import { atcInput, endpointAerodrome, generateAtcList } from '../../../data/atc';
import { fetchRouteWeather, type RouteWeather } from '../../../data/weather';
import { fetchMetarTaf, type MetarTafResult } from '../../../data/weatherMetar';
import { computeRouteHazards, fetchHazardWeather, type HazardWeather } from '../../../data/hazardWeather';
import {
  buildNavlogDocument, computeFlightNavlog, LEGS_PER_SHEET, MIN_TERMINAL_ROWS, NOTE_LINES,
  type NavlogDocument, type NavlogSheet, type SheetLeg,
} from './model';
import { fitSheets, SHEET_UNITS } from './fit';
import './navlog.css';

/** METAR/TAF are fetched only when the flight is within this long of now (otherwise the forecast is used). */
const METAR_HORIZON_MS = 6 * 3600 * 1000;

export function NavlogExport({ flight }: { flight: Flight }) {
  const pilotQ = useAsync<Pilot | null>(() => api.me.get().catch(() => null), []);
  const acQ = useAsync<Aircraft | null>(
    () => (flight.aircraftId ? api.aircraft.get(flight.aircraftId).catch(() => null) : Promise.resolve(null)),
    [flight.aircraftId],
  );
  const pilot = pilotQ.data ?? null;
  const aircraft = acQ.data ?? null;

  // ---- weather: winds aloft at leg midpoints + surface at both ends (Open-Meteo), METAR/TAF
  const legs = useMemo(() => buildLegs(flight.route, flight.date), [flight.route, flight.date]);
  const model = flight.options.windModel || pilot?.settings.windModel;
  const wxKey = JSON.stringify([flight.date, model, legs.map((l) => [l.mid.lat.toFixed(3), l.mid.lon.toFixed(3)])]);
  const [weather, setWeather] = useState<RouteWeather | null>(null);
  const [wxBusy, setWxBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!legs.length || !flight.date) { setWeather(null); return; }
    let live = true;
    setWxBusy(true);
    fetchRouteWeather({
      date: flight.date, model,
      legMidpoints: legs.map((l) => l.mid),
      departure: flight.route[0] ?? null,
      destination: flight.route.length > 1 ? flight.route[flight.route.length - 1] : null,
      force: refresh > 0,
    }).then((w) => { if (live) { setWeather(w); setWxBusy(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wxKey, refresh]);

  const endIcaos = useMemo(() => {
    const ends = [flight.route[0], flight.route.length > 1 ? flight.route[flight.route.length - 1] : undefined];
    return ends.map((p) => (p ? endpointAerodrome(p, REF.aerodromes)?.icao ?? null : null)).filter((x): x is string => !!x);
  }, [flight.route]);
  const nearNow = useMemo(() => {
    const day = Date.parse(flight.date + 'T00:00:00Z');
    return isFinite(day) && Math.abs(day + 12 * 3600000 - Date.now()) < 12 * 3600000 + METAR_HORIZON_MS;
  }, [flight.date]);
  const [metar, setMetar] = useState<MetarTafResult | null>(null);
  useEffect(() => {
    if (!nearNow || !endIcaos.length) { setMetar(null); return; }
    let live = true;
    fetchMetarTaf(endIcaos, { force: refresh > 0 }).then((m) => { if (live) setMetar(m); });
    return () => { live = false; };
  }, [endIcaos.join(','), nearNow, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- weather hazards along the route (corridor samples)
  const hzKey = JSON.stringify([flight.date, model, legs.map((l) => [l.from.lat, l.from.lon, l.to.lat, l.to.lon].map((x) => x.toFixed(3)))]);
  const [hazardWx, setHazardWx] = useState<HazardWeather | null>(null);
  const [hzBusy, setHzBusy] = useState(false);
  useEffect(() => {
    if (!legs.length || !flight.date) { setHazardWx(null); return; }
    let live = true;
    setHzBusy(true);
    const ad = (p: typeof flight.route[number] | undefined) => (p ? endpointAerodrome(p, REF.aerodromes) : null);
    const a0 = ad(flight.route[0]), a1 = flight.route.length > 1 ? ad(flight.route[flight.route.length - 1]) : null;
    fetchHazardWeather({
      date: flight.date, model,
      legs: legs.map((l) => ({ from: l.from, to: l.to, distNm: l.distNm })),
      departure: a0 ? { lat: a0.lat, lon: a0.lon } : null,
      destination: a1 ? { lat: a1.lat, lon: a1.lon } : null,
      force: refresh > 0,
    }).then((h) => { if (live) { setHazardWx(h); setHzBusy(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hzKey, refresh]);

  // ---- the document
  const loading = pilotQ.loading || acQ.loading;
  const doc: NavlogDocument | null = useMemo(() => {
    if (loading) return null;
    const computed = computeFlightNavlog({
      doc: flight, aircraft, settings: pilot?.settings ?? null, weather,
      ref: { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes, sunTables: SUN_TABLES },
    });
    const atc = flight.atc ?? generateAtcList(atcInput(flight.route, computed.altitudesFt, REF, pilot?.settings.enrouteAerodromeRadiusNm ?? 2));
    const dayMs = Date.parse(flight.date + 'T00:00:00Z');
    const end = (p: typeof flight.route[number] | undefined) => {
      const a = p ? endpointAerodrome(p, REF.aerodromes) : null;
      return a ? { elevFt: a.elevFt ?? 0, reports: a.icao && metar ? metar.stations[a.icao] ?? null : null } : null;
    };
    const hazards = computeRouteHazards({
      hw: hazardWx, navlog: computed.navlog, dayMs, nowMs: Date.now(),
      departure: end(flight.route[0]), destination: flight.route.length > 1 ? end(flight.route[flight.route.length - 1]) : null,
    });
    const hazardStatus = !computed.navlog.blockOffSet ? 'not checked (block-off time not set)'
      : hazardWx && hazardWx.status !== 'ok' ? hazardWx.message
      : hazardWx && hazardWx.status === 'ok' ? `none found (${hazardWx.sourceLabel})` : undefined;
    return buildNavlogDocument({ doc: flight, aircraft, computed, atc, aerodromes: REF.aerodromes, weather, metar, nowMs: Date.now(), hazards, hazardStatus });
  }, [loading, flight, aircraft, pilot, weather, metar, hazardWx]);

  // ---- scale to the container on screen; fit text after every render
  const host = useRef<HTMLDivElement>(null);
  const [fitPx, setFitPx] = useState(0.9);
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
  }, [doc !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { fitSheets(host.current); }, [doc, fitPx]);
  useEffect(() => {
    // web fonts can change the metrics after the first fit
    let live = true;
    document.fonts?.ready.then(() => { if (live) fitSheets(host.current); });
    return () => { live = false; };
  }, [doc]);

  if (!doc) return <div className="md42-doc-loading muted">Loading…</div>;
  const wxPending = (wxBusy || hzBusy) && legs.length > 0;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const snap = (w: number, min: number) => `${Math.max(min, Math.round(w * dpr)) / dpr}px`;

  return (
    <div className="md42-doc" data-testid="navlog-export" data-ready={wxPending ? 'false' : 'true'} data-sheets={doc.sheets.length}>
      <div className="md42-status no-print">
        <div className="md42-status-row">
          <span className={`chip ${wxPending ? '' : weather?.status === 'ok' ? 'ok' : legs.length ? 'warn' : ''}`}>
            {wxPending ? 'Loading winds…' : weather?.status === 'ok' ? 'Winds aloft loaded' : legs.length ? 'No winds aloft' : 'No route'}
          </span>
          {doc.sheets.length > 1 && <span className="chip">{doc.sheets.length} sheets</span>}
          <span className="spacer" />
          <button className="ghost" onClick={() => setRefresh((x) => x + 1)} disabled={wxPending || !legs.length}>Refresh weather</button>
        </div>
        {doc.sources.length > 0 && <ul className="md42-sources">{doc.sources.map((s, i) => <li key={i}>{s}</li>)}</ul>}
        {doc.warnings.length > 0 && <ul className="md42-warnings" data-testid="navlog-warnings">{doc.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      </div>
      <div
        className="md42-stage"
        ref={host}
        style={{ ['--fit' as string]: `${fitPx}px`, ['--hair' as string]: snap(fitPx, 1), ['--thick' as string]: snap(fitPx * 1.6, 2) }}
      >
        {doc.sheets.map((s) => <Sheet key={s.index} sheet={s} doc={doc} />)}
        {doc.hazardPage && (
          <section className="md42-hazards" data-testid="navlog-hazard-page" aria-label="Weather hazards">
            <h2>Weather hazards along the route</h2>
            <p className="md42-hazards-src">{doc.hazardPage.source}</p>
            <ol>{doc.hazardPage.items.map((t, i) => <li key={i}>{t}</li>)}</ol>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One sheet (geometry in sheet units "u" from the scanned MD 4.2 form: 1145 u wide)

const cellStyle = (r: number, c: number, rs = 1, cs = 1) => ({ gridRow: `${r} / span ${rs}`, gridColumn: `${c} / span ${cs}` });
function C({ r, c, rs = 1, cs = 1, cls = '', children }: { r: number; c: number; rs?: number; cs?: number; cls?: string; children?: ReactNode }) {
  return <div className={cls} style={cellStyle(r, c, rs, cs)}>{children}</div>;
}
/** A printed value; `cap` = largest font size, in sheet units. */
function V({ t, cap = 21, cls = '' }: { t: string; cap?: number; cls?: string }) {
  return <div className={`v ${cls}`} data-fit={cap}>{t}</div>;
}
function TwoH({ a, b }: { a: ReactNode; b: ReactNode }) {
  return <div className="sub2"><div className="h">{a}</div><div className="h">{b}</div></div>;
}
const HEX = (
  <svg viewBox="0 0 126 54" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,0 14,27 0,54" fill="#000" />
    <polygon points="126,0 112,27 126,54" fill="#000" />
  </svg>
);
const BR = <br />;

function Sheet({ sheet, doc }: { sheet: NavlogSheet; doc: NavlogDocument }) {
  const h = sheet.header;
  const last = sheet.index === sheet.count - 1;
  const tr = 4 + 2 * LEGS_PER_SHEET;
  const rowsTpl = `calc(19*var(--u)) calc(19*var(--u)) calc(19*var(--u)) repeat(${2 * LEGS_PER_SHEET}, calc(27*var(--u))) calc(30*var(--u))`;
  const nRows = Math.max(MIN_TERMINAL_ROWS, doc.terminal.length);
  const rowH = 165 / nRows;

  const legCells = (j: number) => {
    const L: SheetLeg | null = sheet.legs[j];
    const r = 4 + 2 * j;
    const v = (k: keyof SheetLeg) => (L ? String(L[k]) : '');
    const windCls = L && L.windMissing && L.alt ? 'calm' : '';
    return (
      <Fragment key={j}>
        <C r={r} c={1} rs={2}><V t={v('tc')} /></C>
        <C r={r} c={2} rs={2}><V t={v('alt')} cls={L && L.altMissing ? 'need' : ''} /></C>
        <C r={r} c={3} rs={2}><V t={v('wd')} cls={windCls} /></C>
        <C r={r} c={4} rs={2}><V t={v('ws')} cls={windCls} /></C>
        <C r={r} c={5} rs={2}><V t={v('temp')} /></C>
        <C r={r} c={6} rs={2}><V t={v('tas')} /></C>
        <C r={r} c={7} rs={2}><V t={v('wca')} /></C>
        <C r={r} c={8}><V t={v('th')} /></C><C r={r + 1} c={8}><V t={v('var')} /></C>
        <C r={r} c={9} cls="fold"><V t={v('mh')} /></C><C r={r + 1} c={9} cls="fold"><V t={v('dev')} /></C>
        {/* the arrows sit on the leg row; the checkpoint ending the leg sits on the line to the next leg */}
        <C r={r} c={10} rs={2} cls="cp">{HEX}</C>
        {j < LEGS_PER_SHEET - 1 && <C r={r + 1} c={10} rs={2} cls="cpn-cell"><div className="cpn">{sheet.checkpoints[j]}</div></C>}
        <C r={r} c={11} rs={2}><V t={v('ch')} /></C>
        <C r={r} c={12}><V t={v('dist')} /></C><C r={r + 1} c={12}><V t={v('rem')} /></C>
        <C r={r} c={13}><V t={v('gs')} /></C><C r={r + 1} c={13} />
        <C r={r} c={14}><V t={v('ete')} /></C><C r={r + 1} c={14}><V t={v('ate')} /></C>
        <C r={r} c={15} /><C r={r + 1} c={15} />
        <C r={r} c={16}><V t={v('fuel')} /></C><C r={r + 1} c={16} />
        <C r={r} c={17} /><C r={r + 1} c={17} />
        <C r={r} c={18} /><C r={r + 1} c={18} />
        <C r={r} c={19} rs={2} />
      </Fragment>
    );
  };

  return (
    <section className="md42" data-sheet={sheet.index + 1} aria-label={`Navigation log sheet ${sheet.index + 1} of ${sheet.count}`}>
      <div className="date-top"><V t={h.date} cap={16} cls="date" /><span className="pgno">{sheet.index + 1}</span></div>
      <div className="fold-line" />
      <div className="g hdr">
        <div className="title">Flight Planner</div>
        <div className="lbl">AIRCRAFT</div><div className="val"><V t={h.aircraft} /></div>
        <div className="lbl">TAKE-OFF</div><div className="val" />
        <div className="lbl">BLOCK START</div><div className="val"><V t={h.blockStart} /></div>
        <div className="lbl">BLOCK END</div><div className="val" />
        <div className="lbl">ATIS CODE</div><div className="val" />
        <div className="lbl">SKY</div><div className="val"><V t={h.sky} /></div>
        <div className="lbl">TEMP</div><div className="val"><V t={h.temp} /></div>
        <div className="lbl">WIND</div><div className="val"><V t={h.wind} /></div>
        <div className="lbl big" style={{ gridColumn: 'span 2' }}>En Route</div>
        <div className="lbl">QNH</div><div className="val"><V t={h.qnh} /></div>
        <div className="lbl">RUNWAY</div><div className="val"><V t={h.runway} /></div>
        <div className="est">{h.est}</div>
      </div>

      <div className="g tbl" style={{ gridTemplateRows: rowsTpl }}>
        <C r={1} c={1} cs={2} cls="h c">PLANNED</C>
        <C r={2} c={1} rs={2} cls="h">TRUE{BR}COURSE</C>
        <C r={2} c={2} rs={2} cls="h">ALTITUDE</C>
        <C r={1} c={3} cs={2} cls="h c">PREDICTED WIND</C>
        <C r={2} c={3} rs={2} cls="h">DIRECTION</C>
        <C r={2} c={4} rs={2} cls="h">VELOCITY</C>
        <C r={1} c={5} rs={3} cls="h">TEMP</C>
        <C r={1} c={6} rs={3} cls="h">PLAN TAS</C>
        <C r={1} c={7} rs={3} cls="h">WIND{BR}CORR{BR}ANGLE{BR}-L&nbsp;&nbsp;+R</C>
        <C r={1} c={8} rs={3}><TwoH a={<>TRUE{BR}HEADING</>} b={<>-E +W&nbsp;&nbsp;VAR</>} /></C>
        <C r={1} c={9} rs={3} cls="fold"><TwoH a={<>MAG{BR}HEADING</>} b="± DEV" /></C>
        <C r={1} c={10} cls="h big">Checkpoints</C>
        <C r={2} c={10} rs={2} cls="cp-end">
          <div className="sub2 end"><div className="h">{sheet.topLabel}</div><div className="dep"><V t={sheet.topName} cap={17} /></div></div>
        </C>
        <C r={1} c={11} rs={3} cls="h">COMPASS{BR}HEADING</C>
        <C r={1} c={12} cls="h">DIST</C><C r={1} c={13} cls="h">GS</C>
        <C r={2} c={12} cls="h">LEG</C><C r={2} c={13} cls="h">EST</C>
        <C r={3} c={12} cls="h">REM</C><C r={3} c={13} cls="h">ACT</C>
        <C r={1} c={14} rs={3}><TwoH a="ETE" b="ATE" /></C>
        <C r={1} c={15} rs={3}><TwoH a="ETA" b="ATA" /></C>
        <C r={1} c={16} rs={3}><TwoH a={<>FUEL{BR}USED</>} b={<>FUEL{BR}REM.</>} /></C>
        <C r={1} c={17} cs={2} cls="h c"><b>VOR</b></C>
        <C r={2} c={17} cls="h">FREQ</C><C r={2} c={18} cls="h">BEARING</C>
        <C r={3} c={17} cls="h">IDENT</C><C r={3} c={18} cls="h">TO/FROM</C>
        <C r={1} c={19} rs={3} cls="h">TRANS-{BR}PONDER{BR}CODES{BR}&apos;SQUAWKS&apos;</C>

        {Array.from({ length: LEGS_PER_SHEET }, (_, j) => legCells(j))}

        <C r={tr} c={1} cs={9} cls="ti-title fold">Terminal Information</C>
        <C r={tr} c={10} cls="cp-end total-row">
          <div className="sub2 end"><div className="h">{sheet.bottomLabel}</div><div className="dep"><V t={sheet.bottomName} cap={17} /></div></div>
        </C>
        <C r={tr} c={11} cls="tot-label total-row">TOTALS</C>
        <C r={tr} c={12} cls="total-row"><V t={sheet.totals.dist} /></C>
        <C r={tr} c={13} cls="total-row" />
        <C r={tr} c={14} cls="total-row"><V t={sheet.totals.ete} /></C>
        <C r={tr} c={15} cls="total-row" />
        <C r={tr} c={16} cls="total-row"><V t={sheet.totals.fuel} /></C>
        <C r={tr} c={17} cs={3} cls="sunset total-row"><V t={sheet.totals.sunset} cap={12} /></C>
      </div>

      <div className="g foot">
        <div className="ti">
          <div className="th">Field</div><div className="th">Elevation</div><div className="th">Runways</div><div className="th">Radio Frequencies</div>
          {Array.from({ length: nRows }, (_, i) => {
            const t = doc.terminal[i];
            const st = { height: `calc(${rowH.toFixed(3)}*var(--u))` };
            return (
              <Fragment key={i}>
                <div style={st}><div className="tv" data-fit-wrap={17}>{t?.field ?? ''}</div></div>
                <div style={st}><div className="tv" data-fit-wrap={17}>{t?.elev ?? ''}</div></div>
                <div style={st}><div className="tv" data-fit-wrap={17}>{t?.rwy ?? ''}</div></div>
                <div style={st}><div className="tv" data-fit-wrap={12}>{t?.freq ?? ''}</div></div>
              </Fragment>
            );
          })}
        </div>
        <div className="notes">
          <div className="th">Notes:</div>
          <div className="note-lines">
            {Array.from({ length: NOTE_LINES }, (_, i) => (
              <div key={i}><div className="nv" data-fit={11.5}>{doc.notes[i] ?? ''}</div></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
