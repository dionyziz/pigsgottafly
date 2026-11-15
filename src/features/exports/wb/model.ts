// The MD 4.3 loading sheet (trn-docs/MD4_3_Loading_Sheet_C172M.pdf) as data: the loading table,
// the totals at take-off and landing, the envelope checks and the chart geometry (moment vs mass,
// as the AFM "centre of gravity moment envelope" printed on the club form). Pure: no I/O, no DOM.
//
// Table order follows MD 4.3: corrected empty weight, (unusable fuel when the weighing excluded
// it), fuel, then the loading stations in the aircraft's order (PIC and front passenger, rear
// passengers, baggage areas), with the people of each seat station listed under it.
// Take-off = fuel on board at block-off (no taxi burn, as MD 4.3 and the club calculator);
// landing = take-off − (taxi allowance + trip fuel) at the fuel arm. An intermediate full stop
// adds a total at the stop (landing there, and the take-off from there with the same fuel: no
// refuelling, no taxi burn before take-off) and its own check against MLW, MTOW and the envelope.
import type { Aircraft, Envelope, FlightDoc, Pilot, WbCategory } from '../../../shared';
import { seatLayout } from '../../../shared';
import type { WbCheck, WbPoint, WbResult } from '../../../calc';
import type { ExportCalc } from './exportCalc';

export type WbLineKind = 'empty' | 'unusable' | 'fuel' | 'station' | 'total' | 'burn';

export interface WbPerson {
  role: 'PIC' | 'PAX';
  name: string;
  seat: string;
  massKg: number | null;
}

export interface WbLine {
  key: string;
  kind: WbLineKind;
  label: string;
  /** Small print under the label: limits, density, weighing date. */
  note: string;
  massKg: number | null;
  armM: number | null;
  momentKgM: number | null;
  /** Seat stations: who sits there. */
  people: WbPerson[];
  /** A station limit is exceeded on this line. */
  over: boolean;
}

export interface WbPhaseCheck {
  /** 'stop': landing at an intermediate stop and the take-off from it (the same mass and CG). */
  phase: 'takeoff' | 'landing' | 'stop';
  label: string;
  point: WbPoint;
  normal: WbCheck;
  utility: WbCheck | null;
  /** In the flight's category (mass ≤ max and inside the envelope). */
  ok: boolean;
}

export interface ChartEnvelope {
  category: WbCategory;
  label: string;
  maxKg: number;
  /** The envelope as drawn: [moment kg·m, mass kg]. The AFM moment envelope when the aircraft has
   * one, else the CG envelope mapped to moments (edges densified: a sloped CG limit is a curve). */
  outline: [number, number][];
  /** The CG envelope mapped to moments, drawn dashed when a moment envelope is the outline. */
  cgOutline: [number, number][] | null;
}

export interface WbSheetModel {
  registration: string;
  makeModel: string;
  date: string;
  pilot: string;
  route: string;
  category: WbCategory;
  categoryLabel: string;
  datum: string;
  weighing: string;
  fuelLabel: string;
  lines: WbLine[];
  takeoff: WbLine;
  /** Fuel used over the whole flight (all sectors). */
  burn: WbLine;
  landing: WbLine;
  /** The totals block as printed: take-off, then per sector its fuel used and the total at its
   *  landing (the stops' totals between): [takeoff, burn, landing] without stops. */
  totals: WbLine[];
  zeroFuel: WbPoint | null;
  checks: WbPhaseCheck[];
  /** pass: both phases inside the flight's category; fail: a phase is outside; incomplete: no aircraft or missing weights. */
  verdict: 'pass' | 'fail' | 'incomplete';
  verdictText: string;
  mtowKg: number;
  limits: string[];
  envelopes: ChartEnvelope[];
  warnings: string[];
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

export const fmtKg = (x: number | null | undefined) => (fin(x) ? x.toFixed(1) : '');
export const fmtMoment = (x: number | null | undefined) => (fin(x) ? x.toFixed(2) : '');
/** Arms as printed on MD 4.3 (0.94, 1.215, 3.12): up to 3 decimals, at least 2. */
export function fmtArm(x: number | null | undefined): string {
  if (!fin(x)) return '';
  const s = x.toFixed(3);
  return s.endsWith('0') ? x.toFixed(2) : s;
}
/** A computed CG: always 3 decimals. */
export const fmtCg = (x: number | null | undefined) => (fin(x) ? x.toFixed(3) : '');
const trimNum = (x: number) => String(Math.round(x * 1000) / 1000);

/** 'YYYY-MM-DD' → 'DD/MM/YYYY'. */
export function fmtDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** CG polygon [arm, mass] → moment outline [moment, mass], each edge split into `steps` pieces. */
export function cgToMomentOutline(polygon: [number, number][], steps = 16): [number, number][] {
  const out: [number, number][] = [];
  const n = polygon.length;
  if (n < 3) return out;
  for (let i = 0; i < n; i++) {
    const [a0, m0] = polygon[i];
    const [a1, m1] = polygon[(i + 1) % n];
    const k = a0 === a1 || m0 === m1 ? 1 : steps; // constant arm or constant mass: straight in moment space
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const arm = a0 + (a1 - a0) * t;
      const mass = m0 + (m1 - m0) * t;
      out.push([arm * mass, mass]);
    }
  }
  return out;
}

