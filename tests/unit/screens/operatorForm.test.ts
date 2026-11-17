// The operator page's checks (what holds its autosave back) and where the first-use profile form goes
// on to (?next=, e.g. the aircraft a share e-mail links to).
import { describe, expect, it } from 'vitest';

import { validateOperator } from '../../../src/features/operators/OperatorPage';
import { nextPath } from '../../../src/features/profile/ProfilePage';
import { EMPTY_OPERATOR } from '../../../src/shared/operators';

describe('operator form', () => {
  const ok = { ...EMPTY_OPERATOR, name: 'Aero Club' };
  it('a named operator can be saved', () => {
    expect(validateOperator(ok)).toEqual([]);
  });
  it('says what is wrong, field by field', () => {
    expect(validateOperator({ ...ok, name: '  ' }).map((i) => i.field)).toEqual(['name']);
    expect(validateOperator({ ...ok, email: 'ops@' })).toEqual([{ field: 'email', message: 'Not an e-mail address' }]);
    expect(validateOperator({ ...ok, requiresWbPerf: true })).toEqual([
      { field: 'declarationsEmail', message: 'Enter the e-mail address' },
    ]);
    expect(validateOperator({ ...ok, requiresWbPerf: true, declarationsEmail: 'x' })).toEqual([
      { field: 'declarationsEmail', message: 'Not an e-mail address' },
    ]);
    // the address only matters when the sheets are asked for
    expect(validateOperator({ ...ok, requiresWbPerf: false, declarationsEmail: 'x' })).toEqual([]);
  });
});

describe('after the first-use profile', () => {
  it('goes on to an in-app page, else home', () => {
    expect(nextPath('/hangar/ac_1')).toBe('/hangar/ac_1');
    expect(nextPath('/operators/op_1?x=1')).toBe('/operators/op_1?x=1');
    expect(nextPath(null)).toBe('/');
    expect(nextPath('')).toBe('/');
    expect(nextPath('//evil.example')).toBe('/');
    expect(nextPath('https://evil.example')).toBe('/');
    expect(nextPath('/profile?welcome=1')).toBe('/');
  });
});
