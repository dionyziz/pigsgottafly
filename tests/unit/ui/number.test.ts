// src/shared/number.ts (parsing of typed numbers) and src/shared/list.ts (moveAt).
import { describe, expect, test } from 'vitest';
import { moveAt, parseDecimal, parseNumber } from '../../../src/shared';

describe('parseDecimal', () => {
  test('blank is null', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
  });
  test('decimal comma, signs, U+2212 minus, exponent', () => {
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal(' 7 ')).toBe(7);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal('5.')).toBe(5);
    expect(parseDecimal('-3')).toBe(-3);
    expect(parseDecimal('+3')).toBe(3);
    expect(parseDecimal('−2.5')).toBe(-2.5);
    expect(parseDecimal('1e3')).toBe(1000);
    expect(parseDecimal('2.5E-1')).toBe(0.25);
  });
  test('garbage is NaN', () => {
    for (const s of ['4x', 'abc', '1.2.3', 'Infinity', '0x10', '-', '1e', '1,2,3', '--1'])
      expect(parseDecimal(s)).toBeNaN();
  });
});

describe('parseNumber', () => {
  test('in range, out of range with the limit, bad, empty', () => {
    expect(parseNumber('12,5', { min: 0, max: 54 })).toEqual({ kind: 'ok', value: 12.5 });
    expect(parseNumber('60', { min: 0, max: 54 })).toEqual({
      kind: 'range',
      value: 60,
      clamped: 54,
      message: 'Max 54',
    });
    expect(parseNumber('-3', { min: 0 })).toEqual({ kind: 'range', value: -3, clamped: 0, message: 'Min 0' });
    expect(parseNumber('−3', { min: 0 })).toMatchObject({ kind: 'range', clamped: 0 });
    expect(parseNumber('abc')).toEqual({ kind: 'bad', message: 'Not a number' });
    expect(parseNumber(' ')).toEqual({ kind: 'ok', value: null });
    expect(parseNumber('', { allowEmpty: false })).toEqual({ kind: 'bad', message: 'Required' });
  });
  test('integer', () => {
    expect(parseNumber('3', { integer: true })).toEqual({ kind: 'ok', value: 3 });
    expect(parseNumber('3.5', { integer: true })).toEqual({ kind: 'bad', message: 'Whole number' });
    expect(parseNumber('1e2', { integer: true, max: 50 })).toMatchObject({ kind: 'range', clamped: 50 });
  });
  test('zero is a value, not empty', () => {
    expect(parseNumber('0', { allowEmpty: false })).toEqual({ kind: 'ok', value: 0 });
  });
});

describe('moveAt', () => {
  const l = ['a', 'b', 'c', 'd'];
  test('moves down and up', () => {
    expect(moveAt(l, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveAt(l, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveAt(l, 1, 2)).toEqual(['a', 'c', 'b', 'd']);
  });
  test('clamps the target, ignores a bad source, never mutates', () => {
    expect(moveAt(l, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveAt(l, 2, -5)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveAt(l, 7, 0)).toEqual(l);
    expect(moveAt(l, 2, 2)).toEqual(l);
    expect(moveAt(l, 2, 2)).not.toBe(l);
    expect(l).toEqual(['a', 'b', 'c', 'd']);
  });
});