export function chartEnvelope(env: Envelope, label: string): ChartEnvelope {
  const hasMoment = !!env.momentPolygon && env.momentPolygon.length >= 3;
  const cg = cgToMomentOutline(env.polygon);
  return {
    category: env.category,
    label,
    maxKg: env.maxKg,
    outline: hasMoment ? (env.momentPolygon as [number, number][]) : cg,
    cgOutline: hasMoment && cg.length ? cg : null,
  };
}

const ROLE_ORDER = { PIC: 0, PAX: 1 } as const;

/**
 * A source reference as printed: file names and paths (e.g. '(trn-docs/SXASV_WB_FORM_2024.pdf)',
 * a private folder) are dropped, the document's description stays.
 */
export function printableSource(src: string): string {
  return (src || '')
    .replace(/\s*\([^()]*(?:\/|\.(?:pdf|png|jpe?g|docx?|xlsx?|txt))[^()]*\)/gi, '')
    .replace(/\s*[^\s()]+\.(?:pdf|png|jpe?g|docx?|xlsx?|txt)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * An envelope's note as printed in the limits line. Clauses that give a seat arm ('front seats
 * set forward to 0.90 m (club W&B calculator)') are dropped: the sheet computes every seat at its
 * station arm, which the loading table shows, so a different arm in the notes would contradict it.
 */
export function envelopeNote(note: string): string {
  const clauses = note.replace(/^\s*utility:\s*/i, '').replace(/\.\s*$/, '').split(/\s*;\s*/).filter(Boolean);
  const kept = clauses.filter((c) => !/\b\d+(?:\.\d+)?\s*m\b/.test(c));
  if (kept.length < clauses.length) kept.push('seats at the station arms in the table');
  return kept.join('; ');
}

/**
 * When the moment envelope (the club's 'torque' limits) tops out below the category's maximum
 * mass, a loading between the two is reported outside: say so, the chart shows both outlines.
 */
export function momentTopNote(env: Envelope | null, label: string): string {
  if (!env || !env.momentPolygon || env.momentPolygon.length < 3) return '';
  const top = Math.max(...env.momentPolygon.map(([, m]) => m));
  if (!(top < env.maxKg - 0.5)) return '';
  return `${label} moment envelope (solid outline) tops out at ${trimNum(top)} kg, below the ${trimNum(env.maxKg)} kg maximum of the CG limits (dotted): a loading between ${trimNum(top)} and ${trimNum(env.maxKg)} kg is reported outside`;
}

export interface WbSheetInput {
  doc: FlightDoc;
  aircraft: Aircraft | null;
  pilot: Pilot | null;
  calc: ExportCalc;
  /** Route text for the header, e.g. 'LGTT – LGMG – LGTT'. */
  route: string;
}

export function wbSheetModel(input: WbSheetInput): WbSheetModel {
  const { doc, aircraft, pilot, calc, route } = input;
  const wb: WbResult | null = calc.wb;
  const warnings: string[] = [];
  const category: WbCategory = doc.options.category === 'utility' ? 'utility' : 'normal';
  const categoryLabel = category === 'utility' ? 'Utility' : 'Normal';
  const pilotName = pilot?.fullName || doc.crew.find((c) => c.role === 'PIC')?.snapshot.fullName || '';

  const emptyLine = (key: string, kind: WbLineKind, label: string): WbLine => ({ key, kind, label, note: '', massKg: null, armM: null, momentKgM: null, people: [], over: false });

  if (!aircraft) {
    warnings.push('No aircraft chosen for this flight: the loading sheet cannot be computed.');
    return {
      registration: '', makeModel: '', date: fmtDate(doc.date), pilot: pilotName, route, category, categoryLabel,
      datum: '', weighing: '', fuelLabel: '', lines: [],
      takeoff: emptyLine('to', 'total', 'Total at take-off'), burn: emptyLine('burn', 'burn', 'Fuel used (taxi + trip)'),
      landing: emptyLine('ldg', 'total', 'Total at landing'), totals: [], zeroFuel: null, checks: [],
      verdict: 'incomplete', verdictText: 'No aircraft', mtowKg: NaN, limits: [], envelopes: [], warnings,
    };
  }

  const mb = aircraft.massBalance;
  const rho = aircraft.fuel.densityKgPerL;
  const fuelStation = mb.stations.find((s) => s.kind === 'fuel');
  const fuelLabel = `${aircraft.fuel.type} ${rho > 0 ? `${trimNum(rho)} kg/L` : '(density not set)'}`;
  const lines: WbLine[] = [];

  // People per seat station, from the manifest (names, seat labels, weights).
  const seats = new Map(seatLayout(mb.stations).map((s) => [s.id, s]));
  const peopleBy = new Map<string, WbPerson[]>();
  for (const c of [...doc.crew].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])) {
    const seat = seats.get(c.seat);
    const st = seat ? seat.station.id : null;
    if (!st) continue;
    const list = peopleBy.get(st) ?? [];
    list.push({ role: c.role, name: c.snapshot.fullName || (c.role === 'PIC' ? 'Pilot in command' : 'Passenger'), seat: seat?.label ?? c.seat, massKg: c.snapshot.weightKg });
    peopleBy.set(st, list);
  }

  if (wb) {
    const rows = wb.stationRows ?? wb.rows;
    const empty = rows[0];
    lines.push({
      key: 'empty', kind: 'empty', label: 'Corrected empty weight',
      note: [mb.weighingDate ? `weighed ${fmtDate(mb.weighingDate)}` : '', mb.includesOil ? 'incl. oil' : '', aircraft.fuel.unusableIncludedInEmptyMass ? 'incl. unusable fuel' : ''].filter(Boolean).join(', '),
      massKg: empty.massKg, armM: empty.armM, momentKgM: empty.momentKgM, people: [], over: false,
    });
    const unusable = wb.rows.find((r) => r.label.startsWith('Unusable fuel'));
    if (unusable) {
      lines.push({ key: 'unusable', kind: 'unusable', label: 'Unusable fuel', note: `${trimNum(aircraft.fuel.unusableL)} L, not in the weighing`, massKg: unusable.massKg, armM: unusable.armM, momentKgM: unusable.momentKgM, people: [], over: false });
    }
    const fuelRow = rows[rows.length - 1];
    const usable = aircraft.fuel.usableL;
    lines.push({
      key: 'fuel', kind: 'fuel', label: `Fuel (${fuelLabel})`,
      note: `${trimNum(calc.fuelTakeoffL)} L on board${usable > 0 ? ` · max ${trimNum(usable)} L usable` : ''}`,
      massKg: fuelRow.massKg, armM: fuelStation?.armM ?? fuelRow.armM, momentKgM: fuelRow.momentKgM, people: [],
      over: usable > 0 && calc.fuelTakeoffL > usable + 1e-9,
    });
    for (const st of mb.stations) {
      if (st.kind === 'fuel') continue;
      const r = rows.find((x) => x.stationId === st.id);
      const mass = r?.massKg ?? 0;
      const notes: string[] = [];
      if (st.maxKg != null) notes.push(`max ${trimNum(st.maxKg)} kg`);
      for (const lim of mb.combinedLimits) if (lim.stations[0] === st.id && lim.stations.length > 1) {
        notes.push(`${lim.stations.map((id) => mb.stations.find((s) => s.id === id)?.name ?? id).join(' + ')} max ${trimNum(lim.maxKg)} kg`);
      }
      if (st.kind === 'baggage') {
        const bag = doc.baggageKg[st.id];
        if (!(bag > 0)) notes.push('empty');
      }
      lines.push({
        key: st.id, kind: 'station', label: st.name, note: notes.join(' · '),
        massKg: mass, armM: r && mass > 0 ? r.armM : st.armM, momentKgM: r?.momentKgM ?? 0,
        people: peopleBy.get(st.id) ?? [],
        over: st.maxKg != null && mass > st.maxKg + 1e-9,
      });
    }
  }

  const pt = (p: WbPoint | undefined): Pick<WbLine, 'massKg' | 'armM' | 'momentKgM'> =>
    p ? { massKg: p.massKg, armM: p.armM, momentKgM: p.momentKgM } : { massKg: null, armM: null, momentKgM: null };
  const fuelArm = fuelStation?.armM ?? 0;
  const burnL = wb ? calc.fuelTakeoffL - Math.max(0, calc.fuelLandingL) : 0;
  const burnKg = wb ? wb.takeoff.massKg - wb.landing.massKg : NaN;
  const takeoff: WbLine = { key: 'to', kind: 'total', label: 'Total at take-off', note: mb.mtowKg > 0 ? `MTOW ${trimNum(mb.mtowKg)} kg` : '', ...pt(wb?.takeoff), people: [], over: !!wb && mb.mtowKg > 0 && wb.takeoff.massKg > mb.mtowKg + 1e-9 };
  const burn: WbLine = {
    key: 'burn', kind: 'burn', label: 'Fuel used: taxi + trip',
    note: wb ? `${trimNum(burnL)} L${calc.fuelLandingL < 0 ? ' (all fuel on board: not enough for the trip)' : ''}` : '',
    massKg: wb ? -burnKg : null, armM: wb ? fuelArm : null, momentKgM: wb ? -(wb.takeoff.momentKgM - wb.landing.momentKgM) : null, people: [], over: false,
  };
  const mlw = mb.mlwKg ?? mb.mtowKg;
  const landing: WbLine = { key: 'ldg', kind: 'total', label: 'Total at landing', note: `${trimNum(Math.max(0, calc.fuelLandingL))} L remaining`, ...pt(wb?.landing), people: [], over: !!wb && mlw > 0 && wb.landing.massKg > mlw + 1e-9 };

  // Intermediate full stops: per sector, the fuel used and the total at its landing.
  const stops = wb ? calc.stops.filter((x) => x.wbBefore && x.wbAfter) : [];
  const stopName = (x: (typeof stops)[number]) => x.landing.aerodrome?.icao || x.point.name;
  const totals: WbLine[] = [takeoff];
  if (wb && stops.length === calc.stops.length && stops.length) {
    const sectorBurn = (key: string, to: WbPoint, ldg: WbPoint, litres: number, where: string, short: boolean): WbLine => ({
      key, kind: 'burn', label: `Fuel used to ${where}: taxi + trip`,
      note: `${trimNum(litres)} L${short ? ' (all fuel on board: not enough for the sector)' : ''}`,
      massKg: -(to.massKg - ldg.massKg), armM: fuelArm, momentKgM: -(to.momentKgM - ldg.momentKgM), people: [], over: false,
    });
    stops.forEach((x, k) => {
      const at = x.wbBefore!.landing;
      const limit = Math.min(mlw > 0 ? mlw : Infinity, mb.mtowKg > 0 ? mb.mtowKg : Infinity);
      totals.push(sectorBurn(`burn${k}`, k === 0 ? wb.takeoff : stops[k - 1].wbAfter!.takeoff, at, x.before.fuelTakeoffL - Math.max(0, x.before.fuelLandingL), stopName(x), x.before.fuelLandingL < 0));
      totals.push({
        key: `stop${k}`, kind: 'total', label: `Total at ${stopName(x)} (stop)`,
        note: `${trimNum(Math.max(0, x.before.fuelLandingL))} L remaining · landing and take-off`,
        massKg: at.massKg, armM: at.armM, momentKgM: at.momentKgM, people: [], over: at.massKg > limit + 1e-9,
      });
    });
    const lastSector = calc.sectors[calc.sectors.length - 1];
    const fromLast = stops[stops.length - 1].wbAfter!.takeoff;
    const destName = calc.arrival.aerodrome?.icao || calc.arrival.point?.name || 'landing';
    totals.push(sectorBurn('burnLast', fromLast, wb.landing, lastSector.fuelTakeoffL - Math.max(0, lastSector.fuelLandingL), destName, lastSector.fuelLandingL < 0));
  } else totals.push(burn);
  totals.push(landing);

  // Checks: take-off, each stop (landing there with the sector's mass, and the take-off from there
  // with the same mass: MLW, MTOW and the envelope), landing.
  const checks: WbPhaseCheck[] = [];
  if (wb) {
    const both = (a: WbCheck, b: WbCheck): WbCheck => ({ inEnvelope: a.inEnvelope && b.inEnvelope, massOk: a.massOk && b.massOk });
    const phaseCheck = (phase: 'takeoff' | 'landing'): WbPhaseCheck => {
      const normal = wb.normal[phase];
      const utility = wb.utility ? wb.utility[phase] : null;
      const chosen = category === 'utility' ? utility : normal;
      const breached = wb.limitBreaches.some((b) => b.phase === phase);
      return { phase, label: phase === 'takeoff' ? 'Take-off' : 'Landing', point: wb[phase], normal, utility, ok: !!chosen && chosen.inEnvelope && chosen.massOk && !breached };
    };
    checks.push(phaseCheck('takeoff'));
    for (const x of stops) {
      const b = x.wbBefore!, a = x.wbAfter!;
      const normal = both(b.normal.landing, a.normal.takeoff);
      const utility = b.utility && a.utility ? both(b.utility.landing, a.utility.takeoff) : null;
      const chosen = category === 'utility' ? utility : normal;
      const breached = b.limitBreaches.some((r) => r.phase === 'landing') || a.limitBreaches.some((r) => r.phase === 'takeoff');
      checks.push({ phase: 'stop', label: `Stop ${stopName(x)}`, point: b.landing, normal, utility, ok: !!chosen && chosen.inEnvelope && chosen.massOk && !breached });
    }
    checks.push(phaseCheck('landing'));
  }

  // Warnings: manifest problems first, then the calculation's.
  const missingWeights = doc.crew.filter((c) => c.snapshot.weightKg == null);
  for (const t of calc.wbLoadWarnings) warnings.push(t);
  if (wb) for (const t of wb.warnings) if (!warnings.includes(t)) warnings.push(t);
  for (const x of stops) {
    // The stop's own phase breaches (MLW / MTOW / envelope there); loading limits are already listed.
    const own = [...x.wbBefore!.limitBreaches.filter((r) => r.phase === 'landing'), ...x.wbAfter!.limitBreaches.filter((r) => r.phase === 'takeoff')];
    for (const r of own) {
      const t = `At ${stopName(x)} (stop): ${r.text}`;
      if (!warnings.includes(t)) warnings.push(t);
    }
  }
  if (!wb) warnings.push('The weight and balance could not be computed for this aircraft.');
  if (!doc.crew.length) warnings.push('The manifest is empty: no pilot or passengers in the balance.');
  const fuel = calc.computed.fuel;
  if (fuel?.fobIsDefault) warnings.push(`Fuel on board is the default (required + reserve = ${trimNum(fuel.fobL)} L); set it in the flight editor if different.`);
  if (!calc.computed.navlog.legs.length) warnings.push('No route: no trip fuel, landing figures equal take-off.');

  let verdict: WbSheetModel['verdict'];
  let verdictText: string;
  if (!wb || !(mb.emptyMassKg > 0)) { verdict = 'incomplete'; verdictText = 'Cannot be computed'; }
  else if (wb.limitBreaches.length || checks.some((c) => !c.ok) || totals.some((l) => l.over) || lines.some((l) => l.over)) {
    // Every published limit counts: envelope and mass, MTOW/MLW, station and combined maxima,
    // seat counts and the utility-category restrictions (wb.limitBreaches).
    verdict = 'fail';
    verdictText = `Outside limits (${categoryLabel.toLowerCase()} category)`;
  } else if (missingWeights.length) { verdict = 'incomplete'; verdictText = `Weight missing for ${missingWeights.length} ${missingWeights.length > 1 ? 'people' : 'person'}`; }
  else { verdict = 'pass'; verdictText = `Within limits (${categoryLabel.toLowerCase()} category)`; }

  const limits: string[] = [];
  if (mb.mtowKg > 0) limits.push(`MTOW ${trimNum(mb.mtowKg)} kg`);
  if (mb.mlwKg != null) limits.push(`MLW ${trimNum(mb.mlwKg)} kg`);
  if (mb.envelopes.utility) {
    const note = envelopeNote(mb.envelopes.utility.notes ?? '');
    limits.push(`Utility max ${trimNum(mb.envelopes.utility.maxKg)} kg${note ? ` (${note})` : ''}`);
  }
  for (const lim of mb.combinedLimits) limits.push(`${lim.stations.map((id) => mb.stations.find((s) => s.id === id)?.name ?? id).join(' + ')} ≤ ${trimNum(lim.maxKg)} kg`);
  for (const [env, label] of [[mb.envelopes.normal, 'Normal'], [mb.envelopes.utility, 'Utility']] as const) {
    const t = momentTopNote(env, label);
    if (t) limits.push(t);
  }

  const envelopes: ChartEnvelope[] = [chartEnvelope(mb.envelopes.normal, 'Normal category')];
  if (mb.envelopes.utility) envelopes.push(chartEnvelope(mb.envelopes.utility, 'Utility category'));

  return {
    registration: aircraft.registration,
    makeModel: aircraft.makeModel,
    date: fmtDate(doc.date),
    pilot: pilotName,
    route,
    category,
    categoryLabel,
    datum: mb.datum,
    weighing: printableSource(mb.weighingSource),
    fuelLabel,
    lines,
    takeoff,
    burn,
    landing,
    totals,
    zeroFuel: wb?.zeroFuel ?? null,
    checks,
    verdict,
    verdictText,
    mtowKg: mb.mtowKg,
    limits,
    envelopes,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// Chart scale

export interface ChartDomain {
  x0: number; x1: number; y0: number; y1: number;
  xTicks: number[]; yTicks: number[];
}

/** Axis ranges covering the envelopes and the points, on round numbers (100 kg·m, 50 kg). */
export function chartDomain(envs: ChartEnvelope[], points: WbPoint[]): ChartDomain {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of envs) for (const [x, y] of e.outline) { xs.push(x); ys.push(y); }
  for (const p of points) if (fin(p.momentKgM) && fin(p.massKg) && p.massKg > 0) { xs.push(p.momentKgM); ys.push(p.massKg); }
  if (!xs.length) { xs.push(600, 1300); ys.push(650, 1100); }
  const xStep = 100;
  const yStep = 50;
  let x0 = Math.floor((Math.min(...xs) - 20) / xStep) * xStep;
  let x1 = Math.ceil((Math.max(...xs) + 20) / xStep) * xStep;
  let y0 = Math.floor((Math.min(...ys) - 10) / yStep) * yStep;
  let y1 = Math.ceil((Math.max(...ys) + 25) / yStep) * yStep;
  if (x1 - x0 < 2 * xStep) { x0 -= xStep; x1 += xStep; }
  if (y1 - y0 < 2 * yStep) { y0 -= yStep; y1 += yStep; }
  const xTicks: number[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += xStep) xTicks.push(x);
  const yTicks: number[] = [];
  for (let y = y0; y <= y1 + 1e-9; y += yStep) yTicks.push(y);
  return { x0, x1, y0, y1, xTicks, yTicks };
}
