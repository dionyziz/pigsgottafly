// Editor warnings for aerodrome hours (src/features/editor/panels/aerodromeChecks.ts): the departure
// from block-off to take-off, the destination from landing to block-on, intermediate stops and
// touch-and-goes at their times, against the AIP and NOTAM fixtures; nothing alarming without NOTAMs.
import { describe, expect, test } from 'vitest';
import type { Notam } from '../../../src/shared/briefing';
import type { RoutePoint } from '../../../src/shared/types';
import { SUN_TABLES, aerodrome } from '../../../src/data/ref';
import { aerodromeNotamEffects } from '../../../src/calc/aerodromeStatus';
import {
  aerodromeChecks,
  aerodromeWarnings,
  type AdChecksInput,
} from '../../../src/features/editor/panels/aerodromeChecks';

const ad = (id: string) => aerodrome(id)!;
const pt = (id: string, uid: string): RoutePoint => ({
  uid,
  kind: 'aerodrome',
  refId: id,
  name: id,
  lat: ad(id).lat,
  lon: ad(id).lon,
});
const day = Date.parse('2026-11-17T00:00:00Z'); // a Tuesday
const hm = (h: number, m = 0) => h * 60 + m;

function input(o: Partial<AdChecksInput> & { route: RoutePoint[] }): AdChecksInput {
  return {
    options: { aerodromeRequests: [] },
    departure: ad(o.route[0].refId!),
    destination: ad(o.route[o.route.length - 1].refId!),
    aerodromeOf: (p) => (p.kind === 'aerodrome' ? (aerodrome(p.refId) ?? null) : null),
    dayMs: day,
    times: { blockOffMin: hm(8), takeoffMin: hm(8, 10), landingMin: hm(9), blockOnMin: hm(9, 10) },
    legEndMin: [hm(8, 40), hm(9)],
    stops: [],
    effects: [],
    sunTables: SUN_TABLES,
    ...o,
  };
}
const notam = (o: Partial<Notam> & Pick<Notam, 'key' | 'itemA' | 'qcode' | 'text'>): Notam => ({
  type: 'N',
  refers: null,
  fir: 'LGGG',
  subject: null,
  condition: null,
  traffic: 'IV',
  purpose: 'NBO',
  scope: 'A',
  lowerFt: 0,
  upperFt: 99900,
  center: null,
  radiusNm: null,
  from: day,
  to: day + 86400e3,
  estimated: false,
  schedule: null,
  lowerText: null,
  upperText: null,
  raw: '',
  relevant: true,
  reasons: [],
  legIndex: null,
  ...o,
});

