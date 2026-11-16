// src/shared/typedInput: typed clock times and dates (TimeField, DateField).
import { describe, expect, test } from 'vitest';

import {
  clockMinutes,
  dateProblem,
  isRealDate,
  maskDate,
  nearestSlot,
  parseDate,
  parseTime,
  timeSlots,
} from '../../../src/shared/typedInput';

describe('parseTime', () => {
  test.each([
    ['0930', '09:30'],
    ['930', '09:30'],
    ['9:30', '09:30'],
    ['09:30', '09:30'],
    ['9', '09:00'],
    ['09', '09:00'],
    ['23', '23:00'],
    ['0', '00:00'],
    ['1745', '17:45'],
    ['9.30', '09:30'],
    ['9h30', '09:30'],
    ['9:', '09:00'],
    [' 14:05 ', '14:05'],
    ['0930Z', '09:30'],
    ['', ''],
    ['  ', ''],
  ])('%j → %j', (s, v) => expect(parseTime(s)).toBe(v));

  test.each(['24', '2400', '960', '12:60', '25:00', '12345', 'abc', '9:3', '12:3x', '-1'])('%j is not a time', (s) =>
    expect(parseTime(s)).toBeNull(),
  );
});

describe('time slots', () => {
  test('every 15 minutes by default, 96 of them', () => {
    const s = timeSlots();
    expect(s).toHaveLength(96);
    expect(s.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
    expect(s.at(-1)).toBe('23:45');
    expect(timeSlots(30)).toHaveLength(48);
  });
  test('nearest slot', () => {
    const s = timeSlots();
    expect(s[nearestSlot(s, '09:30')]).toBe('09:30');
    expect(s[nearestSlot(s, '09:37')]).toBe('09:30');
    expect(s[nearestSlot(s, '09:38')]).toBe('09:45');
    expect(s[nearestSlot(s, '23:59')]).toBe('23:45');
    expect(nearestSlot(s, '')).toBe(-1);
  });
  test('clockMinutes', () => {
    expect(clockMinutes('01:30')).toBe(90);
    expect(clockMinutes('1:30')).toBeNaN();
  });
});

describe('dates', () => {
  test('isRealDate', () => {
    expect(isRealDate('2026-11-16')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-1-01')).toBe(false);
  });

  test.each([
    ['2026-11-16', '2026-11-16'],
    ['20261116', '2026-11-16'],
    ['2026/11/16', '2026-11-16'],
    ['2026.11.16', '2026-11-16'],
    ['2026-1-5', '2026-01-05'],
    [' 2026-11-16 ', '2026-11-16'],
    ['', ''],
  ])('parseDate %j → %j', (s, v) => expect(parseDate(s)).toBe(v));

  test.each(['2026-02-30', '2026-11', '2026-11-', '16/11/2026', '2026111', 'today'])('parseDate %j → null', (s) =>
    expect(parseDate(s)).toBeNull(),
  );

  test('maskDate puts the dashes in as the digits come', () => {
    const typed: string[] = [];
    let t = '';
    for (const ch of '20261116') {
      t = maskDate(t + ch);
      typed.push(t);
    }
    expect(typed).toEqual(['2', '20', '202', '2026-', '2026-1', '2026-11-', '2026-11-1', '2026-11-16']);
  });

  test('maskDate: pasted dates, extra dashes and characters', () => {
    expect(maskDate('20261116')).toBe('2026-11-16');
    expect(maskDate('2026/11/16')).toBe('2026-11-16');
    expect(maskDate('2026-1-5')).toBe('2026-01-5');
    expect(maskDate('2026-1-')).toBe('2026-01-');
    expect(maskDate('2026--')).toBe('2026-');
    expect(maskDate('2026-11-169')).toBe('2026-11-16');
    expect(maskDate('2026a')).toBe('2026-');
  });

  test('dateProblem: invalid, before min, after max', () => {
    expect(dateProblem('2026-11-16')).toBeNull();
    expect(dateProblem('')).toBeNull();
    expect(dateProblem('2026-02-30')).toBe('Not a valid date');
    expect(dateProblem('2026-11-16', '2026-12-01')).toBe('Earliest 2026-12-01');
    expect(dateProblem('2026-11-16', undefined, '2026-01-01')).toBe('Latest 2026-01-01');
  });
});
