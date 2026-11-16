// Take-off and landing: conditions (METAR when current, else forecast), runway (from the wind, or
// chosen), surface condition, wind components, and required vs available distances. At the
// departure, at each intermediate full stop and touch-and-go (the landing there and the take-off
// from there, with the sector masses) and at the destination.
import { perfVerdict, type PerfVerdictResult } from '../../../calc/perfVerdict';
import { runwaysOf } from '../../../data/ref';
import type { Aircraft } from '../../../shared';
import { setStopChoice, type FlightOptions } from '../../../shared';
import { useEditor } from '../state';
import { fmtClock } from '../../../shared/format';
import { Collapsible } from '../../../ui';
import { useFlightCalc, type EndpointCalc } from './calc';
import { Chip, KV, Section, SECTIONS_STORE } from './ui';

const m = (x: number | null | undefined) => (x == null || !isFinite(x) ? '–' : `${Math.round(x)} m`);

/** The conditions in one line: '240°/12 kt · 18°C · Q1013' (wind direction true). */
export function weatherText(e: Pick<EndpointCalc, 'surface'>): string {
  const s = e.surface;
  if (!s) return 'ISA, calm';
  const w = s.wind;
  const wind = !w ? 'wind –'
    : !(w.speedKt > 0.5) ? 'calm'
    : `${w.dirTrueDeg == null ? 'VRB' : `${String(Math.round(w.dirTrueDeg) % 360 || 360).padStart(3, '0')}°`}/${Math.round(w.speedKt)}${w.gustKt ? `G${Math.round(w.gustKt)}` : ''} kt`;
  const temp = s.tempC != null ? `${Math.round(s.tempC)}°C` : '–°C';
  const qnh = s.qnhHpa != null ? `Q${Math.round(s.qnhHpa)}` : 'Q–';
  return `${wind} · ${temp} · ${qnh}`;
}

/** The same verdict as the MD 4.4 export (mass limit, distances, crosswind, AFM table range). */
export function endpointVerdict(e: EndpointCalc, aircraft: Aircraft | null): PerfVerdictResult {
  return perfVerdict({ phase: e.phase, massKg: e.massKg, perf: e.perf, massBalance: aircraft?.massBalance ?? null, hasAerodrome: !!e.aerodrome });
}

function VerdictChip({ v }: { v: PerfVerdictResult }) {
  if (v.verdict === 'pass') return <Chip tone="ok" title={v.text}>Fits</Chip>;
  if (v.verdict === 'fail') return <Chip tone="danger" title={v.text}>No-go</Chip>;
  return <Chip tone="warn" title={v.text}>?</Chip>;
}

function reasonText(v: PerfVerdictResult): string {
  if (!v.overMass && v.text === 'Outside the AFM table') return 'Outside the AFM table: distances extrapolated.';
  const head = v.overMass ? v.overMass.text : `${v.text}.`;
  return v.extrapolated ? `${head} Distances extrapolated beyond the AFM table.` : head;
}

