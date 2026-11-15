// Hangar seed: SX-ASV and SX-ASG as AircraftInput records, built from data/aircraft/fleet.json
// (per-aircraft weighing reports, tanks), data/aircraft/reims-f172m.json (type data: AFM fuel,
// stations, envelopes, performance tables, club factors) and data/aircraft/compass-cards.json.
//
// Writes api/_lib/migrations/003_existing_pilot_data.ts: a ONE-TIME data migration for the owner's
// account if it exists when it runs (in production: converted from the v2 users table; matched by e-mail).
// It gives it its profile values (home LGTT, taxi 15/15, reserve 60, default SX-ASV) and their
// hangar. Pilots who sign up later get nothing: empty profile, empty hangar (pilot correction #1).
//   npm exec tsx tools/build_seed.ts [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AircraftInput } from '../src/shared/types.js';
import { DEFAULT_SETTINGS } from '../src/shared/constants.js';
import { aircraftFromTypeJson } from '../src/shared/templates.js';


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'api', '_lib', 'migrations', '003_existing_pilot_data.ts');
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

export function fleetSeed(): AircraftInput[] {
  const fleet = readJson('data/aircraft/fleet.json');
  const type = readJson('data/aircraft/reims-f172m.json');
  const cards = readJson('data/aircraft/compass-cards.json');
  // Moment envelopes from the club W&B calculator (fleet.json _crosscheck): [moment kg·m, mass kg].
  const momentNormal: [number, number][] = [[600, 675], [780, 890], [1020, 1043], [1258, 1043], [805, 675]];
  // The club's utility polygon stops at 905 kg, the AFM utility maximum is 2000 lb = 907 kg (the CG
  // envelope's maxKg). Its two upper edges are extended to 907 kg ((780,890)→(807,905) gives 810.6;
  // (700,675)→(927,905) gives 929.0) so that a mass between 905 and 907 kg is judged on its CG, not
  // reported as outside the envelope while within the maximum mass.
  const momentUtility: [number, number][] = [[600, 675], [780, 890], [810.6, 907], [929, 907], [700, 675]];

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
    a.fuel = { ...a.fuel, totalL: f.fuel.usableL + type.fuel.unusableL, usableL: f.fuel.usableL,
      unusableIncludedInEmptyMass: !!f.emptyMass.includesUnusableFuel, tanks: longRange ? 'long-range' : 'standard', burnLph: 30, taxiAllowanceL: 4 };
    const mb = a.massBalance;
    mb.emptyMassKg = f.emptyMass.kg;
    mb.emptyArmM = f.emptyMass.armM;
    mb.emptyMomentKgM = f.emptyMass.momentKgM;
    mb.weighingDate = reg === 'SX-ASV' ? '2024-11-14' : '2024-02-28';
    mb.weighingSource = f.emptyMass._source;
    mb.includesOil = !!f.emptyMass.includesOil;
    mb.envelopes.normal.momentPolygon = momentNormal;
    if (f.categories.includes('utility') && mb.envelopes.utility) {
      mb.envelopes.utility.momentPolygon = momentUtility;
      mb.envelopes.utility.notes = f.utilityNote ?? '';
    } else mb.envelopes.utility = null;
    // Colours and markings (FPL item 19 A/): from fleet.json when known. Neither the AFMs, the weighing
    // reports nor the compass swing reports state them, so they are not invented: the hangar flags
    // the empty field ('Colours and markings not set') and the FPL export warns until the pilot fills it.
    a.colours = typeof f.colours === 'string' ? f.colours : '';
    // Equipment: to be confirmed by the pilot in the hangar (not in the source data).
    a.equipment = { ...a.equipment, item10a: 'S', item10b: 'C', emergencyRadio: { uhf: false, vhf: false, elt: true } };
    a.compassCards = cards[reg];
    a.notes = [f.emptyMass._note, f.utilityNote].filter(Boolean).join('\n');
    return a;
  });
}

