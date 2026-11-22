// Greek summer time starts and ends at 01:00Z on the last Sunday of March and October: each UTC time
// converts at its own instant, so the plan and the day it was made in another season never mix.
import { describe, expect, test } from 'vitest';

import { isSummerTime } from '../../../src/calc/adHours';
import { splitFlights } from '../../../src/features/lobby/format';
import type { FlightListItem } from '../../../src/shared';
import {
  localDayMark,
  localDepartureDay,
  localOffsetLabel,
  parseIsoDate,
  utcToLocal,
  utcToLocalMarked,
} from '../../../src/shared/date';

const at = (d: string, hhmm: string) => parseIsoDate(d)! + (+hhmm.slice(0, 2) * 60 + +hhmm.slice(3)) * 60000;

describe('UTC → Greek local time around the clock changes', () => {
  test('summer time ends 2026-10-25 01:00Z: the hour 03:00–04:00 local happens twice', () => {
    expect(['00:00', '00:45', '01:00', '01:15', '08:00'].map((h) => utcToLocal('2026-10-25', h))).toEqual([
      '03:00',
      '03:45',
      '03:00',
      '03:15',
      '10:00',
    ]);
    expect(localOffsetLabel(at('2026-10-25', '00:30'))).toBe('UTC+3');
    expect(localOffsetLabel(at('2026-10-25', '08:00'))).toBe('UTC+2');
  });

  test('summer time starts 2027-03-28 01:00Z: 03:00–04:00 local never happens', () => {
    expect(['00:45', '01:00', '08:00'].map((h) => utcToLocal('2027-03-28', h))).toEqual(['02:45', '04:00', '11:00']);
    expect(localOffsetLabel(at('2027-03-28', '00:30'))).toBe('UTC+2');
    expect(localOffsetLabel(at('2027-03-28', '08:00'))).toBe('UTC+3');
  });

  test('a flight planned in winter for a summer date gets summer time (and summer aerodrome hours)', () => {
    // planned on 2026-12-01 for 2027-06-15: the conversion depends on the flight's date only
    expect(utcToLocal('2027-06-15', '08:00')).toBe('11:00');
    expect(isSummerTime(at('2027-06-15', '08:00'))).toBe(true);
    expect(isSummerTime(at('2026-12-01', '08:00'))).toBe(false);
    // the switch instants agree with Greek time
    expect(isSummerTime(at('2026-10-25', '00:59'))).toBe(true);
    expect(isSummerTime(at('2026-10-25', '01:00'))).toBe(false);
    expect(isSummerTime(at('2027-03-28', '00:59'))).toBe(false);
    expect(isSummerTime(at('2027-03-28', '01:00'))).toBe(true);
  });

  test('a local time on another day than the UTC date is marked', () => {
    expect(utcToLocalMarked('2026-07-01', '22:30')).toBe('01:30+1');
    expect(utcToLocalMarked('2026-07-01', '20:30')).toBe('23:30');
    expect(utcToLocalMarked('2026-12-01', '22:30')).toBe('00:30+1');
    expect(utcToLocalMarked('2026-12-01', '21:30')).toBe('23:30');
    expect(localDayMark('2026-07-01', at('2026-07-01', '09:00'))).toBe('');
  });

  test('the local day a flight leaves on', () => {
    expect(localDepartureDay('2026-07-01', '22:30')).toBe('2026-07-02');
    expect(localDepartureDay('2026-07-01', '09:00')).toBe('2026-07-01');
    expect(localDepartureDay('2026-07-01', '')).toBe('2026-07-01');
  });
});

describe('flights list: today is a UTC date, like the flights', () => {
  const flight = (date: string): FlightListItem =>
    ({ id: date, date, updated: 0, summary: { blockOff: '08:00' } }) as unknown as FlightListItem;
  test('at 01:30 local on 2 July (22:30Z on 1 July), flights dated 1 July are still upcoming', () => {
    const { upcoming, past } = splitFlights([flight('2026-07-01'), flight('2026-06-30')], '2026-07-01');
    expect(upcoming.map((f) => f.date)).toEqual(['2026-07-01']);
    expect(past.map((f) => f.date)).toEqual(['2026-06-30']);
  });
});
