// The MD 4.4 performance log (trn-docs/MD4_4_Performance_Log_C172M.pdf) as data: one block for
// the take-off at the departure, one for the landing at the destination, in the form's order,
// with the weather used, the factors applied and a pass/fail. With intermediate full stops the
// flight has several sectors (take-off → landing), and each one gets its own page: the landing at
// the stop and the take-off from it are checked like the departure and the destination, with the
// sector's masses and the stop's weather and runways. Pure: no I/O, no DOM.
//
// All figures come from calc/performance.ts aerodromePerformance (both the club MD 4.4 method: AFM
// table at the density altitude, mass interpolation, headwind −10 %/5 kt, tailwind +10 %/2 kt; and
// the AFM method: table at the pressure altitude, +10 %/15 °C; the longer TODR / LDR is used and the
// other printed as "other method"; then condition × slope, safety 1.33 / 1.43), fed by exportCalc.ts with the W&B masses and the surface conditions
// at the take-off / landing time (METAR when current, else the Open-Meteo forecast; ISA and calm
// when neither). Required distances are printed rounded UP to the metre.
import { perfVerdict } from '../../../calc/perfVerdict';
import type { Aircraft, FlightDoc, Pilot } from '../../../shared';
import { fmtDate } from '../../../shared/date';
import { fmtClock } from '../../../shared/format';
import type { RefRunway } from '../../../shared/ref';
import type { EndpointPerf, ExportCalc } from '../wb/exportCalc';
import { type PerfSpeeds, perfSpeeds } from './speeds';

export type RowStatus = 'ok' | 'bad' | 'warn' | null;

export interface PerfRow {
  key: string;
  label: string;
  value: string;
  note: string;
  status: RowStatus;
}

export interface PerfBlock {
  phase: 'takeoff' | 'landing';
  title: string;
  /** e.g. 'LGTT DEKELIA / TATOI', or '' when the route end is not an aerodrome. */
  aerodrome: string;
  /** 'Take-off 09:15Z' etc. */
  time: string;
  rows: PerfRow[];
  /** Weather used, for the printout: 'METAR LGTT 150850Z …' or the forecast label, or ISA. */
  weatherSource: string;
  rawMetar: string;
  verdict: 'pass' | 'fail' | 'incomplete';
  verdictText: string;
  /** Wind diagram inputs (degrees magnetic). */
  diagram: {
    runwayHdgMag: number;
    runway: string;
    reciprocal: string;
    windFromMag: number | null;
    windKt: number;
    headwindKt: number;
    crosswindKt: number;
    crossFrom: 'L' | 'R' | '';
  } | null;
  warnings: string[];
}

/** One sector of the flight (one take-off, one landing): one MD 4.4 page. */
export interface PerfPage {
  takeoff: PerfBlock;
  landing: PerfBlock;
  /** Speeds at the sector's take-off mass and pressure altitude. */
  speeds: PerfSpeeds;
  /** e.g. 'LGTT → LGSY'; '' for a flight without stops. */
  label: string;
}

