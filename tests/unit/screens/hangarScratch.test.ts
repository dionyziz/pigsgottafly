// Audit of the hangar editor: the owner's SX-ASV and SX-ASG are built from a BLANK aircraft (no
// type template) using only what the aircraft page offers, i.e. the editing operations of
// src/features/hangar/model.ts for anything that adds, removes or reshapes (stations, seats, fuels,
// envelopes, table rows and columns, runway conditions, stall speeds, compass cards) and plain field
// assignments where the page has an input. The result must equal the seeded aircraft, so every
// value of the seed can be expressed in the editor. Station and seat ids are the one exception: they
// are internal keys the page makes ('seats', 'bag2', 'seats-1') and shows but does not let one type
// (saved flights refer to them), so the comparison maps the page's ids to the seed's by position.
// And an aircraft survives the editor's draft handling (structuredClone + validation) and the API's
// content checks without loss.
import { describe, expect, test } from 'vitest';

import {
  checkCompassCards,
  checkEquipment,
  checkFuel,
  checkMassBalance,
  checkPerformance,
} from '../../../api/_lib/aircraftDoc';
import {
  addCombinedLimit,
  addCompassCard,
  addFuelType,
  addHeadwind,
  addLandingAltitude,
  addRunwayCondition,
  addSeat,
  addStallSpeeds,
  addStation,
  addTakeoffAltitude,
  addTakeoffMassRow,
  addUtilityEnvelope,
  removeFuelType,
  removeSeat,
  setArmRange,
  setRunwayConditions,
  validateAircraft,
} from '../../../src/features/hangar/model';
import { blankAircraft } from '../../../src/shared/templates';
import type { AircraftInput, TakeoffTable } from '../../../src/shared/types';
import { fleetSeed } from '../../../tools/build_seed';

