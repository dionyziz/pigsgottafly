// When a time-limited area is in force and active (src/shared/areaTime.ts), UTC throughout.
import { describe, expect, test } from 'vitest';

import {
  activeWindows,
  areaInForce,
  areasInForce,
  areaTimeRows,
  fmtAipDay,
  fmtDatedWindow,
  fmtWindow,
  fmtWindows,
} from '../../../src/shared/areaTime';
import type { AreaWindow, RefArea } from '../../../src/shared/ref';

const T = (s: string) => Date.parse(s);
const W = (from: string, to: string): AreaWindow => ({ from, to });

// SUP 39/26 LGD4SW on its last two days, and a window past midnight
const EXERCISE = {
  validFrom: '2026-10-15',
  validUntil: '2026-11-27',
  windows: [
    W('2026-11-26T08:30Z', '2026-11-26T10:30Z'),
    W('2026-11-26T23:00Z', '2026-11-27T01:00Z'),
    W('2026-11-27T08:00Z', '2026-11-27T10:00Z'),
  ],
};
// SUP 07/26 LGD102A: in force for a year, activated by the EAUP/EUUP (no dated windows)
const LGD102A = { validFrom: '2026-06-11', validUntil: '2027-06-09' };

describe('in force on a day', () => {
  test('from the first day to the last, both included; no dates: always', () => {
    expect(areaInForce(LGD102A, '2026-06-10')).toBe(false);
    expect(areaInForce(LGD102A, '2026-06-11')).toBe(true);
    expect(areaInForce(LGD102A, '2027-06-09')).toBe(true);
    expect(areaInForce(LGD102A, '2027-06-10')).toBe(false);
    expect(areaInForce({ validFrom: '2024-08-08' }, '2030-01-01')).toBe(true);
    expect(areaInForce({}, '1999-01-01')).toBe(true);
  });
  test('an expired area drops out, the others stay', () => {
    const areas: Pick<RefArea, 'id' | 'validFrom' | 'validUntil' | 'windows'>[] = [
      { id: 'ENR' },
      { id: 'JFC', ...EXERCISE },
      { id: 'D102', ...LGD102A },
    ];
    expect(areasInForce(areas, '2026-11-27').map((a) => a.id)).toEqual(['ENR', 'JFC', 'D102']);
    expect(areasInForce(areas, '2026-11-28').map((a) => a.id)).toEqual(['ENR', 'D102']);
    expect(areasInForce(areas, '2027-06-10').map((a) => a.id)).toEqual(['ENR']);
  });
});

describe('active while a leg is flown', () => {
  test('no windows: active whenever in force, to the last second of the last day', () => {
    expect(activeWindows(LGD102A, T('2026-11-23T12:00Z'), T('2026-11-23T12:30Z'))).toEqual([]);
    expect(activeWindows(LGD102A, T('2027-06-09T23:50Z'), T('2027-06-10T00:20Z'))).toEqual([]);
    expect(activeWindows(LGD102A, T('2027-06-10T00:00Z'), T('2027-06-10T00:30Z'))).toBeNull();
    expect(activeWindows(LGD102A, T('2026-06-10T23:30Z'), T('2026-06-10T23:59Z'))).toBeNull();
    expect(activeWindows(LGD102A, T('2026-06-10T23:30Z'), T('2026-06-11T00:00Z'))).toEqual([]);
    expect(activeWindows({}, T('2000-01-01T00:00Z'), T('2000-01-01T01:00Z'))).toEqual([]);
  });
  test('windows: only a leg that overlaps one, which is returned', () => {
    const [w1, , w3] = EXERCISE.windows;
    expect(activeWindows(EXERCISE, T('2026-11-26T09:00Z'), T('2026-11-26T09:20Z'))).toEqual([w1]);
    expect(activeWindows(EXERCISE, T('2026-11-26T11:00Z'), T('2026-11-26T12:00Z'))).toBeNull();
    // a leg around a whole window, and one spanning two
    expect(activeWindows(EXERCISE, T('2026-11-27T07:00Z'), T('2026-11-27T11:00Z'))).toEqual([w3]);
    expect(activeWindows(EXERCISE, T('2026-11-26T10:00Z'), T('2026-11-27T09:00Z'))).toHaveLength(3);
  });
  test('UTC edges: a window holds from its start up to its end', () => {
    const [w1] = EXERCISE.windows;
    // ending as the window starts: at that instant the area is active
    expect(activeWindows(EXERCISE, T('2026-11-26T08:00Z'), T('2026-11-26T08:30Z'))).toEqual([w1]);
    expect(activeWindows(EXERCISE, T('2026-11-26T08:00Z'), T('2026-11-26T08:29Z'))).toBeNull();
    // starting as it ends: clear
    expect(activeWindows(EXERCISE, T('2026-11-26T10:30Z'), T('2026-11-26T11:00Z'))).toBeNull();
    expect(activeWindows(EXERCISE, T('2026-11-26T10:29Z'), T('2026-11-26T11:00Z'))).toEqual([w1]);
  });
  test('a window past midnight is active on both days', () => {
    const [, w2] = EXERCISE.windows;
    expect(activeWindows(EXERCISE, T('2026-11-26T23:30Z'), T('2026-11-26T23:50Z'))).toEqual([w2]);
    expect(activeWindows(EXERCISE, T('2026-11-27T00:10Z'), T('2026-11-27T00:40Z'))).toEqual([w2]);
    expect(activeWindows(EXERCISE, T('2026-11-27T01:00Z'), T('2026-11-27T02:00Z'))).toBeNull();
  });
  test('a window is not active outside the area’s days, nor a leg of no time', () => {
    const outside = { ...EXERCISE, validUntil: '2026-11-26' };
    expect(activeWindows(outside, T('2026-11-27T08:00Z'), T('2026-11-27T09:00Z'))).toBeNull();
    expect(activeWindows(EXERCISE, NaN, NaN)).toBeNull();
    expect(activeWindows(EXERCISE, T('2026-11-26T09:00Z'), T('2026-11-26T08:00Z'))).toBeNull();
  });
});

