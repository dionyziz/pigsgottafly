// The one-time hangar migration matches its sources and the generated file is current.
import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EXISTING_PILOT_PROFILE, fleetSeed, seedModule, seedSql } from '../../../tools/build_seed';

test('generated 003 migration is up to date', () => {
  const f = path.join(__dirname, '../../../api/_lib/migrations/003_existing_pilot_data.ts');
  expect(fs.readFileSync(f, 'utf8') === seedModule()).toBe(true);
});

test('SX-ASV and SX-ASG from the weighing reports and the AFM', () => {
  const [asv, asg] = fleetSeed();
  expect(asv).toMatchObject({ registration: 'SX-ASV', icaoType: 'C172', cruiseTasKt: 92, patternTasKt: 80 });
  expect(asv.massBalance).toMatchObject({ emptyMassKg: 691.2, emptyArmM: 1.0403, mtowKg: 1043 });
  expect(asv.fuel).toMatchObject({ usableL: 144, burnLph: 30, taxiAllowanceL: 4 });
  expect(asg.fuel.usableL).toBe(182);
  expect(asg.massBalance.envelopes.utility).toBeNull();
  // AFM utility category: 2000 lb = 907 kg; the CG and moment polygons both top out there
  const ut = asv.massBalance.envelopes.utility!;
  expect(ut.maxKg).toBe(907);
  expect(Math.max(...ut.polygon.map((p) => p[1]))).toBe(907);
  expect(Math.max(...ut.momentPolygon!.map((p) => p[1]))).toBe(907);
  // colours are not in the source documents: left empty (the hangar and the FPL export flag it)
  expect(asv.colours).toBe('');
  expect(asg.compassCards.map((c) => c.name)).toEqual(['Magnetic compass', 'GMU (G1000 heading)']);
  const seats = asv.massBalance.stations.flatMap((s) => s.seats ?? []).map((s) => s.id);
  expect(seats).toEqual(['front-left', 'front-right', 'rear-left', 'rear-right']);
});

test('owner e-mail: the seed targets one account by SHA-256 of its address', () => {
  expect(EXISTING_PILOT_PROFILE.ownerEmailSha256).toMatch(/^[0-9a-f]{64}$/);
  const sql = seedSql();
  // the profile UPDATE and both aircraft INSERTs require the owner; the final UPDATE marks everyone seeded
  expect(sql.match(new RegExp(EXISTING_PILOT_PROFILE.ownerEmailSha256, 'g'))!.length).toBe(3);
  expect(sql).not.toMatch(/@/);
});
