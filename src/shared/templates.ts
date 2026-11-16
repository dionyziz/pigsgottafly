// Aircraft TYPE templates. A template carries the type's AFM data (fuel system, stations and seat
// layout, envelopes, performance tables) and, where the type file has them, planning factors as
// ordinary editable values (the F172M file: Aeroclub Mesogeion's MD 4.4 factors), but nothing about a particular airframe:
// registration, serial, empty mass/arm (weighing report), colours, equipment and compass cards are
// left blank for the pilot to fill in. Used by "Add aircraft → from type template" in the hangar,
// and by tools/build_seed.ts (the one-time migration of the existing pilot's own aircraft).
//
// Input: the parsed JSON of a type file such as data/aircraft/reims-f172m.json.
import type { AircraftInput, FuelType, Station, StationKind, SeatPosition } from './types.js';
import { FUEL_DENSITY } from './fuel.js';

export interface AircraftTypeTemplate {
  /** e.g. 'reims-f172m' */
  id: string;
  /** e.g. 'Reims/Cessna F172M' */
  label: string;
  /** Builds a blank aircraft of this type. */
  build(): AircraftInput;
}

/** Seat layout per seat station id for the C172 family (front: pilot + front pax, rear: two). */
const C172_SEATS: Record<string, SeatPosition[]> = {
  front: [{ id: 'front-left', label: 'Front left' }, { id: 'front-right', label: 'Front right' }],
  rear: [{ id: 'rear-left', label: 'Rear left' }, { id: 'rear-right', label: 'Rear right' }],
};

function stationKind(id: string): StationKind {
  return id === 'fuel' ? 'fuel' : id.startsWith('bag') ? 'baggage' : 'seat';
}

/** AircraftInput (blank airframe) from a type JSON in the data/aircraft/reims-f172m.json format. */
export function aircraftFromTypeJson(type: any): AircraftInput {
  const mb = type.massBalance;
  const stations: Station[] = mb.stations.map((s: any): Station => {
    const kind = stationKind(s.id);
    const seats: SeatPosition[] | null = kind === 'seat'
      ? C172_SEATS[s.id] ?? Array.from({ length: s.seats ?? 1 }, (_, i) => ({ id: `${s.id}-${i + 1}`, label: `${s.name} ${i + 1}` }))
      : null;
    return { id: s.id, name: s.name, kind, armM: s.armM, armRangeM: s.armRangeM ?? null, maxKg: s.maxKg ?? null, seats };
  });
  return {
    registration: '',
    makeModel: type.type,
    icaoType: type.icaoType,
    wake: type.wake,
    serial: '',
    operator: '',
    operatorId: null,
    homeBase: '',
    colours: '',
    cruiseTasKt: 0,
    patternTasKt: 0,
    climbTasKt: null,
    fuel: {
      // The type's approved fuels (the AFM's: AVGAS); a MOGAS STC is per airframe, added in the hangar.
      types: (type.fuel.approved ?? ['AVGAS']).map((t: FuelType) => ({ type: t, densityKgPerL: FUEL_DENSITY[t] })),
      totalL: type.fuel.totalStandardL,
      usableL: type.fuel.usableStandardL,
      unusableL: type.fuel.unusableL,
      unusableIncludedInEmptyMass: false,
      tanks: 'standard',
      burnLph: 0,
      taxiAllowanceL: 0,
    },
    massBalance: {
      datum: 'Forward face of firewall',
      emptyMassKg: 0,
      emptyArmM: 0,
      emptyMomentKgM: 0,
      weighingDate: null,
      weighingSource: '',
      includesOil: true,
      mtowKg: mb.mtowKg,
      mlwKg: null,
      stations,
      combinedLimits: mb.combinedLimits ?? [],
      envelopes: {
        normal: { category: 'normal', maxKg: mb.envelopes.normal.maxKg, polygon: mb.envelopes.normal.polygon, momentPolygon: null },
        utility: mb.envelopes.utility
          ? { category: 'utility', maxKg: mb.envelopes.utility.maxKg, polygon: mb.envelopes.utility.polygon, momentPolygon: null }
          : null,
      },
    },
    performance: {
      takeoff: {
        source: type.takeoff.source ?? '', flaps: type.takeoff.flaps, altitudesFt: type.takeoff.altitudesFt,
        standardTempC: type.takeoff.standardTempC, rows: type.takeoff.rows, tempIncreasePer15C: 0.1,
        grassAddFractionOfTotal: 0.07, notes: type.takeoff.notes ?? [],
      },
      landing: {
        source: type.landing.source ?? '', flaps: type.landing.flaps, massKg: type.landing.massKg, approachIas: type.landing.approachIas,
        altitudesFt: type.landing.altitudesFt, standardTempC: type.landing.standardTempC, distances: type.landing.distances,
        headwindDecreasePer5Kt: 0.1, tempIncreasePer15C: 0.1, grassAddFractionOfTotal: 0.2, notes: type.landing.notes ?? [],
      },
      factors: {
        // Planning factors are the operator's (club) rules, not AFM data: no source caption is carried.
        source: '',
        safetyFactorTakeoff: type.clubFactors?.safetyFactorTakeoff ?? 1,
        safetyFactorLanding: type.clubFactors?.safetyFactorLanding ?? 1,
        runwayCondition: type.clubFactors?.runwayCondition ?? {},
        slopeFactorPer2Pct: type.clubFactors?.slopeFactorPer2PctUp ?? 1,
        maxCrosswindKt: type.clubFactors?.maxCrosswindKt ?? { takeoff: 99, landing: 99 },
        notes: type.clubFactors?.notes ?? [],
      },
      stallIasKt: type.stallIasKt ? { flapsUp: type.stallIasKt.flapsUp, flaps10: type.stallIasKt.flaps10, flaps40: type.stallIasKt.flaps40 } : null,
    },
    equipment: {
      item10a: '',
      item10b: '',
      pbn: '',
      item18Extras: '',
      emergencyRadio: { uhf: false, vhf: false, elt: false },
      survival: { polar: false, desert: false, maritime: false, jungle: false },
      jackets: { present: false, light: false, fluorescein: false, uhf: false, vhf: false },
      dinghies: null,
      remarks: '',
    },
    compassCards: [],
    notes: '',
  };
}

/** Empty aircraft (no type template). */
export function blankAircraft(): AircraftInput {
  const a = aircraftFromTypeJson({
    type: '', icaoType: '', wake: 'L',
    fuel: { densityKgPerL: { AVGAS: 0.72 }, totalStandardL: 0, usableStandardL: 0, unusableL: 0 },
    massBalance: { mtowKg: 0, stations: [], combinedLimits: [], envelopes: { normal: { maxKg: 0, polygon: [] }, utility: null } },
    takeoff: { source: '', flaps: '', altitudesFt: [], standardTempC: [], rows: [] },
    landing: { source: '', flaps: '', massKg: 0, approachIas: '', altitudesFt: [], standardTempC: [], distances: [] },
  });
  return a;
}