/** Builds `target` on a blank aircraft the way a pilot would on the aircraft page. */
function buildFromScratch(target: AircraftInput): AircraftInput {
  const a = blankAircraft();
  const t = structuredClone(target);

  // Identity, speeds, notes: text and number inputs
  a.registration = t.registration;
  a.makeModel = t.makeModel;
  a.serial = t.serial;
  a.icaoType = t.icaoType;
  a.wake = t.wake;
  a.homeBase = t.homeBase;
  a.colours = t.colours;
  a.operator = t.operator;
  a.notes = t.notes;
  a.cruiseTasKt = t.cruiseTasKt;
  a.patternTasKt = t.patternTasKt;
  a.climbTasKt = t.climbTasKt;

  // Flight plan items: the item 10 inputs / chips, item 18 inputs, item 19 checkboxes and dinghy fields
  a.equipment.item10a = t.equipment.item10a;
  a.equipment.item10b = t.equipment.item10b;
  a.equipment.pbn = t.equipment.pbn;
  a.equipment.item18Extras = t.equipment.item18Extras;
  a.equipment.remarks = t.equipment.remarks;
  Object.assign(a.equipment.emergencyRadio, t.equipment.emergencyRadio);
  Object.assign(a.equipment.survival, t.equipment.survival);
  Object.assign(a.equipment.jackets, t.equipment.jackets);
  a.equipment.dinghies = t.equipment.dinghies ? { ...t.equipment.dinghies } : null;

  // Fuel: approved fuels added (+ AVGAS, + MOGAS …) at their standard density; the blank's AVGAS removed if not wanted
  for (const g of t.fuel.types) addFuelType(a.fuel, g.type);
  for (const g of [...a.fuel.types]) if (!t.fuel.types.some((x) => x.type === g.type)) removeFuelType(a.fuel, g.type);
  a.fuel.types.sort(
    (x, y) => t.fuel.types.findIndex((g) => g.type === x.type) - t.fuel.types.findIndex((g) => g.type === y.type),
  );
  a.fuel.totalL = t.fuel.totalL;
  a.fuel.usableL = t.fuel.usableL;
  a.fuel.unusableL = t.fuel.unusableL;
  a.fuel.tanks = t.fuel.tanks;
  a.fuel.burnLph = t.fuel.burnLph;
  a.fuel.taxiAllowanceL = t.fuel.taxiAllowanceL;
  a.fuel.unusableIncludedInEmptyMass = t.fuel.unusableIncludedInEmptyMass;

  // Mass & balance: empty aircraft, weighing, datum, maximum masses
  const mb = a.massBalance,
    tm = t.massBalance;
  mb.emptyMassKg = tm.emptyMassKg;
  mb.emptyArmM = tm.emptyArmM;
  mb.emptyMomentKgM = tm.emptyMomentKgM;
  mb.weighingDate = tm.weighingDate;
  mb.weighingSource = tm.weighingSource;
  mb.datum = tm.datum;
  mb.includesOil = tm.includesOil;
  mb.mtowKg = tm.mtowKg;
  mb.mlwKg = tm.mlwKg;
  // stations: "+ Seat row" / "+ Baggage area" / "+ Fuel", then name, id (kept stable), arm, range, max load, seats
  for (const ts of tm.stations) {
    const s = addStation(mb, ts.kind);
    const i = mb.stations.length - 1;
    s.name = ts.name;
    s.armM = ts.armM;
    if (ts.armRangeM) {
      setArmRange(s, 0, ts.armRangeM[0]);
      setArmRange(s, 1, ts.armRangeM[1]);
    }
    if (ts.kind === 'baggage') s.maxKg = ts.maxKg ?? null;
    if (ts.kind === 'seat') {
      removeSeat(mb, i, 0);
      for (const seat of ts.seats ?? []) addSeat(mb, i, seat.label);
    }
  }
  for (const cl of tm.combinedLimits) {
    addCombinedLimit(mb);
    const c = mb.combinedLimits[mb.combinedLimits.length - 1];
    // the checkboxes: the stations of the limit, by position
    c.stations = cl.stations.map((id) => mb.stations[tm.stations.findIndex((x) => x.id === id)].id);
    c.maxKg = cl.maxKg;
  }
  // envelopes: the point tables (+ Add point), max mass, notes; utility added with "Add utility envelope"
  const fill = (e: AircraftInput['massBalance']['envelopes']['normal'], te: typeof e) => {
    e.maxKg = te.maxKg;
    e.polygon = [];
    for (const p of te.polygon) e.polygon.push([p[0], p[1]]);
    e.momentPolygon = te.momentPolygon ? te.momentPolygon.map((p) => [p[0], p[1]] as [number, number]) : null;
    if (te.notes !== undefined) e.notes = te.notes;
    else delete e.notes;
  };
  fill(mb.envelopes.normal, tm.envelopes.normal);
  if (tm.envelopes.utility) fill(addUtilityEnvelope(mb), tm.envelopes.utility);

  // Performance: take-off table built column by column and row by row, then every cell typed
  const p = a.performance,
    tp = t.performance;
  let to: TakeoffTable = p.takeoff;
  for (let k = 0; k < tp.takeoff.altitudesFt.length; k++) to = addTakeoffAltitude(to);
  for (const [ri, row] of tp.takeoff.rows.entries()) {
    to = addTakeoffMassRow(to);
    while (to.rows[ri].headwindKt.length < row.headwindKt.length) to = addHeadwind(to, ri);
  }
  to.altitudesFt = [...tp.takeoff.altitudesFt];
  to.standardTempC = [...tp.takeoff.standardTempC];
  to.rows.forEach((r, ri) => {
    const tr = tp.takeoff.rows[ri];
    r.massKg = tr.massKg;
    r.liftoffIas = tr.liftoffIas;
    r.headwindKt = [...tr.headwindKt];
    r.distances.forEach((hw, h) =>
      hw.forEach((_, al) => {
        hw[al] = [tr.distances[h][al][0], tr.distances[h][al][1]];
      }),
    );
  });
  to.source = tp.takeoff.source;
  to.flaps = tp.takeoff.flaps;
  to.tempIncreasePer15C = tp.takeoff.tempIncreasePer15C;
  to.grassAddFractionOfTotal = tp.takeoff.grassAddFractionOfTotal;
  to.notes = [...tp.takeoff.notes];
  p.takeoff = to;
  let ld = p.landing;
  for (let k = 0; k < tp.landing.altitudesFt.length; k++) ld = addLandingAltitude(ld);
  ld.altitudesFt = [...tp.landing.altitudesFt];
  ld.standardTempC = [...tp.landing.standardTempC];
  ld.distances = ld.distances.map((_, k) => [tp.landing.distances[k][0], tp.landing.distances[k][1]]);
  ld.source = tp.landing.source;
  ld.flaps = tp.landing.flaps;
  ld.massKg = tp.landing.massKg;
  ld.approachIas = tp.landing.approachIas;
  ld.headwindDecreasePer5Kt = tp.landing.headwindDecreasePer5Kt;
  ld.tempIncreasePer15C = tp.landing.tempIncreasePer15C;
  ld.grassAddFractionOfTotal = tp.landing.grassAddFractionOfTotal;
  ld.notes = [...tp.landing.notes];
  p.landing = ld;
  // planning factors: inputs, and the runway condition table (+ Condition, then name and factor)
  const f = p.factors,
    tf = tp.factors;
  f.source = tf.source;
  f.safetyFactorTakeoff = tf.safetyFactorTakeoff;
  f.safetyFactorLanding = tf.safetyFactorLanding;
  f.slopeFactorPer2Pct = tf.slopeFactorPer2Pct;
  f.maxCrosswindKt = { ...tf.maxCrosswindKt };
  f.notes = [...tf.notes];
  setRunwayConditions(f, []);
  for (const [name, factor] of Object.entries(tf.runwayCondition)) addRunwayCondition(f, name, factor);
  // stall speeds: "Add stall speeds", then the 12 cells
  if (tp.stallIasKt) {
    addStallSpeeds(p);
    for (const k of ['flapsUp', 'flaps10', 'flaps40'] as const)
      tp.stallIasKt[k].forEach((v, i) => {
        p.stallIasKt![k][i] = v;
      });
  } else p.stallIasKt = null;

  // Compass cards: "+ Add card", then name, dates, reference and the for / steer table
  for (const tc of t.compassCards) {
    const c = addCompassCard(a, '2020-01-01');
    c.name = tc.name;
    c.swung = tc.swung;
    c.expires = tc.expires;
    c.source = tc.source;
    c.points = tc.points.map((q) => [q[0], q[1]] as [number, number]);
  }
  return a;
}