/** The existing pilot's own profile values (one-time migration; NOT app defaults). */
export const EXISTING_PILOT_PROFILE = {
  /**
   * Only the account with this e-mail gets the values below and the hangar (pilot correction 1).
   * SHA-256 (hex) of the lower-cased, trimmed address, so the address itself is not published in
   * this public repository. Any other account existing when the migration runs is marked seeded
   * and gets nothing.
   */
  ownerEmailSha256: '0f8a30628c0ec410f2ea9ec36e004bf15fea39d4a69e8cf1011e0a3b560486c6',
  homeAerodrome: 'LGTT',
  settings: { taxiOutMin: 15, taxiInMin: 15, reserveMin: 60 },
  defaultAircraft: 'SX-ASV',
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** SQL condition: the pilot row (alias `p`) is the owner account. */
const isOwner = (hash: string) => `encode(sha256(convert_to(lower(btrim(p.email)), 'UTF8')), 'hex') = ${q(hash)}`;

/** @param ownerEmailSha256 the owner account's e-mail hash (tests pass their own). */
export function seedSql(ownerEmailSha256: string = EXISTING_PILOT_PROFILE.ownerEmailSha256): string {
  const P = EXISTING_PILOT_PROFILE;
  const settings = { ...DEFAULT_SETTINGS, ...P.settings };
  const rows = fleetSeed().map((a) => {
    const vals = [
      q(a.registration), q(a.makeModel), q(a.icaoType), q(a.wake), q(a.serial), q(a.operator), q(a.homeBase), q(a.colours),
      String(a.cruiseTasKt), String(a.patternTasKt), a.climbTasKt === null ? 'NULL' : String(a.climbTasKt),
      `${q(JSON.stringify(a.fuel))}::jsonb`, `${q(JSON.stringify(a.massBalance))}::jsonb`, `${q(JSON.stringify(a.performance))}::jsonb`,
      `${q(JSON.stringify(a.equipment))}::jsonb`, `${q(JSON.stringify(a.compassCards))}::jsonb`, q(a.notes),
    ];
    return `INSERT INTO aircraft (id, pilot_id, registration, make_model, icao_type, wake, serial, operator, home_base, colours,
  cruise_tas_kt, pattern_tas_kt, climb_tas_kt, fuel, mass_balance, performance, equipment, compass_cards, notes, created, updated)
SELECT 'ac_' || substr(md5(p.id || ${q(a.registration)}), 1, 12), p.id, ${vals.join(', ')}, ${NOW}, ${NOW}
FROM pilots p WHERE p.seeded_at IS NULL AND ${isOwner(ownerEmailSha256)}
ON CONFLICT (pilot_id, registration) DO NOTHING;`;
  });
  return `-- Generated by tools/build_seed.ts. Do not edit by hand.
-- ONE-TIME data migration: the owner's account (production: converted from the v2 users table;
-- matched by the SHA-256 of its e-mail) gets its profile values and hangar. Every other pilot existing
-- now is marked seeded with nothing, and later sign-ups get nothing.
UPDATE pilots p SET
  settings = ${q(JSON.stringify(settings))}::jsonb || p.settings,
  home_aerodrome = COALESCE(p.home_aerodrome, ${q(P.homeAerodrome)})
WHERE p.seeded_at IS NULL AND ${isOwner(ownerEmailSha256)};
${rows.join('\n')}
UPDATE pilots p SET seeded_at = ${NOW},
  default_aircraft_id = COALESCE(p.default_aircraft_id, (SELECT a.id FROM aircraft a WHERE a.pilot_id = p.id AND a.registration = ${q(P.defaultAircraft)}))
WHERE p.seeded_at IS NULL;
`;
}

const NOW = '(extract(epoch FROM clock_timestamp()) * 1000)::BIGINT';

export function seedModule(): string {
  return `// Generated by tools/build_seed.ts from data/aircraft/*.json. Do not edit by hand.
// ONE-TIME data migration for the pilots existing when it runs (see the SQL comment).
const sql: string = ${JSON.stringify(seedSql())};
export default sql;
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const text = seedModule();
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (process.argv.includes('--check')) {
    if (cur !== text) { console.error('stale:', path.relative(ROOT, OUT)); process.exit(1); }
  } else if (cur !== text) { fs.writeFileSync(OUT, text); console.log('wrote', path.relative(ROOT, OUT)); }
  else console.log('seed up to date');
}