describe('aerodrome hours in the editor', () => {
  test('a daytime flight between HJ and H24 aerodromes: no warnings', () => {
    const c = aerodromeChecks(input({ route: [pt('LGTT', 'a'), pt('LGAV', 'b')] }));
    expect(c.map((x) => [x.role, x.aerodrome.id, x.ad.status, x.when])).toEqual([
      ['departure', 'LGTT', 'open', 'block-off 08:00Z – take-off 08:10Z'],
      ['destination', 'LGAV', 'open', 'landing 09:00Z – block-on 09:10Z'],
    ]);
    expect(aerodromeWarnings(c, 2)).toEqual([]);
  });

  test('departure closed at block-off (before sunrise at an HJ aerodrome); destination closed at landing (after sunset)', () => {
    const early = aerodromeChecks(
      input({
        route: [pt('LGTT', 'a'), pt('LGAV', 'b')],
        times: { blockOffMin: hm(3), takeoffMin: hm(3, 10), landingMin: hm(4), blockOnMin: hm(4, 10) },
      }),
    );
    const w = aerodromeWarnings(early, 2);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ level: 'danger' });
    expect(w[0].text).toMatch(
      /^Departure LGTT closed at 03:00Z \(block-off 03:00Z – take-off 03:10Z\): HJ 0\d{3}-1\d{3}Z \(AIP AD 1\.6\.5\.3\)\.$/,
    );
    const late = aerodromeChecks(
      input({
        route: [pt('LGAV', 'a'), pt('LGTT', 'b')],
        times: { blockOffMin: hm(14), takeoffMin: hm(14, 10), landingMin: hm(16), blockOnMin: hm(16, 10) },
      }),
    );
    expect(aerodromeWarnings(late, 2).map((x) => x.text)).toEqual([
      expect.stringMatching(/^Destination LGTT closed at 16:00Z \(landing 16:00Z – block-on 16:10Z\)/),
    ]);
  });

  test('HO aerodromes without NOTAMs: hours not known (info only); with the hours NOTAM: closed, citing it', () => {
    const route = [pt('LGAV', 'a'), pt('LGKC', 'b')];
    const times = { blockOffMin: hm(15), takeoffMin: hm(15, 10), landingMin: hm(16), blockOnMin: hm(16, 10) };
    expect(aerodromeWarnings(aerodromeChecks(input({ route, times })), 2)).toEqual([]);
    const effects = aerodromeNotamEffects([
      notam({ key: 'A0400/26', itemA: ['LGKC'], qcode: 'QFAAH', text: 'AD HOURS OF SERVICE: DAILY 0600-1500' }),
    ]);
    const w = aerodromeWarnings(aerodromeChecks(input({ route, times, effects })), 2);
    expect(w).toEqual([
      {
        level: 'danger',
        text: 'Destination LGKC closed at 16:00Z (landing 16:00Z – block-on 16:10Z): 0600-1500Z (NOTAM A0400/26).',
      },
    ]);
  });

  test('intermediate stops and touch-and-goes at their times', () => {
    const route = [pt('LGAV', 'a'), pt('KOLCHIKO', 'b'), pt('LGKC', 'c'), pt('LGAV', 'd')];
    const c = aerodromeChecks(
      input({
        route,
        options: { aerodromeRequests: [{ pointUid: 'c', kind: 'touch-and-go' }] },
        legEndMin: [hm(8, 50), hm(10), hm(11)],
        // Sunday 15 Nov: Kolchiko (MON-SAT 1000-1700) is closed
        dayMs: Date.parse('2026-11-15T00:00:00Z'),
        stops: [
          {
            pointIndex: 1,
            aerodrome: ad('KOLCHIKO'),
            landingMs: Date.parse('2026-11-15T08:50:00Z'),
            takeoffMs: Date.parse('2026-11-15T09:20:00Z'),
          },
        ],
        effects: aerodromeNotamEffects([
          notam({
            key: 'A0500/26',
            itemA: ['LGKC'],
            qcode: 'QFALC',
            text: 'AD CLSD',
            from: Date.parse('2026-11-15T09:30:00Z'),
            to: Date.parse('2026-11-15T10:30:00Z'),
          }),
        ]),
      }),
    );
    expect(c.map((x) => [x.role, x.aerodrome.id, x.ad.status])).toEqual([
      ['departure', 'LGAV', 'open'],
      ['stop', 'KOLCHIKO', 'closed'],
      ['touch-and-go', 'LGKC', 'closed'],
      ['destination', 'LGAV', 'open'],
    ]);
    const w = aerodromeWarnings(c, 4).map((x) => x.text);
    expect(w[0]).toBe(
      'Stop KOLCHIKO closed at 08:50Z (landing 08:50Z – take-off 09:20Z): outside MON-SAT 1000-1700 (AIP AD 1.6.34.3).',
    );
    expect(w[1]).toBe('Touch-and-go LGKC closed at 10:00Z (touch-and-go 10:00Z): AD closed (NOTAM A0500/26).');
  });

  test('no block-off time: one info, nothing checked; limits from NOTAMs are warnings', () => {
    const c = aerodromeChecks(input({ route: [pt('LGTT', 'a'), pt('LGAV', 'b')], times: undefined }));
    expect(aerodromeWarnings(c, 2)).toEqual([]);
    const effects = aerodromeNotamEffects([
      notam({
        key: 'A0600/26',
        itemA: ['LGAV'],
        qcode: 'QFAAP',
        condition: 'Available, prior permission required',
        text: 'PPR FOR GA',
      }),
    ]);
    expect(
      aerodromeWarnings(aerodromeChecks(input({ route: [pt('LGTT', 'a'), pt('LGAV', 'b')], effects })), 2),
    ).toEqual([{ level: 'warn', text: 'Destination LGAV: NOTAM A0600/26: AD available, prior permission required.' }]);
  });
});
