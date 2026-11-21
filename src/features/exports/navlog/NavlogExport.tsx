// Export (a): the MD 4.2 navigation log ("Flight Planner" sheet), A4 landscape, one sheet per 9
// legs. A faithful port of the v2 print sheet (legacy index.html / css/style.css / js/app.js
// sheetHtml), read-only and fed by the v3 flight model: calc/computeNavlog with live Open-Meteo
// winds aloft, METAR (when current) or forecast surface conditions at each end, and the flight's
// ATC list as the terminal information (on each sheet, the units its legs touch).
//
// Usage (ExportPage): <NavlogExport flight={flight} />. On screen the sheets are scaled to the
// container width; in print each sheet fills one A4 landscape page (named page "md42").
import '../form731/forms.css';
import './navlog.css';

import { Fragment, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { atcInput, atcLegRelevance, generateAtcList } from '../../../data/atc';
import { REF, SUN_TABLES } from '../../../data/ref';
import { useTerrain } from '../../../data/terrain';
import { useFlightWeather } from '../../../data/useFlightWeather';
import type { Flight } from '../../../shared';
import { Loading, Panel } from '../../../ui';
import { useFlightAircraft, useFlightPilot } from '../useExportData';
import { ExportWarnings } from '../WarningList';
import { fitSheets, SHEET_UNITS } from './fit';
import {
  buildNavlogDocument,
  computeFlightNavlog,
  LEGS_PER_SHEET,
  MIN_TERMINAL_ROWS,
  type NavlogDocument,
  type NavlogSheet,
  NOTE_LINES,
  type SheetLeg,
  type TerminalRow,
} from './model';

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

  // ---- the document
  const doc: NavlogDocument | null = useMemo(() => {
    if (ac.loading) return null;
    const computed = computeFlightNavlog({
      doc: flight,
      aircraft,
      settings: pilot.settings,
      weather,
      ref: {
        aerodromes: REF.aerodromes,
        vfrPoints: REF.vfrPoints,
        vfrRoutes: REF.vfrRoutes,
        sunTables: SUN_TABLES,
        terrain,
      },
    });
    const gen = atcInput(flight.route, computed.altitudesFt, REF, pilot.settings.enrouteAerodromeRadiusNm ?? 2);
    const atc = flight.atc ?? generateAtcList(gen);
    return buildNavlogDocument({
      doc: flight,
      aircraft,
      computed,
      atc,
      atcRelevance: atcLegRelevance(gen),
      aerodromes: REF.aerodromes,
      weather,
      metar,
      nowMs: Date.now(),
    });
  }, [ac.loading, flight, aircraft, pilot, weather, metar, terrain]);

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
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const snap = (w: number, min: number) => `${Math.max(min, Math.round(w * dpr)) / dpr}px`;

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
      <div
        className="md42-stage"
        ref={host}
        style={{
          ['--fit' as string]: `${fitPx}px`,
          ['--hair' as string]: snap(fitPx, 1),
          ['--thick' as string]: snap(fitPx * 1.6, 2),
        }}
      >
        {doc.sheets.map((s) => (
          <Sheet key={s.index} sheet={s} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One sheet (geometry in sheet units "u" from the scanned MD 4.2 form: 1145 u wide)

const cellStyle = (r: number, c: number, rs = 1, cs = 1) => ({
  gridRow: `${r} / span ${rs}`,
  gridColumn: `${c} / span ${cs}`,
});
function C({
  r,
  c,
  rs = 1,
  cs = 1,
  cls = '',
  children,
}: {
  r: number;
  c: number;
  rs?: number;
  cs?: number;
  cls?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cls} style={cellStyle(r, c, rs, cs)}>
      {children}
    </div>
  );
}
/** A printed value; `cap` = largest font size, in sheet units. */
function V({ t, cap = 21, cls = '' }: { t: string; cap?: number; cls?: string }) {
  return (
    <div className={`v ${cls}`} data-fit={cap}>
      {t}
    </div>
  );
}
/** A header block value: all of them are fitted to one size (fit.ts). */
function HV({ t }: { t: string }) {
  return (
    <div className="val">
      <div className="v" data-fit={18} data-fit-group="hdr">
        {t}
      </div>
    </div>
  );
}
function TwoH({ a, b }: { a: ReactNode; b: ReactNode }) {
  return (
    <div className="sub2">
      <div className="h">{a}</div>
      <div className="h">{b}</div>
    </div>
  );
}
const HEX = (
  <svg viewBox="0 0 126 54" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,0 14,27 0,54" fill="#000" />
    <polygon points="126,0 112,27 126,54" fill="#000" />
    <line x1="14" y1="27" x2="112" y2="27" stroke="#000" strokeWidth="1" vectorEffect="non-scaling-stroke" />
  </svg>
);
const BR = <br />;

/** Terminal information, one row: field / elevation / runways / one radio unit per line. */
function TerminalCells({ t, rowH }: { t: TerminalRow | undefined; rowH: number }) {
  const st = { height: `calc(${rowH.toFixed(3)}*var(--u))` };
  const nf = Math.max(1, ...(t?.units ?? []).map((u) => u.freqs.length));
  return (
    <>
      <div style={st}>
        <div className="tv" data-fit-ti="field">
          <div className="tx">{t?.field ?? ''}</div>
        </div>
      </div>
      <div style={st}>
        <div className="tv num" data-fit-ti="elev">
          <div className="tx">{t?.elev ?? ''}</div>
        </div>
      </div>
      <div style={st}>
        <div className="tv" data-fit-ti="rwy">
          <div className="tx">{t?.rwy ?? ''}</div>
        </div>
      </div>
      <div style={st}>
        <div className="tv" data-fit-ti={`freq${t?.units.length ?? 0}`}>
          {t && t.units.length > 0 && (
            <div className="tx fq" style={{ gridTemplateColumns: `max-content repeat(${nf}, max-content)` }}>
              {t.units.map((u, i) => (
                <Fragment key={i}>
                  <span className="fq-u">{u.unit}</span>
                  {Array.from({ length: nf }, (_, k) => (
                    <span key={k} className="fq-f">
                      {u.freqs[k] ?? ''}
                    </span>
                  ))}
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Sheet({ sheet }: { sheet: NavlogSheet }) {
  const h = sheet.header;
  const tr = 4 + 2 * LEGS_PER_SHEET;
  const rowsTpl = `calc(19*var(--u)) calc(19*var(--u)) calc(19*var(--u)) repeat(${2 * LEGS_PER_SHEET}, calc(27*var(--u))) calc(30*var(--u))`;
  const terminal = sheet.terminal;
  const nRows = Math.max(MIN_TERMINAL_ROWS, terminal.length);
  // rows share the box by their number of radio units (a row of five units gets 2.6 single rows' height)
  const weight = (i: number) => 1 + 0.4 * Math.max(0, (terminal[i]?.units.length ?? 1) - 1);
  const weights = Array.from({ length: nRows }, (_, i) => weight(i));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const legCells = (j: number) => {
    const L: SheetLeg | null = sheet.legs[j];
    const r = 4 + 2 * j;
    const v = (k: keyof SheetLeg) => (L ? String(L[k]) : '');
    const windCls = L && L.windMissing && L.alt ? 'calm' : '';
    return (
      <Fragment key={j}>
        <C r={r} c={1} rs={2}>
          <V t={v('tc')} />
        </C>
        <C r={r} c={2} rs={2}>
          <V t={v('alt')} cls={L && L.altMissing ? 'need' : ''} />
        </C>
        <C r={r} c={3} rs={2}>
          <V t={v('wd')} cls={windCls} />
        </C>
        <C r={r} c={4} rs={2}>
          <V t={v('ws')} cls={windCls} />
        </C>
        <C r={r} c={5} rs={2}>
          <V t={v('temp')} />
        </C>
        <C r={r} c={6} rs={2}>
          <V t={v('tas')} />
        </C>
        <C r={r} c={7} rs={2}>
          <V t={v('wca')} />
        </C>
        <C r={r} c={8}>
          <V t={v('th')} />
        </C>
        <C r={r + 1} c={8}>
          <V t={v('var')} />
        </C>
        <C r={r} c={9} cls="fold">
          <V t={v('mh')} />
        </C>
        <C r={r + 1} c={9} cls="fold">
          <V t={v('dev')} />
        </C>
        {/* the arrows sit on the leg row; the checkpoint ending the leg sits on the line to the next leg */}
        <C r={r} c={10} rs={2} cls="cp">
          {HEX}
        </C>
        {j < LEGS_PER_SHEET - 1 && (
          <C r={r + 1} c={10} rs={2} cls="cpn-cell">
            <div className="cpn">{sheet.checkpoints[j]}</div>
          </C>
        )}
        <C r={r} c={11} rs={2}>
          <V t={v('ch')} />
        </C>
        <C r={r} c={12}>
          <V t={v('dist')} />
        </C>
        <C r={r + 1} c={12}>
          <V t={v('rem')} />
        </C>
        <C r={r} c={13}>
          <V t={v('gs')} />
        </C>
        <C r={r + 1} c={13} />
        <C r={r} c={14}>
          <V t={v('ete')} />
        </C>
        <C r={r + 1} c={14}>
          <V t={v('ate')} />
        </C>
        <C r={r} c={15} />
        <C r={r + 1} c={15} />
        <C r={r} c={16}>
          <V t={v('fuel')} />
        </C>
        <C r={r + 1} c={16} />
        <C r={r} c={17} />
        <C r={r + 1} c={17} />
        <C r={r} c={18} />
        <C r={r + 1} c={18} />
        <C r={r} c={19} rs={2} />
      </Fragment>
    );
  };

  return (
    <section
      className="md42"
      data-sheet={sheet.index + 1}
      aria-label={`Navigation log sheet ${sheet.index + 1} of ${sheet.count}`}
    >
      <div className="date-top">
        <V t={h.date} cap={16} cls="date" />
        {sheet.count > 1 && <span className="pgno">{sheet.index + 1}</span>}
      </div>
      <div className="fold-line" />
      <div className="g hdr">
        <div className="title">Flight Planner</div>
        <div className="lbl">AIRCRAFT</div>
        <HV t={h.aircraft} />
        <div className="lbl">TAKE-OFF</div>
        <HV t="" />
        <div className="lbl">BLOCK START</div>
        <HV t={h.blockStart} />
        <div className="lbl">BLOCK END</div>
        <HV t="" />
        <div className="lbl">ATIS CODE</div>
        <HV t="" />
        <div className="lbl">SKY</div>
        <HV t={h.sky} />
        <div className="lbl">TEMP</div>
        <HV t={h.temp} />
        <div className="lbl">WIND</div>
        <HV t={h.wind} />
        <div className="lbl big" style={{ gridColumn: 'span 2' }}>
          En Route
        </div>
        <div className="lbl">QNH</div>
        <HV t={h.qnh} />
        <div className="lbl">RUNWAY</div>
        <HV t={h.runway} />
        <div className="est">{h.est}</div>
      </div>

      <div className="g tbl" style={{ gridTemplateRows: rowsTpl }}>
        <C r={1} c={1} cs={2} cls="h c">
          PLANNED
        </C>
        <C r={2} c={1} rs={2} cls="h">
          TRUE{BR}COURSE
        </C>
        <C r={2} c={2} rs={2} cls="h">
          ALTITUDE
        </C>
        <C r={1} c={3} cs={2} cls="h c">
          PREDICTED WIND
        </C>
        <C r={2} c={3} rs={2} cls="h">
          DIRECTION
        </C>
        <C r={2} c={4} rs={2} cls="h">
          VELOCITY
        </C>
        <C r={1} c={5} rs={3} cls="h">
          TEMP
        </C>
        <C r={1} c={6} rs={3} cls="h">
          PLAN TAS
        </C>
        <C r={1} c={7} rs={3} cls="h">
          WIND{BR}CORR{BR}ANGLE{BR}-L&nbsp;&nbsp;+R
        </C>
        <C r={1} c={8} rs={3}>
          <TwoH a={<>TRUE{BR}HEADING</>} b={<>-E +W&nbsp;&nbsp;VAR</>} />
        </C>
        <C r={1} c={9} rs={3} cls="fold">
          <TwoH a={<>MAG{BR}HEADING</>} b="± DEV" />
        </C>
        <C r={1} c={10} cls="h big">
          Checkpoints
        </C>
        <C r={2} c={10} rs={2} cls="cp-end">
          <div className="h end-lbl">{sheet.topLabel}</div>
        </C>
        {/* the origin sits on the line above the first leg's arrows, as every other checkpoint does */}
        <C r={4} c={10} cls="cpn-cell">
          <div className="cpn cpn-origin">{sheet.topName}</div>
        </C>
        <C r={1} c={11} rs={3} cls="h">
          COMPASS{BR}HEADING
        </C>
        <C r={1} c={12} cls="h">
          DIST
        </C>
        <C r={1} c={13} cls="h">
          GS
        </C>
        <C r={2} c={12} cls="h">
          LEG
        </C>
        <C r={2} c={13} cls="h">
          EST
        </C>
        <C r={3} c={12} cls="h">
          REM
        </C>
        <C r={3} c={13} cls="h">
          ACT
        </C>
        <C r={1} c={14} rs={3}>
          <TwoH a="ETE" b="ATE" />
        </C>
        <C r={1} c={15} rs={3}>
          <TwoH a="ETA" b="ATA" />
        </C>
        <C r={1} c={16} rs={3}>
          <TwoH a={<>FUEL{BR}USED</>} b={<>FUEL{BR}REM.</>} />
        </C>
        <C r={1} c={17} cs={2} cls="h c">
          <b>VOR</b>
        </C>
        <C r={2} c={17} cls="h">
          FREQ
        </C>
        <C r={2} c={18} cls="h">
          BEARING
        </C>
        <C r={3} c={17} cls="h">
          IDENT
        </C>
        <C r={3} c={18} cls="h">
          TO/FROM
        </C>
        <C r={1} c={19} rs={3} cls="h">
          TRANS-{BR}PONDER{BR}CODES{BR}&apos;SQUAWKS&apos;
        </C>

        {Array.from({ length: LEGS_PER_SHEET }, (_, j) => legCells(j))}

        <C r={tr} c={1} cs={9} cls="ti-title fold">
          Terminal Information
        </C>
        <C r={tr} c={10} cls="cp-end total-row">
          {sheet.bottomLabel && <div className="h end-lbl end-lbl-bottom">{sheet.bottomLabel}</div>}
        </C>
        {/* the name after the last row sits on the line above the totals, as every other checkpoint does */}
        <C r={tr} c={10} cls="cpn-cell">
          <div className="cpn cpn-bottom">{sheet.bottomName}</div>
        </C>
        <C r={tr} c={11} cls="tot-label total-row">
          TOTALS
        </C>
        <C r={tr} c={12} cls="total-row">
          <V t={sheet.totals.dist} />
        </C>
        <C r={tr} c={13} cls="total-row" />
        <C r={tr} c={14} cls="total-row">
          <V t={sheet.totals.ete} />
        </C>
        <C r={tr} c={15} cls="total-row" />
        <C r={tr} c={16} cls="total-row">
          <V t={sheet.totals.fuel} />
        </C>
        <C r={tr} c={17} cs={3} cls="sunset total-row">
          <V t={sheet.totals.sunset} cap={12} />
        </C>
      </div>

      <div className="g foot">
        <div className="ti">
          <div className="th">Field</div>
          <div className="th">Elevation</div>
          <div className="th">Runways</div>
          <div className="th">Radio Frequencies</div>
          {Array.from({ length: nRows }, (_, i) => (
            <TerminalCells key={i} t={terminal[i]} rowH={(165 * weights[i]) / totalWeight} />
          ))}
        </div>
        <div className="notes">
          <div className="th">Notes:</div>
          <div className="note-lines">
            {Array.from({ length: NOTE_LINES }, (_, i) => (
              <div key={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
