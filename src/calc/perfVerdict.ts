// One take-off or landing verdict, shared by the editor's "Take-off & landing" cards and the MD 4.4
// performance export so the two never disagree. Pure: no I/O, no DOM.
//
// Order of the checks (the first that applies wins):
//   1. mass above the limit (take-off: MTOW; landing: MLW, MTOW when no MLW is published) → fail
//   2. no performance figures (no aerodrome, no aircraft, no tables)                       → incomplete
//   3. distance does not fit, or crosswind above the limit                                → fail
//   4. outside the AFM table (mass above the heaviest row, altitude above the top row,
//      tailwind above 10 kt): the distances are extrapolations, not AFM figures            → fail
//   5. declared distances unknown                                                          → incomplete
//   6. otherwise                                                                           → pass
import type { MassBalance } from '../shared/index.js';
import type { AerodromePerf } from './performance.js';

export type PerfVerdict = 'pass' | 'fail' | 'incomplete';

export interface PerfVerdictInput {
  phase: 'takeoff' | 'landing';
  /** Mass the figures were computed for, kg (null if unknown). */
  massKg: number | null;
  perf: AerodromePerf | null;
  massBalance: Pick<MassBalance, 'mtowKg' | 'mlwKg'> | null;
  /** The route end is an aerodrome. */
  hasAerodrome: boolean;
}

export interface PerfOverMass {
  /** 'MTOW' or 'MLW'. */
  limitName: string;
  limitKg: number;
  excessKg: number;
  /** e.g. 'Take-off mass 1118.8 kg is 75.8 kg above the MTOW of 1043 kg.' */
  text: string;
}

export interface PerfVerdictResult {
  verdict: PerfVerdict;
  /** e.g. 'Take-off mass above MTOW', 'Outside the AFM table'. */
  text: string;
  overMass: PerfOverMass | null;
  /** The distances are extrapolated beyond the AFM table. */
  extrapolated: boolean;
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

export function perfVerdict(i: PerfVerdictInput): PerfVerdictResult {
  const takeoff = i.phase === 'takeoff';
  const p = i.perf;
  const d = p?.distances ?? null;
  const mb = i.massBalance;
  const limitKg = mb ? (takeoff ? mb.mtowKg : mb.mlwKg ?? mb.mtowKg) : null;
  const limitName = takeoff ? 'MTOW' : mb?.mlwKg != null ? 'MLW' : 'MTOW';
  const phaseName = takeoff ? 'Take-off' : 'Landing';
  let overMass: PerfOverMass | null = null;
  if (fin(i.massKg) && fin(limitKg) && limitKg > 0 && i.massKg > limitKg + 1e-9) {
    const excessKg = i.massKg - limitKg;
    overMass = { limitName, limitKg, excessKg, text: `${phaseName} mass ${i.massKg.toFixed(1)} kg is ${excessKg.toFixed(1)} kg above the ${limitName} of ${limitKg} kg.` };
  }
  const extrapolated = !!d?.extrapolated;
  const out = (verdict: PerfVerdict, text: string): PerfVerdictResult => ({ verdict, text, overMass, extrapolated });
  if (overMass) return out('fail', `${phaseName} mass above ${limitName}`);
  if (!p || !d) return out('incomplete', i.hasAerodrome ? 'Cannot be computed' : 'Not an aerodrome');
  if (!p.crosswindOk) return out('fail', 'Crosswind above the limit');
  if (fin(p.marginM) && p.marginM < 0) return out('fail', takeoff ? 'Take-off distance not available' : 'Landing distance not available');
  if (extrapolated) return out('fail', 'Outside the AFM table');
  if (!fin(p.marginM)) return out('incomplete', 'Declared distances unknown');
  return out('pass', takeoff ? 'Take-off distances available' : 'Landing distance available');
}
