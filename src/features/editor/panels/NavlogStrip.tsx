// Collapsible navlog strip under the map: live legs (altitude, editable in place; TC/MC, wind, WCA,
// MH, DEV/CH, GS, ETE, ETA, fuel) from computeNavlog(), a winds refresh, and every warning of the
// flight (winds, compass card, W&B, performance, crosswind, fuel, manifest), each with its fix: the
// ones about one leg (hazards, crosswind, altitude…) under that leg's row, the rest in the list.
// A click anywhere on the header (not on its buttons) opens or closes it.
import { Fragment, type KeyboardEvent, type MouseEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';

import { AipRefText } from '../../../app/AipLink';
import { fmtAltitude, fmtHdg } from '../../../calc';
import { flightStore } from '../../../data/flightStore';
import type { RouteWeather } from '../../../data/weather';
import { fmtClock, fmtDuration, fmtEte } from '../../../shared/format';
import { Icon, NumberField } from '../../../ui';
import { editorWarningFix, focusInEditor } from '../focus';
import { useSetHoveredLeg } from '../legHover';
import { setAltitudeOverride } from '../map/routeEdit';
import { useNotams } from '../notams';
import { useResizable } from '../resizable';
import { useEditor } from '../state';
import { type CalcWarning, useFlightCalc } from './calc';

const LS_KEY = 'pgf.editor.strip';
type StripState = 'open' | 'closed' | 'warnings';
const load = (): StripState => {
  try {
    return (localStorage.getItem(LS_KEY) as StripState) || 'open';
  } catch {
    return 'open';
  }
};
const save = (s: StripState) => {
  try {
    localStorage.setItem(LS_KEY, s);
  } catch {
    /* ignore */
  }
};

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
const signed = (x: number | undefined) => (fin(x) ? (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : '0') : '');
const hdg = (x: number | undefined) => (fin(x) ? fmtHdg(x) : '');
const fmtMin = (min: number) => fmtClock(min, { fallback: '--:--' });
const fmtDur = (min: number) => fmtDuration(min, { fallback: '–' });
const fmtLegTime = (min: number) => fmtEte(min, { fallback: '–' });

/** The winds aloft when they are not simply there: being fetched, or missing (and why). */
export function windsStatusText(
  weather: RouteWeather | null,
  loading: boolean,
  hasLegs: boolean,
): { text: string; title?: string; tone?: 'warn' } {
  if (loading) return { text: 'Fetching winds…' };
  if (!weather) return { text: hasLegs ? 'No winds' : '' };
  if (weather.status !== 'ok') return { text: 'No winds', title: weather.message, tone: 'warn' };
  return { text: '' };
}

/** The warnings about one leg, by leg (shown under its row), and the rest (the list). */
export function splitWarnings(
  list: CalcWarning[],
  legCount: number,
): { general: CalcWarning[]; byLeg: CalcWarning[][] } {
  const byLeg: CalcWarning[][] = Array.from({ length: legCount }, () => []);
  const general: CalcWarning[] = [];
  for (const w of list) {
    if (w.leg && w.leg.index >= 0 && w.leg.index < legCount) byLeg[w.leg.index].push(w);
    else general.push(w);
  }
  return { general, byLeg };
}

const ORDER = { danger: 0, warn: 1, info: 2 } as const;
const byLevel = (list: CalcWarning[]) => [...list].sort((a, b) => ORDER[a.level] - ORDER[b.level]);

function WarningFix({ text, aircraftId }: { text: string; aircraftId: string | null }) {
  const f = editorWarningFix(text, aircraftId);
  if (!f) return null;
  return 'to' in f ? (
    <Link to={f.to} className="warning-fix" data-testid="warning-fix">
      {f.label} →
    </Link>
  ) : (
    <button type="button" className="linkish warning-fix" data-testid="warning-fix" onClick={f.onFix}>
      {f.label} →
    </button>
  );
}

const NOT_TOGGLE = 'button, a, input, select, textarea, label, [data-no-toggle]';

function WarningItem({
  w,
  text,
  aircraftId,
  size,
}: {
  w: CalcWarning;
  text: string;
  aircraftId: string | null;
  size: number;
}) {
  return (
    <li className={w.level}>
      <Icon name={w.level === 'info' ? 'info' : 'warn'} size={size} />
      <span className="warning-text">
        <AipRefText text={text} />
      </span>
      <WarningFix text={w.text} aircraftId={aircraftId} />
    </li>
  );
}

/** The flight's warnings: the general ones, then the legs' own (in leg order, each named by its leg). */
function Warnings({
  list,
  ofLegs,
  aircraftId,
}: {
  list: CalcWarning[];
  ofLegs: CalcWarning[];
  aircraftId: string | null;
}) {
  if (!list.length && !ofLegs.length) return <p className="muted ns-empty">No warnings.</p>;
  return (
    <>
      {list.length > 0 && (
        <ul className="warnings ns-warnings" data-testid="navlog-warnings">
          {byLevel(list).map((w) => (
            <WarningItem key={w.text} w={w} text={w.text} aircraftId={aircraftId} size={14} />
          ))}
        </ul>
      )}
      {ofLegs.length > 0 && (
        <ul className="warnings ns-warnings" data-testid="navlog-warnings-legs">
          {ofLegs.map((w) => (
            <WarningItem key={`${w.leg?.index}|${w.text}`} w={w} text={w.text} aircraftId={aircraftId} size={14} />
          ))}
        </ul>
      )}
    </>
  );
}

/** A leg's own warnings, in a row under the leg's row (without the 'A → B: ' of the list). */
function LegWarnings({
  list,
  index,
  colSpan,
  aircraftId,
}: {
  list: CalcWarning[];
  index: number;
  colSpan: number;
  aircraftId: string | null;
}) {
  if (!list.length) return null;
  return (
    <tr className="ns-leg-warn" data-testid="navlog-leg-warnings" data-leg={index}>
      <td colSpan={colSpan}>
        <ul className="warnings">
          {byLevel(list).map((w) => (
            <WarningItem key={w.text} w={w} text={w.leg?.detail ?? w.text} aircraftId={aircraftId} size={12} />
          ))}
        </ul>
      </td>
    </tr>
  );
}

export function NavlogStrip() {
  const { flight, doc, legs, aircraft, altitudeDefaults, update, readOnly } = useEditor();
  const setHoveredLeg = useSetHoveredLeg();
  const { navlog, weather, weatherLoading, refreshWeather, warnings, dayMs } = useFlightCalc();
  const { selectedNotam } = useNotams();
  const notamLeg = selectedNotam?.legIndex ?? null;
  const [state, setState] = useState<StripState>(load);
  const set = (s: StripState) => {
    setState(s);
    save(s);
  };
  // Height of the open strip, set by dragging its top edge.
  const r = useResizable({
    key: 'pgf.editor.stripHeight',
    axis: 'y',
    dir: -1,
    min: 90,
    max: () => Math.round(window.innerHeight * 0.8),
    initial: null,
  });
  // The open strip's height, for the flight panel's collapse tab to centre itself on the map above it.
  useEffect(() => {
    const el = r.panelRef.current;
    const host = el?.closest<HTMLElement>('.editor-body');
    if (!el || !host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => host.style.setProperty('--ns-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.style.removeProperty('--ns-h');
    };
  }, [r.panelRef]);
  const { general, byLeg } = splitWarnings(warnings, legs.length);
  const setAlt = (key: string, altFt: number | null) =>
    update(
      (d) => {
        const legOverrides = setAltitudeOverride(d.legOverrides, key, altFt);
        return legOverrides === d.legOverrides ? d : { ...d, legOverrides };
      },
      { coalesce: `alt:${key}` },
    );
  const setTas = (key: string, tasKt: number | null) =>
    update(
      (d) => {
        const cur = d.legOverrides[key] ?? {};
        if ((cur.tasKt ?? null) === tasKt) return d;
        const { tasKt: _drop, ...rest } = cur;
        const next = tasKt == null ? rest : { ...rest, tasKt };
        const legOverrides = { ...d.legOverrides };
        if (Object.keys(next).length) legOverrides[key] = next;
        else delete legOverrides[key];
        return { ...d, legOverrides };
      },
      { coalesce: `tas:${key}` },
    );
  const danger = warnings.filter((w) => w.level === 'danger').length;
  const warn = warnings.filter((w) => w.level === 'warn').length;

  const wx = windsStatusText(weather, weatherLoading, legs.length > 0);
  const t = navlog?.times;
  const toggle = () => set(state === 'closed' ? 'open' : 'closed');
  const onHeadClick = (e: MouseEvent<HTMLElement>) => {
    const hit = (e.target as Element).closest(NOT_TOGGLE);
    if (hit && e.currentTarget.contains(hit)) return;
    toggle();
  };
  const onHeadKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };

  return (
    <section
      className={'ns' + (state === 'closed' ? ' closed' : '') + (r.size != null && state !== 'closed' ? ' sized' : '')}
      data-testid="navlog-strip"
      ref={(el) => {
        r.panelRef.current = el;
      }}
      style={r.size != null && state !== 'closed' ? { height: r.size } : undefined}
    >
      {state !== 'closed' && <div {...r.handleProps} aria-label="Resize the navlog" data-testid="resize-navlog" />}
      <header
        className="ns-head"
        role="button"
        tabIndex={0}
        aria-expanded={state !== 'closed'}
        aria-label="Navlog"
        data-testid="navlog-toggle"
        onClick={onHeadClick}
        onKeyDown={onHeadKey}
      >
        <span className="ns-title">
          <Icon name="caret" size={12} className="ns-caret" />
          <b>Navlog</b>
        </span>
        {navlog && navlog.legs.length > 0 ? (
          <span className="ns-totals tnum" data-testid="navlog-totals">
            <span>{navlog.totals.dist} NM</span>
            <span>{fmtDur(navlog.totals.ete)}</span>
            <span>{navlog.totals.tripFuel} L trip</span>
            {t && navlog.blockOffSet && (
              <span>
                TO {fmtMin(t.takeoffMin)}Z → LDG {fmtMin(t.landingMin)}Z
              </span>
            )}
          </span>
        ) : (
          <span className="muted">{legs.length ? (aircraft ? '' : 'No aircraft') : 'No route'}</span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className={
            'ns-warn-btn' + (danger ? ' danger' : warn ? ' warn' : '') + (state === 'warnings' ? ' active' : '')
          }
          onClick={() => set(state === 'warnings' ? 'open' : 'warnings')}
          data-testid="navlog-warn-toggle"
          aria-pressed={state === 'warnings'}
          title={state === 'warnings' ? 'Back to the navlog' : 'Show the warnings'}
        >
          <Icon name="warn" size={14} />{' '}
          {danger + warn > 0 ? `${danger + warn} warning${danger + warn > 1 ? 's' : ''}` : 'No warnings'}
          {state === 'warnings' && <Icon name="x" size={12} className="ns-warn-close" />}
        </button>
        {wx.text && (
          <span className={'ns-wx' + (wx.tone ? ' ' + wx.tone : '')} title={wx.title} data-testid="winds-status">
            {wx.text}
          </span>
        )}
        <button
          type="button"
          className="icon"
          title="Refresh winds and METAR"
          aria-label="Refresh winds and METAR"
          onClick={refreshWeather}
          disabled={weatherLoading || !legs.length}
          data-testid="refresh-weather"
        >
          <Icon name="refresh" />
        </button>
        {/* the one sheet that is printed: the navlog, on its own page */}
        <Link
          to={`/flights/${flight.id}/export/navlog`}
          className="btn icon"
          title="Print the navlog"
          aria-label="Print the navlog"
          onClick={() => void flightStore.flushNow()}
          data-testid="print-navlog"
        >
          <Icon name="print" />
        </Link>
      </header>
      {state === 'warnings' && (
        <div className="ns-body">
          <Warnings list={general} ofLegs={byLeg.flat()} aircraftId={doc.aircraftId} />
        </div>
      )}
      {state === 'open' && (
        <div className="ns-body">
          {!legs.length ? (
            <p className="muted ns-empty">Click the map to draw the route.</p>
          ) : !navlog ? (
            <table className="ns-table">
              <thead>
                <tr>
                  <th>Leg</th>
                  <th className="num">MC</th>
                  <th className="num">Dist</th>
                </tr>
              </thead>
              <tbody>
                {legs.map((l, i) => (
                  <Fragment key={l.key}>
                    <tr>
                      <td>
                        {l.from.name} → {l.to.name}
                      </td>
                      <td className="num">{fmtHdg(l.mcMag)}°</td>
                      <td className="num">{Math.round(l.distNm)}</td>
                    </tr>
                    <LegWarnings list={byLeg[i] ?? []} index={i} colSpan={3} aircraftId={doc.aircraftId} />
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : (
            // a flight shared as a viewer: the altitude and TAS fields are read-only
            <fieldset className="ep-readonly" disabled={readOnly}>
              <table className="ns-table" data-testid="navlog-table">
                <thead>
                  <tr>
                    <th>Leg</th>
                    <th className="num">Alt</th>
                    <th className="num">TAS</th>
                    <th className="num">TC</th>
                    <th className="num">MC</th>
                    <th className="num">Wind</th>
                    <th className="num">Temp</th>
                    <th className="num">WCA</th>
                    <th className="num">MH</th>
                    <th className="num">Dev</th>
                    <th className="num">CH</th>
                    <th className="num">GS</th>
                    <th className="num">Dist</th>
                    <th className="num">ETE</th>
                    <th className="num">ETA</th>
                    <th className="num">Fuel</th>
                  </tr>
                </thead>
                <tbody>
                  {navlog.legs.map((r, i) => {
                    const L = legs[i];
                    const noWind = r.windMissing;
                    const override = L ? doc.legOverrides[L.key]?.altFt : undefined;
                    const dflt = altitudeDefaults[i]?.altFt;
                    const tasSet = L ? doc.legOverrides[L.key]?.tasKt : undefined;
                    return (
                      <Fragment key={L?.key ?? i}>
                        <tr
                          data-testid="navlog-row"
                          onMouseEnter={() => setHoveredLeg(i)}
                          onMouseLeave={() => setHoveredLeg(null)}
                          className={notamLeg === i ? 'is-notam' : undefined}
                          title={
                            notamLeg === i && selectedNotam ? `NOTAM ${selectedNotam.key} near this leg` : undefined
                          }
                        >
                          <td className="ns-leg">
                            <span>{L?.from.name}</span>
                            <span className="muted"> → </span>
                            <span>{L?.to.name}</span>
                          </td>
                          <td className={'num ns-alt' + (fin(r.altFt) ? '' : ' warn')}>
                            {L ? (
                              <NumberField
                                value={override ?? null}
                                onChange={(v) => setAlt(L.key, v)}
                                integer
                                min={0}
                                max={20000}
                                step={100}
                                placeholder={fin(dflt) ? fmtAltitude(dflt) : '?'}
                                className={override != null ? 'is-set' : undefined}
                                ariaLabel={`Altitude ${L.from.name} → ${L.to.name}, feet`}
                                testId="navlog-alt"
                                showLimit={false}
                                commitOnEnter
                                fillValue={fin(dflt) ? dflt : null}
                              />
                            ) : fin(r.altFt) ? (
                              fmtAltitude(r.altFt)
                            ) : (
                              '?'
                            )}
                          </td>
                          <td className="num ns-tas">
                            {L ? (
                              <NumberField
                                value={tasSet ?? null}
                                onChange={(v) => setTas(L.key, v)}
                                integer
                                min={20}
                                max={300}
                                placeholder={tasSet == null && fin(r.tasKt) ? String(r.tasKt) : '?'}
                                className={tasSet != null ? 'is-set' : undefined}
                                ariaLabel={`TAS ${L.from.name} → ${L.to.name}, knots`}
                                testId="navlog-tas"
                                showLimit={false}
                                commitOnEnter
                                fillValue={tasSet == null && fin(r.tasKt) ? r.tasKt : null}
                              />
                            ) : (
                              r.tasKt
                            )}
                          </td>
                          <td className="num">{hdg(r.tc)}</td>
                          <td className="num">{hdg(r.mc)}</td>
                          <td
                            className={'num' + (noWind ? ' warn' : '')}
                            title={
                              noWind
                                ? 'No forecast: calm assumed'
                                : r.windSource === 'override'
                                  ? 'Wind typed by hand'
                                  : 'Forecast'
                            }
                          >
                            {noWind ? '—' : `${fmtHdg(r.windDirDeg)}/${r.windKt}`}
                            {r.windSource === 'override' ? '*' : ''}
                          </td>
                          <td className="num">{fin(r.tempC) ? `${r.tempC}°` : ''}</td>
                          <td className="num">{signed(r.wca)}</td>
                          <td className="num">{hdg(r.mh)}</td>
                          <td className="num">{signed(r.dev)}</td>
                          <td className="num">
                            <b>{hdg(r.ch ?? r.mh)}</b>
                          </td>
                          <td className="num">{fin(r.gs) ? r.gs : ''}</td>
                          <td className="num">{r.dist}</td>
                          <td className="num">{fin(r.ete) ? fmtLegTime(r.ete) : ''}</td>
                          <td className="num">{fin(r.endMin) && fin(dayMs) ? fmtMin(r.endMin) : ''}</td>
                          <td className="num">{fin(r.fuel) ? r.fuel : ''}</td>
                        </tr>
                        <LegWarnings list={byLeg[i] ?? []} index={i} colSpan={16} aircraftId={doc.aircraftId} />
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={12}>
                      {navlog.legs.length} legs
                      {!navlog.blockOffSet && (
                        <>
                          {' '}
                          ·{' '}
                          <button
                            type="button"
                            className="linkish"
                            data-testid="navlog-blockoff-fix"
                            onClick={() => focusInEditor('blockOff')}
                          >
                            block start not set: 12:00Z assumed
                          </button>
                        </>
                      )}
                    </td>
                    <td className="num">{navlog.totals.dist}</td>
                    <td className="num">{fmtLegTime(navlog.totals.ete)}</td>
                    <td />
                    <td className="num">{navlog.totals.tripFuel}</td>
                  </tr>
                </tfoot>
              </table>
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