function Endpoint({ e }: { e: EndpointCalc }) {
  const { doc, update, aircraft } = useEditor();
  const { dayMs } = useFlightCalc();
  const to = e.phase === 'takeoff';
  const ad = e.aerodrome;
  const rwKey: keyof FlightOptions = to ? 'departureRunway' : 'arrivalRunway';
  const sfKey: keyof FlightOptions = to ? 'departureSurface' : 'arrivalSurface';
  // A stop keeps its runway (landing / take-off) and surface on its AerodromeRequest.
  const stopReq = e.stopUid ? (doc.options.aerodromeRequests ?? []).find((r) => r.pointUid === e.stopUid) : undefined;
  const runwayValue = e.stopUid ? (to ? stopReq?.takeoffRunway : stopReq?.landingRunway) ?? null : (doc.options[rwKey] as string | null);
  const surfaceValue = e.stopUid ? stopReq?.surface ?? null : (doc.options[sfKey] as string | null);
  const setRunway = (v: string | null) => update((d) => ({ ...d, options: e.stopUid
    ? { ...d.options, aerodromeRequests: setStopChoice(d.options.aerodromeRequests, e.stopUid, to ? 'takeoffRunway' : 'landingRunway', v) }
    : { ...d.options, [rwKey]: v } }));
  const setSurface = (v: string | null) => update((d) => ({ ...d, options: e.stopUid
    ? { ...d.options, aerodromeRequests: setStopChoice(d.options.aerodromeRequests, e.stopUid, 'surface', v) }
    : { ...d.options, [sfKey]: v } }));
  const tid = e.stopUid ? `stop-${e.phase}` : e.phase;
  const runways = ad ? runwaysOf(ad.id) : [];
  const conditions = Object.keys(aircraft?.performance.factors.runwayCondition ?? {});
  const p = e.perf;
  const v = endpointVerdict(e, aircraft);
  const extrap = v.extrapolated ? 'extrapolated beyond the AFM table' : undefined;
  const title = e.stopKind === 'touch-and-go' ? (to ? 'Touch-and-go take-off' : 'Touch-and-go landing')
    : e.stopUid ? (to ? 'Take-off from stop' : 'Landing at stop') : to ? 'Departure' : 'Destination';
  const timeMin = isFinite(e.timeMs) && isFinite(dayMs) ? (e.timeMs - dayMs) / 60000 : NaN;

  if (!ad) return <div className="ep-perf ep-perf-none"><b>{title}</b> <span className="muted">not an aerodrome</span></div>;
  const showVerdict = !!(p || v.overMass);
  const runway = p?.runway?.designator ?? runwayValue;
  const dist = p?.distances
    ? `${to ? 'TODR/TODA' : 'LDR/LDA'} ${Math.round(p.distances.requiredTotalM)}/${p.availableTotalM != null ? Math.round(p.availableTotalM) : '–'} m`
    : null;
  const summary = [showVerdict ? (v.verdict === 'pass' ? 'Fits' : v.verdict === 'fail' ? 'No-go' : 'Check') : null, runway ? `RWY ${runway}` : null, dist]
    .filter(Boolean).join(' · ');
  return (
    <Collapsible id={`perf-${tid}-${ad.id}`} store={SECTIONS_STORE} className="ep-perf" testId={`perf-${tid}`}
      title={<>{title} {ad.icao ?? ''}</>}
      badge={<>
        <span className="muted ellipsis">{ad.name}</span>
        {showVerdict && <span className="ep-perf-verdict" data-testid={`perf-verdict-${tid}`} data-verdict={v.verdict}><VerdictChip v={v} /></span>}
      </>}
      summary={summary ? <span className="tnum" data-testid={`perf-summary-${tid}`}>{summary}</span> : undefined}>
      {showVerdict && v.verdict !== 'pass' && (
        <div className={`ep-note ${v.verdict === 'fail' ? 'danger-text' : 'warn-text'}`} data-testid={`perf-reason-${tid}`}>
          {reasonText(v)}
        </div>
      )}
      <div className="ep-kvs">
        <KV k={to ? 'Take-off' : 'Landing'} v={<span className="tnum">{isFinite(timeMin) ? `${fmtClock(timeMin, { fallback: '--:--' })}Z` : '–'}</span>}
          sub={e.surface ? (e.surface.source === 'metar' ? e.surface.label : 'forecast') : undefined} />
        <KV k="Weather" testId={`perf-weather-${tid}`} v={<span className="tnum">{weatherText(e)}</span>} />
        {e.reports?.metar && <div className="ep-metar mono" title="METAR">{e.reports.metar.raw}</div>}
      </div>
      <div className="ep-grid2">
        <label className="field">Runway
          <select value={runwayValue ?? ''} onChange={(ev) => setRunway(ev.target.value || null)}>
            <option value="">Auto (wind){p?.runway && !runwayValue ? `: ${p.runway.designator}` : ''}</option>
            {runways.map((r) => <option key={r.designator} value={r.designator}>{r.designator}{r.surface ? ` · ${r.surface}` : ''}</option>)}
          </select>
        </label>
        <label className="field">Surface
          <select value={surfaceValue ?? ''} onChange={(ev) => setSurface(ev.target.value || null)}>
            <option value="">Paved, dry</option>
            {conditions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      {p && (
        <div className="ep-kvs">
          <KV k="Components" v={<span className="tnum">{p.wind.headwindKt >= 0 ? 'H' : 'T'} {Math.abs(p.wind.headwindKt).toFixed(0)} · X {p.wind.crosswindKt.toFixed(0)}{p.wind.crossFrom}{p.crosswindGustKt != null ? ` G${p.crosswindGustKt.toFixed(0)}` : ''} kt</span>}
            sub={p.variableWind ? 'variable: full crosswind' : undefined}
            tone={!p.crosswindOk || p.tailwind ? 'danger' : undefined} />
          <KV k="PA / DA" v={<span className="tnum">{Math.round(p.pressureAltFt)} / {Math.round(p.densityAltFt)} ft</span>} sub={`ISA ${p.isaDevC >= 0 ? '+' : ''}${p.isaDevC.toFixed(0)}°C`} />
          {e.massKg != null && <KV k="Mass" testId={`perf-mass-${tid}`} v={<span className="tnum">{e.massKg.toFixed(0)} kg</span>}
            sub={v.overMass ? `above ${v.overMass.limitName} ${v.overMass.limitKg} kg` : e.massSource === 'mtow' ? (e.massReason === 'weight-missing' ? 'MTOW (weight missing)' : 'MTOW (no W&B)') : undefined}
            tone={v.overMass ? 'danger' : e.massReason === 'weight-missing' ? 'warn' : undefined} />}
          {p.distances && (to ? (
            <>
              <KV k="TORR / TORA" tone={p.availableGroundM != null && p.distances.requiredGroundM > p.availableGroundM ? 'danger' : extrap ? 'warn' : undefined}
                v={<span className="tnum">{m(p.distances.requiredGroundM)} / {m(p.availableGroundM)}</span>} />
              <KV k="TODR / TODA" tone={p.availableTotalM != null && p.distances.requiredTotalM > p.availableTotalM ? 'danger' : extrap ? 'warn' : undefined}
                v={<span className="tnum">{m(p.distances.requiredTotalM)} / {m(p.availableTotalM)}</span>}
                sub={!extrap && !p.alternative ? undefined : <>{extrap && <span data-testid="todr-extrapolated">{extrap}</span>}{extrap && p.alternative ? '; ' : ''}{p.alternative && <span data-testid="todr-methods">{p.distances.method === 'afm' ? 'AFM' : 'DA'} method; {p.alternative.method === 'afm' ? 'AFM' : 'DA'} {m(p.alternative.requiredTotalM)}</span>}</>} />
            </>
          ) : (
            <KV k="LDR / LDA" tone={p.availableTotalM != null && p.distances.requiredTotalM > p.availableTotalM ? 'danger' : extrap ? 'warn' : undefined}
              v={<span className="tnum">{m(p.distances.requiredTotalM)} / {m(p.availableTotalM)}</span>}
              sub={!extrap && !p.alternative ? undefined : <>{extrap && <span data-testid="ldr-extrapolated">{extrap}</span>}{extrap && p.alternative ? '; ' : ''}{p.alternative && <span data-testid="ldr-methods">{p.distances.method === 'afm' ? 'AFM' : 'DA'} method; {p.alternative.method === 'afm' ? 'AFM' : 'DA'} {m(p.alternative.requiredTotalM)}</span>}</>} />
          ))}
        </div>
      )}
      {!aircraft && <p className="muted ep-note">No aircraft.</p>}
    </Collapsible>
  );
}

export function PerformanceSection() {
  const { departure, arrival, stops } = useFlightCalc();
  const { aircraft } = useEditor();
  const all = [departure, ...stops.flatMap((x) => [x.landing, x.takeoff]), arrival];
  const bad = all.some((e) => e.aerodrome && endpointVerdict(e, aircraft).verdict === 'fail');
  const has = departure.aerodrome || arrival.aerodrome;
  return (
    <Section id="performance" title="Take-off & landing" badge={bad ? <Chip tone="danger">No-go</Chip> : undefined}>
      <div data-focus="performance">
      {!has && <p className="muted ep-note">No aerodrome at either end.</p>}
      {departure.aerodrome && <Endpoint e={departure} />}
      {stops.map((x) => x.aerodrome && (
        <div key={x.point.uid} className="ep-stop" data-testid="perf-stop">
          <Endpoint e={x.landing} />
          <Endpoint e={x.takeoff} />
        </div>
      ))}
      {arrival.aerodrome && <Endpoint e={arrival} />}
      </div>
    </Section>
  );
}

