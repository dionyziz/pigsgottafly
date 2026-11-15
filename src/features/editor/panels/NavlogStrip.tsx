// Collapsible navlog strip under the map: live legs (altitude, TC/MC, wind, WCA, MH, DEV/CH, GS,
// ETE, ETA, fuel) from computeNavlog(), the winds source with a refresh, and every warning of the
// flight (winds, compass card, W&B, performance, crosswind, fuel, manifest).
import { useState } from 'react';
import { fmtHdg } from '../../../calc';
import { WIND_MODELS, type WindModel } from '../../../shared';
import { useEditor } from '../state';
import { useNotams } from '../notams';
import { fmtDur, fmtMin, useFlightCalc, type CalcWarning } from './calc';
import { Icon } from './ui';
import { useResizable } from '../resizable';

const LS_KEY = 'pgf.editor.strip';
type StripState = 'open' | 'closed' | 'warnings';
const load = (): StripState => { try { return (localStorage.getItem(LS_KEY) as StripState) || 'open'; } catch { return 'open'; } };
const save = (s: StripState) => { try { localStorage.setItem(LS_KEY, s); } catch { /* ignore */ } };

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
const signed = (x: number | undefined) => (fin(x) ? (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : '0') : '');
const hdg = (x: number | undefined) => (fin(x) ? fmtHdg(x) : '');

function Warnings({ list }: { list: CalcWarning[] }) {
  if (!list.length) return <p className="muted ns-empty">No warnings.</p>;
  const order = { danger: 0, warn: 1, info: 2 } as const;
  return (
    <ul className="ns-warnings" data-testid="navlog-warnings">
      {[...list].sort((a, b) => order[a.level] - order[b.level]).map((w) => (
        <li key={w.text} className={w.level}><Icon name="warn" size={14} /><span>{w.text}</span></li>
      ))}
    </ul>
  );
}