describe('as the details box shows them', () => {
  test('dates and windows', () => {
    expect(fmtAipDay('2026-11-27')).toBe('27 NOV 2026');
    expect(fmtWindow(W('2026-11-23T11:30Z', '2026-11-23T13:30Z'))).toBe('1130–1330');
    expect(fmtWindow(W('2026-12-31T23:00Z', '2027-01-01T00:00Z'))).toBe('2300–2400');
    expect(fmtWindow(W('2026-11-26T23:00Z', '2026-11-27T01:00Z'))).toBe('2300 – 27 NOV 0100');
    expect(fmtDatedWindow(W('2026-11-23T11:30Z', '2026-11-23T13:30Z'))).toBe('23 NOV 1130–1330');
  });
  test('a line per day from the day on, as the SUP prints them, the rest counted', () => {
    const ws = [
      W('2026-11-17T11:30Z', '2026-11-17T13:30Z'),
      W('2026-11-17T16:00Z', '2026-11-17T18:00Z'),
      W('2026-11-18T08:30Z', '2026-11-18T10:30Z'),
    ];
    expect(fmtWindows(ws, '2026-11-17')).toEqual(['17 NOV 1130–1330 & 1600–1800', '18 NOV 0830–1030']);
    expect(fmtWindows(ws, '2026-11-18')).toEqual(['18 NOV 0830–1030']);
    expect(fmtWindows(ws, '2026-11-19')).toEqual([]);
    expect(fmtWindows(ws, '2026-11-17', 1)).toEqual(['17 NOV 1130–1330 & 1600–1800', '+1 more days']);
    // a window past midnight still shows on its second day
    expect(fmtWindows(EXERCISE.windows, '2026-11-27')).toEqual(['26 NOV 2300 – 27 NOV 0100', '27 NOV 0800–1000']);
  });
  test('rows: valid until, and the windows left', () => {
    expect(areaTimeRows(EXERCISE, '2026-11-27')).toEqual([
      { label: 'Valid', text: 'until 27 NOV 2026' },
      { label: 'Windows (UTC)', text: '26 NOV 2300 – 27 NOV 0100\n27 NOV 0800–1000' },
    ]);
    expect(areaTimeRows(LGD102A, '2026-11-23')).toEqual([{ label: 'Valid', text: 'until 09 JUN 2027' }]);
    expect(areaTimeRows({ validFrom: '2024-08-08' }, '2026-11-23')).toEqual([]);
    expect(areaTimeRows({ windows: [] }, '2026-11-23')).toEqual([{ label: 'Windows (UTC)', text: 'None left' }]);
  });
});
