// computeNavlog against an independent reference (navlog.oracle.ts, written from the paper rules)
// and hand-computed values.
import { describe, expect, test } from 'vitest';

import cards from '../../../data/aircraft/compass-cards.json';
import {
  buildLegs,
  computeNavlog,
  defaultAltitudes,
  type LegGeometry,
  navlogAircraft,
  type NavlogInput,
  pickCompassCard,
  sunsetUtcMinutes,
  sunTableIndex,
  type WindProvider,
} from '../../../src/calc';
import { aerodrome, REF, SUN_TABLES, vfrPoint } from '../../../src/data/ref';
import type { CompassCard, RoutePoint } from '../../../src/shared';
import * as O from './navlog.oracle';

const ad = (icao: string): RoutePoint => {
  const a = aerodrome(icao)!;
  return { uid: 'ad-' + icao + Math.random(), kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const vfr = (id: string): RoutePoint => {
  const p = vfrPoint(id)!;
  return { uid: id, kind: 'vfr', refId: id, name: p.name, lat: p.lat, lon: p.lon };
};
const ctx = { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes };
const ASV_CARD = cards['SX-ASV'][0] as unknown as CompassCard;
const ASV = {
  cruiseTasKt: 92,
  patternTasKt: 80,
  burnLph: 30,
  taxiAllowanceL: 4,
  card: ASV_CARD.points,
  cardExpires: ASV_CARD.expires,
  cardName: ASV_CARD.name,
};
const DATE = '2026-11-20';
const DAY = Date.parse(DATE + 'T00:00:00Z');

function setup(route: RoutePoint[], winds: WindProvider | null, extra: Partial<NavlogInput> = {}): NavlogInput {
  const legs = buildLegs(route, DATE);
  const altitudesFt = defaultAltitudes(route, ctx).map((d) => d.altFt);
  return {
    date: DATE,
    blockOff: '09:00',
    taxiOutMin: 15,
    taxiInMin: 15,
    legs,
    altitudesFt,
    overrides: [],
    aircraft: ASV,
    winds,
    ...extra,
  };
}
const ROUTE = () => [ad('LGTT'), vfr('LGAV/DAPORI'), vfr('LGAV/KORINTHOS'), ad('LGMG')];

describe('against the independent reference', () => {
  // a different wind on each leg, constant in time
  const W = [
    { dirDeg: 330, speedKt: 18, tempC: 6 },
    { dirDeg: 45, speedKt: 9, tempC: 4 },
    { dirDeg: 200, speedKt: 25, tempC: 3 },
    { dirDeg: 270, speedKt: 12, tempC: 9 },
  ];
  const calls: Parameters<WindProvider>[0][] = [];
  const provider: WindProvider = (q) => {
    calls.push(q);
    return W[q.legIndex];
  };
  const input = setup(ROUTE(), provider);
  const res = computeNavlog(input);
  const n = input.legs.length;
  const exp = O.navlog(
    input.legs.map((L, i) => ({
      a: L.from,
      b: L.to,
      tas: i === 0 || i === n - 1 ? 80 : 92,
      wd: W[i].dirDeg,
      ws: W[i].speedKt,
      variation: L.variation,
    })),
    { steer: O.STEER['SX-ASV'], flow: 30, extra: 4 },
  );

  test('every written cell', () => {
    expect(res.legs).toHaveLength(3);
    res.legs.forEach((r, i) => {
      const e = exp.rows[i];
      expect({
        tc: r.tc,
        dist: r.dist,
        wca: r.wca,
        th: r.th,
        mh: r.mh,
        dev: r.dev,
        ch: r.ch,
        gs: r.gs,
        ete: r.ete,
        fuel: r.fuel,
        distRem: r.distRem,
        ateRem: r.ateRem,
      }).toEqual({
        tc: e.tc,
        dist: e.dist,
        wca: e.wca,
        th: e.th,
        mh: e.mh,
        dev: e.dev,
        ch: e.ch,
        gs: e.gs,
        ete: e.ete,
        fuel: e.fuel,
        distRem: e.rem,
        ateRem: e.ate,
      });
      expect(r.var).toBe(-Math.round(input.legs[i].variation));
      expect(r.minutesExact).toBeCloseTo(e.min, 9);
      expect([r.windDirDeg, r.windKt, r.tempC, r.windMissing, r.windSource]).toEqual([
        W[i].dirDeg,
        W[i].speedKt,
        W[i].tempC,
        false,
        'forecast',
      ]);
      expect(r.tasKt).toBe(i === 0 || i === 2 ? 80 : 92);
      // magnetic course label: true course minus WMM variation at the midpoint
      expect(r.mc).toBe(
        O.n360(Math.round(O.course(input.legs[i].from, input.legs[i].to) - input.legs[i].variation)) || 360,
      );
    });
    expect(res.totals).toEqual({
      dist: exp.totals.dist,
      ete: exp.totals.ete,
      tripFuel: exp.totals.trip,
      fuel: exp.totals.fuel,
    });
  });

  test('variation is WMM (about 5 deg E here), not a fixed 5', () => {
    for (const L of input.legs) {
      expect(L.variation).toBeGreaterThan(4.8);
      expect(L.variation).toBeLessThan(5.6);
      expect(L.variation).not.toBe(5);
    }
  });

  test('times: block start + taxi out, legs in sequence (unrounded), + taxi in', () => {
    const flown = exp.rows.reduce((s, r) => s + r.min, 0);
    expect(res.times.blockOffMin).toBe(540);
    expect(res.times.takeoffMin).toBe(555);
    expect(res.times.landingMin).toBeCloseTo(555 + flown, 9);
    expect(res.times.blockOnMin).toBeCloseTo(570 + flown, 9);
    expect(res.flightMin).toBeCloseTo(flown, 9);
    let t = 555;
    res.legs.forEach((r, i) => {
      expect(r.startMin).toBeCloseTo(t, 9);
      t += exp.rows[i].min;
      expect(r.endMin).toBeCloseTo(t, 9);
    });
    expect(res.blockOffSet).toBe(true);
  });

  test('winds are sampled at the leg midpoint, leg altitude and mid-leg time', () => {
    const last = calls.slice(-n);
    let t = 555;
    last.forEach((q, i) => {
      const m = O.midpoint(input.legs[i].from, input.legs[i].to);
      expect(q.legIndex).toBe(i);
      expect(q.lat).toBeCloseTo(m.lat, 9);
      expect(q.lon).toBeCloseTo(m.lon, 9);
      expect(q.altFt).toBe(input.altitudesFt[i]);
      expect(q.timeMs).toBeCloseTo(DAY + (t + exp.rows[i].min / 2) * 60000, 3);
      t += exp.rows[i].min;
    });
    expect(input.altitudesFt[1]).toBe(3500); // DAPORI → KORINTHOS: charted
  });

  test('no warnings for a complete plan before sunset', () => {
    expect(res.warnings).toEqual([]);
    expect(res.sunsetMin).not.toBeNull();
  });
});

test('hand-computed leg: TC 000, 60 NM, wind 270/20, TAS 80, VAR 5E', () => {
  // WCA = asin(20 sin(270°) / 80) = −14.48° → −14; GS = 80 cos 14.48° − 20 cos 270° = 77.46 → 77
  // TH 346, MH 341; time 60/77 h = 46.75 min → 0:47; fuel 46.75 × 0.5 = 23.4 → 24 L (rounded up)
  const leg: LegGeometry = {
    index: 0,
    key: 'a>b',
    from: { uid: 'a', kind: 'custom', refId: null, name: 'A', lat: 37, lon: 23 },
    to: { uid: 'b', kind: 'custom', refId: null, name: 'B', lat: 38, lon: 23 },
    mid: { lat: 37.5, lon: 23 },
    tcTrue: 0,
    tcInitial: 0,
    distNm: 60,
    variation: 5,
    mcMag: 355,
  };
  const r = computeNavlog({
    date: DATE,
    blockOff: '10:00',
    taxiOutMin: 10,
    taxiInMin: 5,
    legs: [leg],
    altitudesFt: [2500],
    overrides: [],
    aircraft: { ...ASV, card: null },
    winds: () => ({ dirDeg: 270, speedKt: 20, tempC: 10 }),
  });
  expect(r.legs[0]).toMatchObject({
    tc: 0,
    dist: 60,
    wca: -14,
    th: 346,
    var: -5,
    mh: 341,
    gs: 77,
    ete: 47,
    fuel: 24,
    tasKt: 80,
    mc: 355,
    distRem: 0,
    ateRem: 0,
  });
  expect(r.legs[0].dev).toBeUndefined();
  expect(r.legs[0].ch).toBeUndefined();
  expect(r.totals).toEqual({ dist: 60, ete: 47, tripFuel: 24, fuel: 28 });
  expect(r.times.takeoffMin).toBe(610);
  expect(r.times.landingMin).toBeCloseTo(610 + 3600 / 77, 9);
  expect(r.times.blockOnMin).toBeCloseTo(615 + 3600 / 77, 9);
});

test('written wind is rounded before the triangle (direction 1..360)', () => {
  const route = ROUTE();
  const W = [
    { dirDeg: 359.6, speedKt: 14.5, tempC: 4.4 },
    { dirDeg: 0.4, speedKt: 7.49, tempC: -0.6 },
    { dirDeg: 180.5, speedKt: 0.2, tempC: 12.5 },
  ];
  const res = computeNavlog(setup(route, (q) => W[q.legIndex]));
  expect(res.legs.map((r) => [r.windDirDeg, r.windKt, r.tempC])).toEqual([
    [360, 15, 4],
    [360, 7, -1],
    [181, 0, 13],
  ]);
  const exp = O.navlog(
    res.legs.map((r, i) => ({
      a: route[i],
      b: route[i + 1],
      tas: r.tasKt,
      wd: r.windDirDeg,
      ws: r.windKt,
      variation: r.variation,
    })),
    { steer: O.STEER['SX-ASV'] },
  );
  res.legs.forEach((r, i) =>
    expect([r.wca, r.gs, r.ete, r.fuel]).toEqual([exp.rows[i].wca, exp.rows[i].gs, exp.rows[i].ete, exp.rows[i].fuel]),
  );
});

test('time-varying wind: the 4 passes converge on the mid-leg time', () => {
  // wind strengthens 1 kt every 2 minutes from 09:00Z
  const prov: WindProvider = (q) => ({
    dirDeg: 250,
    speedKt: Math.max(0, (q.timeMs - DAY - 540 * 60000) / 120000),
    tempC: 5,
  });
  const res = computeNavlog(setup(ROUTE(), prov));
  for (const r of res.legs) {
    const mid = DAY + ((r.startMin + r.endMin) / 2) * 60000;
    expect(
      Math.abs(prov({ legIndex: r.index, lat: 0, lon: 0, altFt: r.altFt, timeMs: mid })!.speedKt - r.windKt),
    ).toBeLessThanOrEqual(0.51);
  }
});

test('TAS: first and last legs at pattern, others at cruise; overrides win; one leg = pattern', () => {
  const route = [ad('LGTT'), vfr('LGAV/DAPORI'), vfr('LGAV/KORINTHOS'), vfr('LGAV/MEGARA'), ad('LGEL')];
  const res = computeNavlog(setup(route, null, { overrides: [undefined, { tasKt: 100 }] }));
  expect(res.legs.map((r) => r.tasKt)).toEqual([80, 100, 92, 80]);
  expect(computeNavlog(setup([ad('LGTT'), ad('LGMG')], null)).legs[0].tasKt).toBe(80);
});

test('wind and temperature overrides', () => {
  const res = computeNavlog(
    setup(ROUTE(), (q) => (q.legIndex === 2 ? null : { dirDeg: 100, speedKt: 10, tempC: 7 }), {
      overrides: [{ windDirDeg: 50, windKt: 20 }, { tempC: -3 }, { windDirDeg: 90, windKt: 5 }],
    }),
  );
  expect(res.legs.map((r) => [r.windDirDeg, r.windKt, r.tempC, r.windSource, r.windMissing])).toEqual([
    [50, 20, 7, 'override', false],
    [100, 10, -3, 'forecast', false],
    [90, 5, NaN, 'override', false],
  ]);
  expect(res.warnings).toEqual([]);
});

test('missing data: warnings, calm wind, defaults', () => {
  const route = ROUTE();
  const noWinds = computeNavlog(setup(route, null, { blockOff: '', taxiOutMin: null, taxiInMin: null }));
  expect(noWinds.blockOffSet).toBe(false);
  expect(noWinds.times).toMatchObject({ blockOffMin: 720, takeoffMin: 720 });
  expect(noWinds.times.blockOnMin).toBeCloseTo(noWinds.times.landingMin, 9);
  expect(noWinds.legs.every((r) => r.windMissing && r.windSource === 'none' && r.wca === 0 && r.gs === r.tasKt)).toBe(
    true,
  );
  expect(noWinds.warnings).toEqual(
    expect.arrayContaining([
      'Block start time not set: 12:00Z assumed.',
      'Taxi-out time not set: 0 min used.',
      'Taxi-in time not set: 0 min used.',
      'No winds aloft forecast: calm wind assumed.',
    ]),
  );
  const someNull = computeNavlog(setup(route, (q) => (q.legIndex === 1 ? null : { dirDeg: 10, speedKt: 5, tempC: 0 })));
  expect(someNull.legs.map((r) => r.windMissing)).toEqual([false, true, false]);
  expect(someNull.warnings).toEqual(['DAPORI → KORINTHOS: no wind forecast; calm wind assumed.']);
  // a leg's own warning says which leg it is about (the strip shows it under that leg)
  expect(someNull.legWarnings).toEqual([
    {
      legIndex: 1,
      text: 'DAPORI → KORINTHOS: no wind forecast; calm wind assumed.',
      detail: 'no wind forecast; calm wind assumed.',
    },
  ]);
  expect(noWinds.legWarnings).toEqual([]);
  // unknown altitude: no wind lookup, flagged
  const seen: number[] = [];
  const unk = computeNavlog(
    setup(
      route,
      (q) => {
        seen.push(q.legIndex);
        return { dirDeg: 10, speedKt: 5, tempC: 0 };
      },
      { altitudesFt: [NaN, 3500, 1000] },
    ),
  );
  expect(seen.includes(0)).toBe(false);
  expect(unk.warnings[0]).toMatch(/altitude unknown/);
  expect(unk.legWarnings.map((x) => [x.legIndex, x.detail])).toEqual([[0, 'altitude unknown (enter one).']]);
  expect(unk.legs[0].altFt).toBeNaN();
});

test('crosswind above TAS: flagged, timeline at TAS', () => {
  const res = computeNavlog(setup([ad('LGTT'), ad('LGMG')], () => ({ dirDeg: 0, speedKt: 90, tempC: 0 })));
  const r = res.legs[0];
  expect(r.wca).toBeUndefined();
  expect(r.gs).toBeUndefined();
  expect(r.endMin - r.startMin).toBeCloseTo((O.haversineNm(aerodrome('LGTT')!, aerodrome('LGMG')!) / 80) * 60, 6);
  expect(res.warnings.some((w) => /crosswind exceeds TAS/.test(w))).toBe(true);
});

test('sunset at the destination from AIP GEN 2.7, else NOAA; landing after sunset warned', () => {
  const route = ROUTE();
  const withTables = computeNavlog(setup(route, null, { sunTables: SUN_TABLES }));
  expect(withTables.sunsetMin).toBe(SUN_TABLES['LGMG'].ss[sunTableIndex(DATE)]);
  const noaa = computeNavlog(setup(route, null));
  expect(noaa.sunsetMin).toBe(Math.floor(sunsetUtcMinutes(DATE, route[3].lat, route[3].lon)!));
  expect(Math.abs(noaa.sunsetMin! - withTables.sunsetMin!)).toBeLessThanOrEqual(3);
  const late = computeNavlog(setup(route, null, { sunTables: SUN_TABLES, blockOff: '14:45' }));
  expect(late.warnings.some((w) => /after sunset/.test(w))).toBe(true);
});

test('past midnight: times exceed 1440 and winds are sampled on the next day', () => {
  const times: number[] = [];
  const res = computeNavlog(
    setup(
      [ad('LGTT'), ad('LGMG')],
      (q) => {
        times.push(q.timeMs);
        return { dirDeg: 0, speedKt: 0, tempC: 0 };
      },
      { blockOff: '23:50' },
    ),
  );
  expect(res.times.takeoffMin).toBe(1445);
  expect(times.at(-1)!).toBeGreaterThan(DAY + 86400000);
});

test('compass card: expiry warning; no card → no DEV/CH; card picked by name', () => {
  const exp = computeNavlog(setup(ROUTE(), null, { date: '2028-03-01' }));
  expect(exp.warnings.some((w) => /Compass card "Magnetic compass" expired on 2028-02-05/.test(w))).toBe(true);
  const noCard = computeNavlog(setup(ROUTE(), null, { aircraft: { ...ASV, card: null } }));
  expect(noCard.legs.every((r) => r.dev === undefined && r.ch === undefined && r.mh !== undefined)).toBe(true);
  const asg = cards['SX-ASG'] as unknown as CompassCard[];
  expect(pickCompassCard(asg, 'GMU (G1000 heading)')!.name).toBe('GMU (G1000 heading)');
  expect(pickCompassCard(asg, null)!.name).toBe(asg[0].name);
  expect(pickCompassCard(asg, 'nope')!.name).toBe(asg[0].name);
  expect(pickCompassCard([], null)).toBeNull();
  const na = navlogAircraft(
    { cruiseTasKt: 92, patternTasKt: 80, fuel: { burnLph: 30, taxiAllowanceL: 4 }, compassCards: asg },
    'GMU (G1000 heading)',
  );
  expect(na).toMatchObject({
    cruiseTasKt: 92,
    patternTasKt: 80,
    burnLph: 30,
    taxiAllowanceL: 4,
    cardName: 'GMU (G1000 heading)',
    cardExpires: '2027-02-06',
  });
  // the G1000 card agrees with the independent steer transcription
  const route = ROUTE();
  const r = computeNavlog(setup(route, null, { aircraft: na }));
  const steer = [0, 30, 59, 89, 120, 150, 179, 210, 242, 271, 300, 330];
  r.legs.forEach((l) => expect(l.dev).toBe(Math.round(O.dev(steer, l.mh!))));
});

test('no burn rate: no leg fuel, warned; empty route: zero totals, no warnings', () => {
  const r = computeNavlog(setup(ROUTE(), null, { aircraft: { ...ASV, burnLph: 0 } }));
  expect(r.legs.every((l) => l.fuel === undefined)).toBe(true);
  expect(r.totals.tripFuel).toBe(0);
  expect(r.warnings).toContain('Aircraft burn rate not set: leg fuel cannot be computed.');
  const e = computeNavlog(setup([], null));
  expect(e.legs).toEqual([]);
  expect(e.totals).toEqual({ dist: 0, ete: 0, tripFuel: 0, fuel: 4 });
  expect(e.warnings).toEqual([]);
  expect(e.sunsetMin).toBeNull();
});
