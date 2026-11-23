// What the "Take-off & landing" cards say about an endpoint, without React: the website's
// PerformanceSection and the native app's Brief (src/native/core/brief.ts) both read it.
import { perfVerdict, type PerfVerdictResult } from '../../../calc/perfVerdict';
import type { Aircraft } from '../../../shared';
import type { EndpointCalc } from './flightCalc';

/** The conditions in one line: '240°/12 kt · 18°C · Q1013' (wind direction true). */
export function weatherText(e: Pick<EndpointCalc, 'surface'>): string {
  const s = e.surface;
  if (!s) return 'ISA, calm';
  const w = s.wind;
  const wind = !w
    ? 'wind –'
    : !(w.speedKt > 0.5)
      ? 'calm'
      : `${w.dirTrueDeg == null ? 'VRB' : `${String(Math.round(w.dirTrueDeg) % 360 || 360).padStart(3, '0')}°`}/${Math.round(w.speedKt)}${w.gustKt ? `G${Math.round(w.gustKt)}` : ''} kt`;
  const temp = s.tempC != null ? `${Math.round(s.tempC)}°C` : '–°C';
  const qnh = s.qnhHpa != null ? `Q${Math.round(s.qnhHpa)}` : 'Q–';
  return `${wind} · ${temp} · ${qnh}`;
}

/** The same verdict as the MD 4.4 export (mass limit, distances, crosswind, AFM table range). */
export function endpointVerdict(e: EndpointCalc, aircraft: Pick<Aircraft, 'massBalance'> | null): PerfVerdictResult {
  return perfVerdict({
    phase: e.phase,
    massKg: e.massKg,
    perf: e.perf,
    massBalance: aircraft?.massBalance ?? null,
    hasAerodrome: !!e.aerodrome,
  });
}

export function reasonText(v: PerfVerdictResult): string {
  if (!v.overMass && v.text === 'Outside the AFM table') return 'Outside the AFM table: distances extrapolated.';
  const head = v.overMass ? v.overMass.text : `${v.text}.`;
  return v.extrapolated ? `${head} Distances extrapolated beyond the AFM table.` : head;
}

/** 'Departure', 'Landing at stop', 'Touch-and-go take-off'… */
export function endpointTitle(e: Pick<EndpointCalc, 'phase' | 'stopKind' | 'stopUid'>): string {
  const to = e.phase === 'takeoff';
  if (e.stopKind === 'touch-and-go') return to ? 'Touch-and-go take-off' : 'Touch-and-go landing';
  if (e.stopUid) return to ? 'Take-off from stop' : 'Landing at stop';
  return to ? 'Departure' : 'Destination';
}

/** The endpoint's test id: 'takeoff', 'landing', 'stop-takeoff', 'tng-landing'… */
export function endpointTid(e: Pick<EndpointCalc, 'phase' | 'stopKind' | 'stopUid'>): string {
  const stopKind = e.stopKind ?? 'stop';
  return e.stopUid ? `${stopKind === 'touch-and-go' ? 'tng' : 'stop'}-${e.phase}` : e.phase;
}
