// The owner's two aircraft as tools/build_seed.ts describes them (003 + 014; checked against the
// migrations in tests/api/migrations.test.ts), and the owner match of the data migrations.
import { expect, test } from 'vitest';
import { EXISTING_PILOT_PROFILE, fleetSeed } from '../../../tools/build_seed';
import sql003 from '../../../api/_lib/migrations/003_existing_pilot_data';
import sql014 from '../../../api/_lib/migrations/014_aircraft_fuels_provenance';

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
  expect(ut.notes).toBe('No rear passengers, no baggage.');
  // colours are not in the source documents: left empty (011 later sets the filed ones)
  expect(asv.colours).toBe('');
  expect(asg.compassCards.map((c) => c.name)).toEqual(['Magnetic compass', 'GMU (G1000 heading)']);
  const seats = asv.massBalance.stations.flatMap((s) => s.seats ?? []).map((s) => s.id);
  expect(seats).toEqual(['front-left', 'front-right', 'rear-left', 'rear-right']);
});

test('both take AVGAS (usual) and MOGAS; no seeded notes, file paths or club captions', () => {
  for (const a of fleetSeed()) {
    expect(a.fuel.types).toEqual([{ type: 'AVGAS', densityKgPerL: 0.72 }, { type: 'MOGAS', densityKgPerL: 0.75 }]);
    expect(a.notes).toBe('');
    expect(a.performance.factors.source).toBe('');
    const texts = [a.massBalance.weighingSource, ...a.compassCards.map((c) => c.source), a.performance.takeoff.source, a.performance.landing.source];
    for (const t of texts) expect(t).not.toMatch(/trn-docs|\.pdf|Mesogeion|\[/i);
  }
});

test('owner e-mail: the data migrations target one account by SHA-256 of its address', () => {
  const h = EXISTING_PILOT_PROFILE.ownerEmailSha256;
  expect(h).toMatch(/^[0-9a-f]{64}$/);
  // 003: the profile UPDATE and both aircraft INSERTs require the owner; the final UPDATE marks everyone seeded
  expect(sql003.match(new RegExp(h, 'g'))!.length).toBe(3);
  expect(sql014).toContain(h);
  for (const s of [sql003, sql014]) expect(s).not.toMatch(/[\w.+-]+@[\w-]+\./); // no e-mail address
});
