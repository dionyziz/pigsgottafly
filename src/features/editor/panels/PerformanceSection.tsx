// Take-off and landing: conditions (METAR when current, else forecast), runway (from the wind, or
// chosen), surface condition, wind components, and required vs available distances.
import { runwaysOf } from '../../../data/ref';
import type { FlightOptions } from '../../../shared';
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

function Endpoint({ e }: { e: EndpointCalc }) {
  const { doc, update, aircraft } = useEditor();
  const { dayMs } = useFlightCalc();
  const to = e.phase === 'takeoff';
  const ad = e.aerodrome;
  const rwKey: keyof FlightOptions = to ? 'departureRunway' : 'arrivalRunway';
  const sfKey: keyof FlightOptions = to ? 'departureSurface' : 'arrivalSurface';
  const runways = ad ? runwaysOf(ad.id) : [];
  const conditions = Object.keys(aircraft?.performance.factors.runwayCondition ?? {});
  const p = e.perf;
  const fits = p && p.marginM != null ? p.marginM >= 0 : null;
  const title = to ? 'Departure' : 'Destination';
  const timeMin = isFinite(e.timeMs) && isFinite(dayMs) ? (e.timeMs - dayMs) / 60000 : NaN;

  if (!ad) return <div className="ep-perf"><div className="ep-perf-head"><b>{title}</b><span className="muted">not an aerodrome</span></div></div>;
  return (
    <div className="ep-perf" data-testid={`perf-${e.phase}`}>
      <div className="ep-perf-head">
        <b>{title} {ad.icao ?? ''}</b>
        <span className="muted ellipsis">{ad.name}</span>
        <span className="spacer" />
        {p && (fits === false || !p.crosswindOk ? <Chip tone="danger">No-go</Chip> : fits ? <Chip tone="ok">Fits</Chip> : <Chip>?</Chip>)}
      </div>
      <div className="ep-kvs">
        <KV k={to ? 'Take-off' : 'Landing'} v={<span className="mono">{isFinite(timeMin) ? `${fmtMin(timeMin)}Z` : '–'}</span>}
          sub={e.surface ? e.surface.label : 'no conditions'} />
        <KV k="Wind" v={<span className="mono">{windText(e)}</span>}
          sub={e.surface ? `${e.surface.tempC != null ? `${Math.round(e.surface.tempC)}°C` : '–'} · Q${e.surface.qnhHpa != null ? Math.round(e.surface.qnhHpa) : '–'}` : 'ISA, calm'} />
        {e.reports?.metar && <div className="ep-metar mono" title="METAR">{e.reports.metar.raw}</div>}
      </div>
      <div className="ep-grid2">
        <label className="field">Runway
          <select value={(doc.options[rwKey] as string | null) ?? ''} onChange={(ev) => update((d) => ({ ...d, options: { ...d.options, [rwKey]: ev.target.value || null } }))}>
            <option value="">Auto (wind){p?.runway && !doc.options[rwKey] ? `: ${p.runway.designator}` : ''}</option>
            {runways.map((r) => <option key={r.designator} value={r.designator}>{r.designator}{r.surface ? ` · ${r.surface}` : ''}</option>)}
          </select>
        </label>
        <label className="field">Surface
          <select value={(doc.options[sfKey] as string | null) ?? ''} onChange={(ev) => update((d) => ({ ...d, options: { ...d.options, [sfKey]: ev.target.value || null } }))}>
            <option value="">Paved, dry</option>
            {conditions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      {p && (
        <div className="ep-kvs">
          <KV k="Components" v={<span className="mono">{p.wind.headwindKt >= 0 ? 'H' : 'T'} {Math.abs(p.wind.headwindKt).toFixed(0)} · X {p.wind.crosswindKt.toFixed(0)}{p.wind.crossFrom}{p.crosswindGustKt != null ? ` G${p.crosswindGustKt.toFixed(0)}` : ''} kt</span>}
            sub={p.variableWind ? 'variable: full crosswind' : undefined}
            tone={!p.crosswindOk || p.tailwind ? 'danger' : undefined} />
          <KV k="PA / DA" v={<span className="mono">{Math.round(p.pressureAltFt)} / {Math.round(p.densityAltFt)} ft</span>} sub={`ISA ${p.isaDevC >= 0 ? '+' : ''}${p.isaDevC.toFixed(0)}°C`} />
          {e.massKg != null && <KV k="Mass" v={<span className="mono">{e.massKg.toFixed(0)} kg</span>} sub={e.massSource === 'mtow' ? 'MTOW (no W&B)' : undefined} />}
          {p.distances && (to ? (
            <>
              <KV k="TORR / TORA" tone={p.availableGroundM != null && p.distances.requiredGroundM > p.availableGroundM ? 'danger' : undefined}
                v={<span className="mono">{m(p.distances.requiredGroundM)} / {m(p.availableGroundM)}</span>} />
              <KV k="TODR / TODA" tone={p.availableTotalM != null && p.distances.requiredTotalM > p.availableTotalM ? 'danger' : undefined}
                v={<span className="mono">{m(p.distances.requiredTotalM)} / {m(p.availableTotalM)}</span>} />
            </>
          ) : (
            <KV k="LDR / LDA" tone={p.availableTotalM != null && p.distances.requiredTotalM > p.availableTotalM ? 'danger' : undefined}
              v={<span className="mono">{m(p.distances.requiredTotalM)} / {m(p.availableTotalM)}</span>}
              sub={p.alternative ? <span data-testid="ldr-methods">{p.distances.method === 'afm' ? 'AFM' : 'club'} method; {p.alternative.method === 'afm' ? 'AFM' : 'club'} {m(p.alternative.requiredTotalM)}</span> : undefined} />
          ))}
        </div>
      )}
      {!aircraft && <p className="muted ep-note">Choose an aircraft for the distances.</p>}
    </div>
  );
}

export function PerformanceSection() {
  const { departure, arrival } = useFlightCalc();
  const bad = [departure, arrival].some((e) => e.perf && ((e.perf.marginM != null && e.perf.marginM < 0) || !e.perf.crosswindOk));
  const has = departure.aerodrome || arrival.aerodrome;
  return (
    <Section id="performance" title="Take-off & landing" badge={bad ? <Chip tone="danger">No-go</Chip> : undefined}>
      {!has && <p className="muted ep-note">Start and end the route at an aerodrome.</p>}
      {departure.aerodrome && <Endpoint e={departure} />}
      {arrival.aerodrome && <Endpoint e={arrival} />}
    </Section>
  );
}

