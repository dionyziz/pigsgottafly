// src/shared/format.ts and src/shared/date.ts: the app's one set of formatters.
import { describe, expect, it } from 'vitest';
import {
  addDays, ageOn, daysBetween, fmtDate, isIsoDate, isoDay, LOCAL_TZ, localDayTime, localOffsetLabel, localToday,
  parseIsoDate, relativeDay, todayUtc, utcToLocal,
} from '../../../src/shared/date';
import {
  errorMessage, fmtAltitude, fmtClock, fmtClockMs, fmtDateTimeMs, fmtDuration, fmtEte, fmtLocalClock, fmtLocalDayTime, fmtSize, pad,
} from '../../../src/shared/format';
import { aerodromeName, aerodromePoint } from '../../../src/shared/aerodrome';
import * as calc from '../../../src/calc';
import { fmtNotamLevel, fmtNotamTime } from '../../../src/data/notams';
import { ApiRequestError } from '../../../src/data/api';

const T = (iso: string) => Date.parse(iso);

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2026-11-16')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-11-16T00:00')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(parseIsoDate('2026-01-01')).toBe(T('2026-01-01T00:00:00Z'));
    expect(fmtDate('2015-07-12')).toBe('2015-07-12');
    expect(fmtDate('2015-02-29')).toBe('');
  });
  it('UTC days', () => {
    expect(isoDay(T('2026-11-16T23:59:00Z'))).toBe('2026-11-16');
    expect(todayUtc(T('2026-11-16T23:30:00Z'))).toBe('2026-11-16');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('nope', 1)).toBe('');
  });
  it('local time is Greek time, whatever the device zone', () => {
    expect(LOCAL_TZ).toBe('Europe/Athens');
    // 22:30Z on the 16th is already the 17th in Athens (EET, UTC+2)
    expect(localToday(T('2026-11-16T22:30:00Z'))).toBe('2026-11-17');
    expect(localToday(T('2026-11-16T21:59:00Z'))).toBe('2026-11-16');
    expect(localDayTime(T('2026-07-01T09:30:00Z'))).toEqual({ day: '2026-07-01', clock: '12:30' });
    expect(utcToLocal('2026-07-01', '09:30')).toBe('12:30');
    expect(utcToLocal('2026-12-01', '09:30')).toBe('11:30');
    expect(utcToLocal('2026-12-01', '')).toBe('');
    expect(localOffsetLabel(T('2026-07-01T00:00:00Z'))).toBe('UTC+3');
    expect(localOffsetLabel(T('2026-12-01T00:00:00Z'))).toBe('UTC+2');
    expect(localOffsetLabel(NaN)).toBe('LT');
  });
  it('relative days and ages', () => {
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2);
    expect(relativeDay('2026-11-16', '2026-11-15')).toBe('Tomorrow');
    expect(relativeDay('2026-10-31', '2026-11-15')).toBe('');
    expect(ageOn('1990-11-16', '2026-11-15')).toBe(35);
    expect(ageOn('1990-11-15', '2026-11-15')).toBe(36);
    expect(ageOn('', '2026-11-15')).toBeNull();
  });
});

describe('clock times and durations', () => {
  it('pads', () => {
    expect(pad(7)).toBe('07');
    expect(pad(5, 3)).toBe('005');
  });
  it('minutes after midnight → HH:MM, wrapping, with Z and a fallback', () => {
    expect(fmtClock(570)).toBe('09:30');
    expect(fmtClock(570, { z: true })).toBe('09:30Z');
    expect(fmtClock(1440 + 5)).toBe('00:05');
    expect(fmtClock(-10)).toBe('23:50');
    expect(fmtClock(NaN)).toBe('');
    expect(fmtClock(null, { fallback: '--:--' })).toBe('--:--');
  });
  it('epoch ms → UTC clock and date-time', () => {
    const ms = T('2026-11-15T06:05:00Z');
    expect(fmtClockMs(ms)).toBe('06:05');
    expect(fmtClockMs(ms, { z: true })).toBe('06:05Z');
    expect(fmtDateTimeMs(ms)).toBe('2026-11-15 06:05Z');
    expect(fmtDateTimeMs(NaN, { fallback: '?' })).toBe('?');
    expect(fmtLocalClock(ms)).toBe('08:05');
    expect(fmtLocalDayTime(T('2026-11-16T22:30:00Z'))).toBe('2026-11-17 00:30');
  });
  it('durations read 1h44', () => {
    expect(fmtDuration(104)).toBe('1h44');
    expect(fmtDuration(10)).toBe('0h10');
    expect(fmtDuration(59.6)).toBe('1h00');
    expect(fmtDuration(null)).toBe('');
    expect(fmtDuration(-1, { fallback: '–' })).toBe('–');
  });
  it('navlog leg times read 00:10', () => {
    expect(fmtEte(10)).toBe('00:10');
    expect(fmtEte(104)).toBe('01:44');
    expect(fmtEte(0.4)).toBe('00:00');
    expect(fmtEte(1500)).toBe('25:00');
    expect(fmtEte(undefined)).toBe('');
    expect(fmtEte(-1, { fallback: '–' })).toBe('–');
  });
});

describe('altitudes, sizes, errors', () => {
  it('feet up to the transition altitude, flight levels above', () => {
    expect(fmtAltitude(3000)).toBe('3000');
    expect(fmtAltitude(6000)).toBe('6000');
    expect(fmtAltitude(6500)).toBe('FL065');
    expect(fmtAltitude(2500, { unit: true })).toBe('2500 ft');
    expect(fmtAltitude(null)).toBe('---');
  });
  it('src/calc re-exports the same functions', () => {
    expect(calc.fmtDuration).toBe(fmtDuration);
    expect(calc.fmtAltitude).toBe(fmtAltitude);
    expect(calc.fmtClock).toBe(fmtClock);
  });
  it('NOTAM levels and times use the app formats', () => {
    expect(fmtNotamLevel(6000, false)).toBe('6000 ft');
    expect(fmtNotamLevel(6500, true)).toBe('FL065');
    expect(fmtNotamLevel(0, false)).toBe('SFC');
    expect(fmtNotamLevel(99900, true)).toBe('UNL');
    expect(fmtNotamTime(T('2026-11-15T06:00:00Z'))).toBe('2026-11-15 06:00Z');
  });
  it('file sizes', () => {
    expect(fmtSize(100)).toBe('1 KB');
    expect(fmtSize(812 * 1024)).toBe('812 KB');
    expect(fmtSize(2.4 * 1048576)).toBe('2.4 MB');
  });
  it('error messages', () => {
    expect(errorMessage(new ApiRequestError(0, 'offline', null))).toBe('You are offline.');
    expect(errorMessage(new ApiRequestError(409, 'registration taken', null))).toBe('registration taken');
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
  });
});

describe('aerodrome points', () => {
  const lgtt = { id: 'LGTT', icao: 'LGTT', name: 'Tatoi', lat: 38.1, lon: 23.78 };
  const strip = { id: 'GR-0042', icao: '', name: 'Kalamaki / Megara Field', lat: 37.9, lon: 23.3 };
  it('one name rule: ICAO, else the last part of the name', () => {
    expect(aerodromeName(lgtt)).toBe('LGTT');
    expect(aerodromeName(strip)).toBe('Megara Field');
  });
  it('a route point with a fresh uid', () => {
    const a = aerodromePoint(strip), b = aerodromePoint(strip);
    expect(a).toMatchObject({ kind: 'aerodrome', refId: 'GR-0042', name: 'Megara Field', lat: 37.9, lon: 23.3 });
    expect(a.uid).not.toBe(b.uid);
  });
});