export interface PerfSheetModel {
  date: string;
  registration: string;
  makeModel: string;
  pilot: string;
  departure: PerfBlock;
  arrival: PerfBlock;
  /** Intermediate full stops: the landing there and the take-off from there. */
  stops: { landing: PerfBlock; takeoff: PerfBlock }[];
  /** One per sector, in flight order (a single page without stops: departure and destination). */
  pages: PerfPage[];
  speeds: PerfSpeeds;
  /** The club's condition factor table, from the aircraft's performance factors. */
  conditionTable: { label: string; factor: string }[];
  slopeRule: string;
  crosswindLimits: { takeoff: number | null; landing: number | null };
  conditionNotes: string[];
  verdict: 'pass' | 'fail' | 'incomplete';
  verdictText: string;
  warnings: string[];
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
const r0 = (x: number) => String(Math.round(x));
const ceilM = (x: number) => String(Math.ceil(x - 1e-9));
/** Two decimals, half up on the decimal value (1.265 → '1.27', as the club prints factors). */
const f2 = (x: number) => (Math.round(x * 100 + 1e-7) / 100).toFixed(2);
const pad3 = (x: number) => String(Math.round(((x % 360) + 360) % 360) || 360).padStart(3, '0');
const signed = (x: number) => (x >= 0 ? '+' : '−') + Math.abs(Math.round(x));

/** Minutes after 00:00 UTC → 'HH:MMZ'. */
export function clockZ(min: number): string {
  return fmtClock(min, { z: true });
}

const PAVED = /ASPH|CONC|BIT|PAVED|ASP/i;

/** 'paved RWYCC 5' → 'Paved, RWYCC 5'; null → 'Paved, dry (RWYCC 6)'. */
export function surfaceLabel(key: string | null, runway: RefRunway | null): string {
  if (key) return key.charAt(0).toUpperCase() + key.slice(1);
  if (runway?.surface && !PAVED.test(runway.surface)) return runway.surface;
  return 'Paved, dry (RWYCC 6)';
}

function runwayHdgMag(r: RefRunway): number {
  if (fin(r.headingMagDeg)) return r.headingMagDeg;
  const n = parseInt(r.designator, 10);
  return fin(n) ? n * 10 : 0;
}

function block(
  e: EndpointPerf,
  aircraft: Aircraft | null,
  speeds: PerfSpeeds,
  forcedRunway: string | null,
  stop: false | 'stop' | 'touch-and-go' = false,
): PerfBlock {
  const takeoff = e.phase === 'takeoff';
  const rows: PerfRow[] = [];
  const add = (key: string, label: string, value: string, note = '', status: RowStatus = null) =>
    rows.push({ key, label, value, note, status });
  const p = e.perf;
  const rw = p?.runway ?? null;
  const ad = e.aerodrome;
  const warnings: string[] = [];
  const adName = ad ? `${ad.icao ? ad.icao + ' ' : ''}${ad.name}` : e.point ? e.point.name : '';
  const title =
    stop === 'touch-and-go'
      ? takeoff
        ? 'Touch-and-go take-off'
        : 'Touch-and-go landing'
      : stop
        ? takeoff
          ? 'Take-off from stop'
          : 'Landing at stop'
        : takeoff
          ? 'Departure'
          : 'Destination';

  if (!e.point) warnings.push(takeoff ? 'No route.' : 'No destination: the route has a single point.');
  else if (!ad)
    warnings.push(`${e.point.name} is not an aerodrome: no ${takeoff ? 'take-off' : 'landing'} performance.`);
  if (!aircraft) warnings.push('No aircraft chosen.');

  add('aerodrome', title, adName);
  // Declared distances
  if (takeoff) {
    add(
      'toda',
      'T.O.D.A.',
      p && fin(p.availableTotalM) ? `${r0(p.availableTotalM)} m` : '',
      rw ? `RWY ${rw.designator}` : '',
    );
    add(
      'tora',
      'T.O.R.A.',
      p && fin(p.availableGroundM) ? `${r0(p.availableGroundM)} m` : '',
      rw ? `RWY ${rw.designator}` : '',
    );
  } else {
    add(
      'lda',
      'L.D.A.',
      p && fin(p.availableTotalM) ? `${r0(p.availableTotalM)} m` : '',
      rw ? `RWY ${rw.designator}` : '',
    );
  }
  const elev = ad?.elevFt;
  add(
    'elev',
    'Elevation',
    fin(elev) ? `${r0(elev)} ft` : ad ? 'unknown (0 ft used)' : '',
    '',
    ad && !fin(elev) ? 'warn' : null,
  );
  add(
    'qnh',
    'QNH',
    ad ? `${r0(Math.floor(e.qnhHpa + 1e-9))} hPa` : '',
    e.qnhAssumed && ad ? 'not known: standard assumed' : '',
    e.qnhAssumed && ad ? 'warn' : null,
  );
  if (p) {
    add('pa', 'Pressure altitude', `${r0(p.pressureAltFt)} ft`);
    add(
      'oat',
      'Temperature',
      `${r0(e.oatC)} °C`,
      `ISA ${signed(p.isaDevC)} °C${e.oatAssumed ? ' (not known: ISA assumed)' : ''}`,
      e.oatAssumed ? 'warn' : null,
    );
    add('da', 'Density altitude', `${r0(p.densityAltFt)} ft`);
  } else {
    add('pa', 'Pressure altitude', '');
    add('oat', 'Temperature', ad ? `${r0(e.oatC)} °C` : '');
    add('da', 'Density altitude', '');
  }
  // Wind
  const w = e.wind;
  const varE = e.variationDeg;
  let windText = '';
  let windNote = '';
  if (ad) {
    if (w && w.dirTrueDeg != null && w.speedKt >= 0.5) {
      windText = `${pad3(w.dirTrueDeg - varE)}° / ${r0(w.speedKt)} kt`;
      windNote = `magnetic (${pad3(w.dirTrueDeg)}° true)`;
      const g = e.conditions?.wind?.gustKt;
      if (fin(g)) windNote += `, gusts ${r0(g)} kt`;
    } else if (e.conditions?.wind && e.conditions.wind.speedKt >= 0.5) {
      windText = `VRB / ${r0(e.conditions.wind.speedKt)} kt`;
      const g = e.conditions.wind.gustKt;
      windNote = `variable: full crosswind, no headwind${fin(g) ? `, gusts ${r0(g)} kt` : ''}`;
    } else {
      windText = e.conditions?.wind ? 'Calm' : 'Not known';
      windNote = e.conditions?.wind ? '' : 'calm assumed';
    }
  }
  add('wind', 'Wind', windText, windNote, ad && !e.conditions?.wind ? 'warn' : null);
  add(
    'rwy',
    'RWY in use',
    rw ? rw.designator : '',
    rw
      ? [
          forcedRunway && forcedRunway === rw.designator
            ? 'set in the editor'
            : w && w.speedKt >= 0.5
              ? 'most headwind'
              : 'calm: first listed',
          rw.surface ? rw.surface : '',
          fin(rw.slopePct)
            ? `slope ${rw.slopePct > 0 ? '+' : rw.slopePct < 0 ? '−' : ''}${Math.abs(rw.slopePct).toFixed(1)} %`
            : fin(rw.slopeUnsignedPct) && rw.slopeUnsignedPct > 0
              ? `slope ±${rw.slopeUnsignedPct.toFixed(1)} % (direction not published: adverse assumed)`
              : 'slope unknown',
        ]
          .filter(Boolean)
          .join(' · ')
      : '',
  );
  if (p) {
    const hw = p.wind.headwindKt;
    if (hw < -0.05) add('head', 'Headwind', `Tailwind ${(-hw).toFixed(0)} kt`, '+10 % per 2 kt', 'warn');
    else add('head', 'Headwind', `${Math.max(0, hw).toFixed(0)} kt`);
    const lim = takeoff
      ? aircraft?.performance.factors.maxCrosswindKt?.takeoff
      : aircraft?.performance.factors.maxCrosswindKt?.landing;
    add(
      'cross',
      'Crosswind',
      `${p.wind.crosswindKt.toFixed(0)} kt${p.wind.crossFrom && p.wind.crosswindKt >= 0.5 ? ` ${p.wind.crossFrom}` : ''}`,
      [
        p.variableWind
          ? 'variable wind: full speed'
          : p.wind.crossFrom && p.wind.crosswindKt >= 0.5
            ? `from the ${p.wind.crossFrom === 'L' ? 'left' : 'right'}`
            : '',
        p.crosswindGustKt != null ? `${p.crosswindGustKt.toFixed(0)} kt in gusts` : '',
        fin(lim) ? `limit ${lim} kt` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      p.crosswindOk ? (fin(lim) ? 'ok' : null) : 'bad',
    );
  } else {
    add('head', 'Headwind', '');
    add('cross', 'Crosswind', '');
  }
  add(
    'mass',
    takeoff ? 'Take-off mass' : 'Landing mass',
    fin(e.massKg) ? `${e.massKg.toFixed(1)} kg` : '',
    e.massSource === 'mtow'
      ? e.massReason === 'weight-missing'
        ? 'weight missing on the manifest: MTOW used'
        : 'W&B not available: MTOW used'
      : e.massSource === 'wb'
        ? 'from the loading sheet'
        : '',
    e.massSource === 'mtow' ? 'warn' : null,
  );
  const d = p?.distances ?? null;
  if (d) {
    const parts = [surfaceLabel(e.surface, rw) + ` ${f2(d.factors.surface)}`];
    if (Math.abs(d.factors.slope - 1) > 1e-9)
      parts.push(`× ${takeoff ? 'upslope' : 'downslope'} ${f2(d.factors.slope)}`);
    add(
      'cond',
      'Condition of RWY factor',
      f2(d.factors.condition ?? d.factors.surface * d.factors.slope),
      parts.join(' '),
    );
    add('safety', 'Safety factor', f2(d.factors.safety));
    // The table figures as read, then each factor still to apply up to the corrected AFM distance;
    // condition and safety follow in their own rows, so a hand check multiplies every factor once:
    // TODR = table × wind × temp × condition × safety.
    const afm = `AFM ${r0(d.tableGroundM)}/${r0(d.tableTotalM)} m at ${d.method === 'afm' ? 'PA' : 'DA'} ${r0(d.tableAltFt ?? 0)} ft`;
    // A factor that prints as 1.00 is left out (it changes the distance by under 0.5 %).
    const windOn = d.factors.wind != null && f2(d.factors.wind) !== '1.00';
    const tempOn = f2(d.factors.temperature) !== '1.00';
    const windF = windOn ? ` × wind ${f2(d.factors.wind!)}` : '';
    const tempF = tempOn ? ` × temp ${f2(d.factors.temperature)}` : '';
    const corrected = windOn || tempOn ? ` → ${r0(d.totalM)} m` : '';
    const availT = p!.availableTotalM;
    const availG = p!.availableGroundM;
    if (takeoff) {
      const okT = fin(availT) ? d.requiredTotalM <= availT + 1e-9 : null;
      const okG = fin(availG) ? d.requiredGroundM <= availG + 1e-9 : null;
      add(
        'todr',
        'T.O.D.R.',
        `${ceilM(d.requiredTotalM)} m`,
        `${afm}${windF}${tempF}${corrected}`,
        okT == null ? 'warn' : okT ? 'ok' : 'bad',
      );
      add(
        'torr',
        'T.O.R.R.',
        `${ceilM(d.requiredGroundM)} m`,
        fin(availG) ? `TORA ${r0(availG)} m` : '',
        okG == null ? 'warn' : okG ? 'ok' : 'bad',
      );
      const alt = p!.alternative;
      if (alt) {
        const name = (m: string | undefined) =>
          m === 'afm' ? 'AFM method (PA, +10 %/15 °C)' : 'DA method (table at density altitude)';
        add(
          'todr-alt',
          'T.O.D.R. other method',
          `${ceilM(alt.requiredTotalM)} m`,
          `${name(alt.method)}, TORR ${ceilM(alt.requiredGroundM)} m; shorter, not used`,
        );
      }
    } else {
      const okT = fin(availT) ? d.requiredTotalM <= availT + 1e-9 : null;
      add(
        'ldr',
        'L.D.R.',
        `${ceilM(d.requiredTotalM)} m`,
        `${afm}${windF}${tempF}${corrected}`,
        okT == null ? 'warn' : okT ? 'ok' : 'bad',
      );
      add('lrr', 'L.R.R.', `${ceilM(d.requiredGroundM)} m`, 'landing roll');
      const alt = p!.alternative;
      if (alt) {
        const name = (m: string | undefined) =>
          m === 'afm' ? 'AFM method (PA, +10 %/15 °C)' : 'DA method (table at density altitude)';
        add(
          'ldr-alt',
          'L.D.R. other method',
          `${ceilM(alt.requiredTotalM)} m`,
          `${name(alt.method)}; shorter, not used`,
        );
      }
    }
    if (fin(p!.marginM))
      add(
        'margin',
        'Margin',
        `${r0(p!.marginM)} m`,
        takeoff ? 'least of TODA − TODR, TORA − TORR' : 'LDA − LDR',
        p!.marginM < 0 ? 'bad' : 'ok',
      );
  } else {
    add('cond', 'Condition of RWY factor', '');
    add(
      'safety',
      'Safety factor',
      aircraft
        ? f2(
            takeoff
              ? aircraft.performance.factors.safetyFactorTakeoff
              : aircraft.performance.factors.safetyFactorLanding,
          )
        : '',
    );
    if (takeoff) {
      add('todr', 'T.O.D.R.', '');
      add('torr', 'T.O.R.R.', '');
    } else {
      add('ldr', 'L.D.R.', '');
      add('lrr', 'L.R.R.', '');
    }
  }
  const kt = (x: number | null) => (x == null ? '' : `${x} kt`);
  if (takeoff) {
    add('flaps', 'Flaps setting', speeds.flapsTakeoff);
    add('vr', 'Vr', kt(speeds.vrKt), speeds.vrNote);
    add('vy', 'Vy', kt(speeds.vyKt), speeds.vyNote);
    add('vx', 'Vx', kt(speeds.vxKt), speeds.vxKt != null ? 'flaps up' : '');
    add('vglide', 'Vglide', kt(speeds.glideKt), speeds.glideKt != null ? 'flaps up' : '');
  } else {
    add('flaps', 'Flaps setting', speeds.flapsLanding);
    add('vapp', 'Vapr', kt(speeds.vappKt), speeds.vappNote);
  }

  // Weather source
  let weatherSource = '';
  let rawMetar = '';
  if (ad) {
    if (e.conditions) {
      weatherSource = e.conditions.label;
      if (e.conditions.source === 'metar' && e.conditions.raw) rawMetar = e.conditions.raw;
    } else
      weatherSource = fin(e.timeMin)
        ? 'No surface weather for this time: ISA, calm and QNH 1013 assumed.'
        : 'Block start time not set: ISA, calm and QNH 1013 assumed.';
  }

  if (p) for (const t of p.warnings) if (!warnings.includes(t)) warnings.push(t);

  // Verdict (shared with the editor's take-off & landing cards): mass limit, distances, crosswind,
  // AFM table range.
  const v = perfVerdict({
    phase: e.phase,
    massKg: e.massKg,
    perf: p,
    massBalance: aircraft?.massBalance ?? null,
    hasAerodrome: !!ad,
  });
  if (v.overMass) {
    const m = rows.find((r) => r.key === 'mass');
    if (m) {
      m.status = 'bad';
      m.note = `above ${v.overMass.limitName} ${v.overMass.limitKg} kg`;
    }
    warnings.unshift(v.overMass.text);
  }
  const verdict: PerfBlock['verdict'] = v.verdict;
  const verdictText = v.text;
  // Extrapolated distances are not AFM figures: never shown as 'ok'.
  if (v.extrapolated)
    for (const r of rows)
      if ((r.key === 'todr' || r.key === 'torr' || r.key === 'ldr') && r.status === 'ok') r.status = 'warn';

  let diagram: PerfBlock['diagram'] = null;
  if (p && rw) {
    diagram = {
      runwayHdgMag: runwayHdgMag(rw),
      runway: rw.designator,
      reciprocal: rw.reciprocal,
      windFromMag: w && w.dirTrueDeg != null && w.speedKt >= 0.5 ? w.dirTrueDeg - varE : null,
      windKt: w ? w.speedKt : 0,
      headwindKt: p.wind.headwindKt,
      crosswindKt: p.wind.crosswindKt,
      crossFrom: p.wind.crossFrom,
    };
  }

  return {
    phase: e.phase,
    title,
    aerodrome: adName,
    time: fin(e.timeMin) ? `${takeoff ? 'Take-off' : 'Landing'} ${clockZ(e.timeMin)}` : '',
    rows,
    weatherSource,
    rawMetar,
    verdict,
    verdictText,
    diagram,
    warnings,
  };
}

export interface PerfSheetInput {
  doc: FlightDoc;
  aircraft: Aircraft | null;
  pilot: Pilot | null;
  calc: ExportCalc;
}

export function perfSheetModel(input: PerfSheetInput): PerfSheetModel {
  const { doc, aircraft, pilot, calc } = input;
  const speedsAt = (e: EndpointPerf) => perfSpeeds(aircraft, e.massKg, e.perf?.pressureAltFt ?? null);
  const speeds = speedsAt(calc.departure);
  const departure = block(calc.departure, aircraft, speeds, doc.options.departureRunway);
  // Sector k takes off from the departure (k = 0) or from stop k − 1, and lands at stop k or at the
  // destination (the last sector). The landing block prints the speeds of its sector's take-off.
  const takeoffs = [calc.departure, ...calc.stops.map((x) => x.takeoff)];
  const sectorSpeeds = takeoffs.map((e, k) => (k === 0 ? speeds : speedsAt(e)));
  const arrival = block(calc.arrival, aircraft, sectorSpeeds[sectorSpeeds.length - 1], doc.options.arrivalRunway);
  const stops = calc.stops.map((x, k) => ({
    landing: block(x.landing, aircraft, sectorSpeeds[k], x.landing.forcedRunway, x.kind),
    takeoff: block(x.takeoff, aircraft, sectorSpeeds[k + 1], x.takeoff.forcedRunway, x.kind),
  }));
  const tos = [departure, ...stops.map((x) => x.takeoff)];
  const ldgs = [...stops.map((x) => x.landing), arrival];
  const name = (b: PerfBlock, e: EndpointPerf) => e.aerodrome?.icao || e.point?.name || b.aerodrome;
  const pages: PerfPage[] = tos.map((t, k) => ({
    takeoff: t,
    landing: ldgs[k],
    speeds: sectorSpeeds[k],
    label: stops.length
      ? `${name(t, takeoffs[k])} → ${name(ldgs[k], k < calc.stops.length ? calc.stops[k].landing : calc.arrival)}`
      : '',
  }));
  const f = aircraft?.performance.factors ?? null;
  const conditionTable: { label: string; factor: string }[] = [];
  if (f) {
    conditionTable.push({ label: 'Paved, dry (RWYCC 6)', factor: '1.0' });
    for (const [k, v] of Object.entries(f.runwayCondition))
      conditionTable.push({ label: k.charAt(0).toUpperCase() + k.slice(1), factor: String(v) });
  }
  const per2 = f?.slopeFactorPer2Pct ?? null;
  const slopeRule =
    per2 && per2 !== 1 ? `2.0 % adverse slope: × ${per2} (upslope for take-off, downslope for landing; linear)` : '';
  const warnings: string[] = [];
  if (!navReady(calc))
    warnings.push('Block start time not set: take-off and landing times, and so the weather, are unknown.');
  const allEnds = [calc.departure, ...calc.stops.flatMap((x) => [x.landing, x.takeoff]), calc.arrival];
  if (allEnds.some((e) => e.massSource === 'mtow'))
    warnings.push('Masses are not from the loading sheet (MTOW used): complete the manifest and the aircraft.');

  const order = { fail: 2, incomplete: 1, pass: 0 } as const;
  const blocks = [departure, ...stops.flatMap((x) => [x.landing, x.takeoff]), arrival];
  const worst = blocks.reduce((a, b) => (order[b.verdict] > order[a.verdict] ? b : a));
  const verdict = worst.verdict;
  const where = (b: PerfBlock) =>
    b === departure || b === arrival ? b.title : `${b.title} ${b.aerodrome.split(' ')[0]}`;
  const verdictText =
    verdict === 'pass'
      ? stops.length
        ? `All ${blocks.length} take-offs and landings within limits`
        : 'Take-off and landing within limits'
      : `${where(worst)}: ${worst.verdictText.toLowerCase()}`;
  const picName = pilot?.fullName || doc.crew.find((c) => c.role === 'PIC')?.snapshot.fullName || '';

  return {
    date: fmtDate(doc.date),
    registration: aircraft?.registration ?? '',
    makeModel: aircraft?.makeModel ?? '',
    pilot: picName,
    departure,
    arrival,
    stops,
    pages,
    speeds,
    conditionTable,
    slopeRule,
    crosswindLimits: { takeoff: f?.maxCrosswindKt?.takeoff ?? null, landing: f?.maxCrosswindKt?.landing ?? null },
    conditionNotes: f?.notes ?? [],
    verdict,
    verdictText,
    warnings,
  };
}

const navReady = (c: ExportCalc) => c.computed.navlog.blockOffSet;
