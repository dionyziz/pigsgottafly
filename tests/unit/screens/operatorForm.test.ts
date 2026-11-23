// The operator page's checks (what holds its autosave back).
import { describe, expect, it } from 'vitest';

import { validateOperator } from '../../../src/features/operators/model';
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
