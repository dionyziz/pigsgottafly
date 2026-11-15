// Take-off and landing: conditions (METAR when current, else forecast), runway (from the wind, or
// chosen), surface condition, wind components, and required vs available distances. At the
// departure, at each intermediate full stop and touch-and-go (the landing there and the take-off
// from there, with the sector masses) and at the destination.
import { perfVerdict, type PerfVerdictResult } from '../../../calc/perfVerdict';
import { runwaysOf } from '../../../data/ref';
import type { Aircraft } from '../../../shared';
import { setStopChoice, type FlightOptions } from '../../../shared';
import { useEditor } from '../state';
import { fmtMin, useFlightCalc, type EndpointCalc } from './calc';
import { Chip, KV, Section } from './ui';

const m = (x: number | null | undefined) => (x == null || !isFinite(x) ? '–' : `${Math.round(x)} m`);

function windText(e: EndpointCalc): string {
  const w = e.surface?.wind;
  if (!w) return 'unknown';
  if (!(w.speedKt > 0.5)) return 'calm';
  const dir = w.dirTrueDeg == null ? 'VRB' : String(Math.round(w.dirTrueDeg) % 360 || 360).padStart(3, '0');
  return `${dir}°T / ${Math.round(w.speedKt)} kt${w.gustKt ? ` G${Math.round(w.gustKt)}` : ''}`;
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

  if (!ad) return <div className="ep-perf"><div className="ep-perf-head"><b>{title}</b><span className="muted">not an aerodrome</span></div></div>;
  return (
    <div className="ep-perf" data-testid={`perf-${tid}`}>
      <div className="ep-perf-head">
        <b>{title} {ad.icao ?? ''}</b>
        <span className="muted ellipsis">{ad.name}</span>
        <span className="spacer" />
        {(p || v.overMass) && <span data-testid={`perf-verdict-${tid}`} data-verdict={v.verdict}><VerdictChip v={v} /></span>}
      </div>
      {(p || v.overMass) && v.verdict !== 'pass' && (
        <div className={`ep-note ${v.verdict === 'fail' ? 'danger-text' : 'warn-text'}`} data-testid={`perf-reason-${tid}`}>
          {reasonText(v)}
        </div>
      )}
      <div className="ep-kvs">
        <KV k={to ? 'Take-off' : 'Landing'} v={<span className="tnum">{isFinite(timeMin) ? `${fmtMin(timeMin)}Z` : '–'}</span>}
          sub={e.surface ? e.surface.label : 'no conditions'} />
        <KV k="Wind" v={<span className="tnum">{windText(e)}</span>}
          sub={e.surface ? `${e.surface.tempC != null ? `${Math.round(e.surface.tempC)}°C` : '–'} · Q${e.surface.qnhHpa != null ? Math.round(e.surface.qnhHpa) : '–'}` : 'ISA, calm'} />
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
      {!aircraft && <p className="muted ep-note">Choose an aircraft for the distances.</p>}
    </div>
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
      {!has && <p className="muted ep-note">Start and end the route at an aerodrome.</p>}
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