/** The built aircraft with its station and seat ids replaced by the target's (same positions). */
function withIdsOf(a: AircraftInput, target: AircraftInput): AircraftInput {
  const b = structuredClone(a);
  const map = new Map(b.massBalance.stations.map((s, i) => [s.id, target.massBalance.stations[i].id]));
  b.massBalance.stations.forEach((s, i) => {
    const ts = target.massBalance.stations[i];
    s.id = ts.id;
    s.seats?.forEach((seat, k) => {
      seat.id = ts.seats![k].id;
    });
  });
  b.massBalance.combinedLimits.forEach((c) => {
    c.stations = c.stations.map((id) => map.get(id) ?? id);
  });
  return b;
}

/** What the API stores for a POSTed aircraft document (aircraftDoc content checks). */
const throughApi = (a: AircraftInput): AircraftInput => ({
  ...a,
  fuel: checkFuel(a.fuel),
  massBalance: checkMassBalance(a.massBalance),
  performance: checkPerformance(a.performance),
  equipment: checkEquipment(a.equipment),
  compassCards: checkCompassCards(a.compassCards),
});

describe('the seeded aircraft can be built from scratch in the hangar editor', () => {
  for (const seed of fleetSeed()) {
    test(`${seed.registration}: blank aircraft + editor operations = the seed`, () => {
      const built = buildFromScratch(seed);
      expect(validateAircraft(built, '2026-11-15').filter((i) => i.level === 'error')).toEqual([]);
      const ids = built.massBalance.stations.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(withIdsOf(built, seed)).toEqual(seed);
      expect(throughApi(built)).toEqual(built);
    });
    test(`${seed.registration}: round trip through the editor draft and the API checks without loss`, () => {
      const draft: AircraftInput = structuredClone(seed);
      expect(validateAircraft(draft, '2026-11-15').filter((i) => i.level === 'error')).toEqual([]);
      expect(throughApi(draft)).toEqual(seed);
      expect(JSON.parse(JSON.stringify(draft))).toEqual(seed);
    });
  }

  test('a from-scratch build also works for a different layout (six seats, two fuels, no utility)', () => {
    const t = structuredClone(fleetSeed()[1]);
    t.massBalance.stations.splice(2, 0, {
      id: 'mid',
      name: 'Middle row',
      kind: 'seat',
      armM: 1.5,
      armRangeM: null,
      maxKg: null,
      seats: [
        { id: 'mid-l', label: 'Mid left' },
        { id: 'mid-r', label: 'Mid right' },
      ],
    });
    t.fuel.types = [
      { type: 'MOGAS', densityKgPerL: 0.75 },
      { type: 'AVGAS', densityKgPerL: 0.72 },
    ];
    t.performance.factors.runwayCondition = { 'wet asphalt': 1.15 };
    t.performance.stallIasKt = null;
    expect(withIdsOf(buildFromScratch(t), t)).toEqual(t);
    expect(throughApi(t)).toEqual(t);
  });
});