export function NavlogStrip() {
  const { doc, legs, update, aircraft } = useEditor();
  const { navlog, weather, weatherLoading, refreshWeather, warnings, dayMs } = useFlightCalc();
  const { selectedNotam } = useNotams();
  const notamLeg = selectedNotam?.legIndex ?? null;
  const [state, setState] = useState<StripState>(load);
  const set = (s: StripState) => { setState(s); save(s); };
  // Height of the open strip, set by dragging its top edge.
  const r = useResizable({ key: 'pgf.editor.stripHeight', axis: 'y', dir: -1, min: 90, max: () => Math.round(window.innerHeight * 0.8), initial: null });
  const danger = warnings.filter((w) => w.level === 'danger').length;
  const warn = warnings.filter((w) => w.level === 'warn').length;

  const wxText = weatherLoading ? 'Fetching winds…' : weather ? (weather.status === 'ok' ? weather.message : weather.message || 'No winds') : legs.length ? 'No winds' : '';
  const wxTone = weather && weather.status !== 'ok' && !weatherLoading ? 'warn' : '';
  const t = navlog?.times;

  return (
    <section className={'ns' + (state === 'closed' ? ' closed' : '') + (r.size != null && state !== 'closed' ? ' sized' : '')} data-testid="navlog-strip"
      ref={(el) => { r.panelRef.current = el; }} style={r.size != null && state !== 'closed' ? { height: r.size } : undefined}>
      {state !== 'closed' && <div {...r.handleProps} aria-label="Resize the navlog" data-testid="resize-navlog" />}
      <header className="ns-head">
        <button type="button" className="ns-toggle" onClick={() => set(state === 'closed' ? 'open' : 'closed')} aria-expanded={state !== 'closed'}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="ep-caret"><path d="M3 7.5 6 4.5 9 7.5" /></svg>
          <b>Navlog</b>
        </button>
        {navlog && navlog.legs.length > 0 ? (
          <span className="ns-totals mono" data-testid="navlog-totals">
            <span>{navlog.totals.dist} NM</span>
            <span>{fmtDur(navlog.totals.ete)}</span>
            <span>{navlog.totals.tripFuel} L trip</span>
            {t && navlog.blockOffSet && <span>TO {fmtMin(t.takeoffMin)}Z → LDG {fmtMin(t.landingMin)}Z</span>}
          </span>
        ) : (
          <span className="muted">{legs.length ? (aircraft ? '' : 'Choose an aircraft') : 'Draw a route on the map'}</span>
        )}
        <span className="spacer" />
        <button type="button" className={'ns-warn-btn' + (danger ? ' danger' : warn ? ' warn' : '')} onClick={() => set(state === 'warnings' ? 'open' : 'warnings')} data-testid="navlog-warn-toggle"
          title="Warnings">
          <Icon name="warn" size={14} /> {danger + warn > 0 ? `${danger + warn} warning${danger + warn > 1 ? 's' : ''}` : 'No warnings'}
        </button>
        <span className={'ns-wx ' + wxTone} title={wxText}>{wxText}</span>
        <select className="ns-model" value={doc.options.windModel} aria-label="Wind model"
          onChange={(e) => update((d) => ({ ...d, options: { ...d.options, windModel: e.target.value as WindModel } }))}>
          {Object.entries(WIND_MODELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="button" className="icon" title="Refresh winds and METAR" onClick={refreshWeather} disabled={weatherLoading || !legs.length} data-testid="refresh-weather">
          <Icon name="refresh" />
        </button>
      </header>
      {state === 'warnings' && <div className="ns-body"><Warnings list={warnings} /></div>}
      {state === 'open' && (
        <div className="ns-body">
          {!legs.length ? (
            <p className="muted ns-empty">Click on the map to draw the route. Legs appear here with winds, headings, times and fuel.</p>
          ) : !navlog ? (
            <table className="ns-table"><thead><tr><th>Leg</th><th className="num">MC</th><th className="num">Dist</th></tr></thead><tbody>
              {legs.map((l) => <tr key={l.key}><td>{l.from.name} → {l.to.name}</td><td className="num">{fmtHdg(l.mcMag)}°</td><td className="num">{Math.round(l.distNm)}</td></tr>)}
            </tbody></table>
          ) : (
            <table className="ns-table" data-testid="navlog-table">
              <thead>
                <tr>
                  <th>Leg</th><th className="num">Alt</th><th className="num">TAS</th><th className="num">TC</th><th className="num">MC</th>
                  <th className="num">Wind</th><th className="num">Temp</th><th className="num">WCA</th><th className="num">MH</th><th className="num">Dev</th><th className="num">CH</th>
                  <th className="num">GS</th><th className="num">Dist</th><th className="num">ETE</th><th className="num">ETA</th><th className="num">Fuel</th>
                </tr>
              </thead>
              <tbody>
                {navlog.legs.map((r, i) => {
                  const L = legs[i];
                  const noWind = r.windMissing;
                  return (
                    <tr key={L?.key ?? i} data-testid="navlog-row" className={notamLeg === i ? 'is-notam' : undefined}
                      title={notamLeg === i && selectedNotam ? `NOTAM ${selectedNotam.key} near this leg` : undefined}>
                      <td className="ns-leg"><span>{L?.from.name}</span><span className="muted"> → </span><span>{L?.to.name}</span></td>
                      <td className={'num' + (fin(r.altFt) ? '' : ' warn')}>{fin(r.altFt) ? r.altFt : '?'}</td>
                      <td className="num">{r.tasKt}</td>
                      <td className="num">{hdg(r.tc)}</td>
                      <td className="num">{hdg(r.mc)}</td>
                      <td className={'num' + (noWind ? ' warn' : '')} title={noWind ? 'No forecast: calm assumed' : r.windSource === 'override' ? 'Wind typed by hand' : 'Forecast'}>
                        {noWind ? '—' : `${String(Math.round(r.windDirDeg)).padStart(3, '0')}/${r.windKt}`}{r.windSource === 'override' ? '*' : ''}
                      </td>
                      <td className="num">{fin(r.tempC) ? `${r.tempC}°` : ''}</td>
                      <td className="num">{signed(r.wca)}</td>
                      <td className="num">{hdg(r.mh)}</td>
                      <td className="num">{signed(r.dev)}</td>
                      <td className="num"><b>{hdg(r.ch ?? r.mh)}</b></td>
                      <td className="num">{fin(r.gs) ? r.gs : ''}</td>
                      <td className="num">{r.dist}</td>
                      <td className="num">{fin(r.ete) ? r.ete : ''}</td>
                      <td className="num">{fin(r.endMin) && fin(dayMs) ? fmtMin(r.endMin) : ''}</td>
                      <td className="num">{fin(r.fuel) ? r.fuel : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={12}>{navlog.legs.length} legs{!navlog.blockOffSet && <span className="muted"> · block-off not set: 12:00Z assumed</span>}</td>
                  <td className="num">{navlog.totals.dist}</td>
                  <td className="num">{navlog.totals.ete}</td>
                  <td />
                  <td className="num">{navlog.totals.tripFuel}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
