// The one-time hangar migration matches its sources and the generated file is current.
import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fleetSeed, seedModule } from '../../../tools/build_seed';

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
  expect(asv.massBalance.envelopes.utility!.maxKg).toBe(910);
  expect(asg.compassCards.map((c) => c.name)).toEqual(['Magnetic compass', 'GMU (G1000 heading)']);
  const seats = asv.massBalance.stations.flatMap((s) => s.seats ?? []).map((s) => s.id);
  expect(seats).toEqual(['front-left', 'front-right', 'rear-left', 'rear-right']);
});
