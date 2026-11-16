// The owner's SX-ASV and SX-ASG as AircraftInput records, built from data/aircraft/fleet.json
// (per-aircraft weighing reports, tanks, approved fuels), data/aircraft/reims-f172m.json (type data:
// AFM fuel, stations, envelopes, performance tables, club factors) and data/aircraft/compass-cards.json.
//
// fleetSeed() is the CURRENT state of those two aircraft as the migrations leave them in the owner's
// hangar, apart from the flight-plan equipment and colours that 011 sets: migration 003 (one-time,
// applied in production, FROZEN: this file generated it and no longer rewrites it) inserted them, and
// 014 converted them (approved fuels AVGAS + MOGAS, no seeded notes, no file paths as sources).
// tests/api/migrations.test.ts checks that 003 + 011 + 014 give exactly fleetSeed() (+ 011's values).
// The tests use fleetSeed() as the owner's aircraft (W&B and performance cross-checks, e2e).
//   npm exec tsx tools/build_seed.ts   (prints the two aircraft as JSON)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AircraftInput, CompassCard, FuelType } from '../src/shared/types.js';
import { DEFAULT_FUEL_DENSITY } from '../src/shared/fuel.js';
import { aircraftFromTypeJson } from '../src/shared/templates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

export function fleetSeed(): AircraftInput[] {
  const fleet = readJson('data/aircraft/fleet.json');
  const type = readJson('data/aircraft/reims-f172m.json');
  const cards = readJson('data/aircraft/compass-cards.json');
  // Moment envelopes from the club W&B calculator (fleet.json _crosscheck): [moment kg·m, mass kg].
  const momentNormal: [number, number][] = [
    [600, 675],
    [780, 890],
    [1020, 1043],
    [1258, 1043],
    [805, 675],
  ];
  // The club's utility polygon stops at 905 kg, the AFM utility maximum is 2000 lb = 907 kg (the CG
  // envelope's maxKg). Its two upper edges are extended to 907 kg ((780,890)→(807,905) gives 810.6;
  // (700,675)→(927,905) gives 929.0) so that a mass between 905 and 907 kg is judged on its CG, not
  // reported as outside the envelope while within the maximum mass.
  const momentUtility: [number, number][] = [
    [600, 675],
    [780, 890],
    [810.6, 907],
    [929, 907],
    [700, 675],
  ];

  return ['SX-ASV', 'SX-ASG'].map((reg): AircraftInput => {
    const f = fleet[reg];
    const a = aircraftFromTypeJson(type);
    const longRange = f.fuel.tanks === 'long-range';
    a.registration = reg;
    a.serial = f.serial;
    a.operator = f.operator;
    a.homeBase = 'LGTT';
    a.cruiseTasKt = f.cruiseTasKt;
    a.patternTasKt = f.patternTasKt;
    a.fuel = {
      ...a.fuel,
      totalL: f.fuel.usableL + type.fuel.unusableL,
      usableL: f.fuel.usableL,
      types: (f.fuel.approved as FuelType[]).map((t) => ({
        type: t,
        densityKgPerL: type.fuel.densityKgPerL[t] ?? DEFAULT_FUEL_DENSITY[t],
      })),
      unusableIncludedInEmptyMass: !!f.emptyMass.includesUnusableFuel,
      tanks: longRange ? 'long-range' : 'standard',
      burnLph: 30,
      taxiAllowanceL: 4,
    };
    const mb = a.massBalance;
    mb.emptyMassKg = f.emptyMass.kg;
    mb.emptyArmM = f.emptyMass.armM;
    mb.emptyMomentKgM = f.emptyMass.momentKgM;
    mb.weighingDate = reg === 'SX-ASV' ? '2024-11-14' : '2024-02-28';
    mb.weighingSource = f.emptyMass.report;
    mb.includesOil = !!f.emptyMass.includesOil;
    mb.envelopes.normal.momentPolygon = momentNormal;
    if (f.categories.includes('utility') && mb.envelopes.utility) {
      mb.envelopes.utility.momentPolygon = momentUtility;
      mb.envelopes.utility.notes = f.utilityNote ?? '';
    } else mb.envelopes.utility = null;
    // Colours and markings (FPL item 19 A/): from fleet.json when a source is known (its _coloursNote
    // says which). Where none is, they are not invented: the hangar flags the empty field ('Colours and
    // markings not set') and the FPL export warns until the pilot fills it.
    a.colours = typeof f.colours === 'string' ? f.colours : '';
    // Equipment: to be confirmed by the pilot in the hangar. Per-aircraft facts from fleet.json
    // (e.g. SX-ASG's life vests listed in its weighing report → item 19 J/).
    const jackets = f.equipment?.jackets;
    a.equipment = {
      ...a.equipment,
      item10a: 'S',
      item10b: 'C',
      emergencyRadio: { uhf: false, vhf: false, elt: true },
      ...(jackets ? { jackets: { ...a.equipment.jackets, ...jackets } } : {}),
    };
    a.compassCards = cards[reg].map((c: CompassCard & { _file?: string }): CompassCard => ({
      name: c.name,
      swung: c.swung,
      expires: c.expires,
      source: '',
      points: c.points,
    }));
    a.notes = '';
    return a;
  });
}

/** The existing pilot's own profile values (one-time migration; NOT app defaults). */
export const EXISTING_PILOT_PROFILE = {
  /**
   * Only the account with this e-mail gets the values below and the hangar.
   * SHA-256 (hex) of the lower-cased, trimmed address, so the address itself is not published in
   * this public repository. Any other account existing when the migration runs is marked seeded
   * and gets nothing.
   */
  ownerEmailSha256: '0f8a30628c0ec410f2ea9ec36e004bf15fea39d4a69e8cf1011e0a3b560486c6',
  homeAerodrome: 'LGTT',
  settings: { taxiOutMin: 15, taxiInMin: 15, reserveMin: 60 },
  defaultAircraft: 'SX-ASV',
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(JSON.stringify(fleetSeed(), null, 2));
}
