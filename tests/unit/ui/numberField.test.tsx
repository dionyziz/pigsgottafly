// @vitest-environment jsdom
// src/ui/NumberField: live commits, clamp on blur with the limit shown, revert of garbage, empty
// handling (optional, emptyValue, zeroAsEmpty), integer, and the two old shims on top of it.
import { afterEach, describe, expect, test } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NumberField, type NumberFieldProps } from '../../../src/ui';
import { NumInput, parseNum } from '../../../src/features/hangar/fields';

afterEach(cleanup);

function Harness({ initial, log, ...p }: Omit<NumberFieldProps, 'value' | 'onChange'> & { initial: number | null; log: (number | null)[] }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <>
      <NumberField {...p} value={v} testId="n" onChange={(x) => { log.push(x); setV(x); }} />
      <output data-testid="stored">{v == null ? 'null' : String(v)}</output>
    </>
  );
}

function typeInto(el: HTMLInputElement, text: string) {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: '' } });
  let acc = '';
  for (const ch of text) { acc += ch; fireEvent.change(el, { target: { value: acc } }); }
}

const setup = (p: Omit<NumberFieldProps, 'value' | 'onChange'> & { initial: number | null }) => {
  const log: (number | null)[] = [];
  const r = render(<Harness {...p} log={log} />);
  return { r, log, el: r.getByTestId('n') as HTMLInputElement, stored: () => r.getByTestId('stored').textContent };
};

describe('NumberField', () => {
  test('commits each valid keystroke', () => {
    const { el, log, stored } = setup({ initial: null, max: 500 });
    typeInto(el, '123');
    expect(log).toEqual([1, 12, 123]);
    expect(stored()).toBe('123');
  });

  test('over the limit: red, limit shown while focused, clamped on blur', () => {
    const { r, el, stored } = setup({ initial: 15, min: 0, max: 180 });
    typeInto(el, '400');
    expect(el.value).toBe('400');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.className).toContain('invalid');
    expect(r.container.querySelector('.numfield-msg')?.textContent).toBe('Max 180');
    fireEvent.blur(el);
    expect(el.value).toBe('180');
    expect(stored()).toBe('180');
    expect(r.container.querySelector('.numfield-msg')).toBeNull();
    expect(el.getAttribute('aria-invalid')).toBeNull();
  });

  test('under the minimum clamps up; Enter settles too', () => {
    const { el, stored } = setup({ initial: 50, min: 10, max: 100 });
    typeInto(el, '−5');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(stored()).toBe('10');
    expect(el.value).toBe('10');
  });

  test('garbage reverts to the stored value', () => {
    const { el, stored } = setup({ initial: 42 });
    typeInto(el, '4x');
    fireEvent.blur(el);
    expect(el.value).toBe('4');
    expect(stored()).toBe('4');
  });

  test('blank: optional commits null; emptyValue commits it; otherwise reverts', () => {
    let s = setup({ initial: 7 });
    typeInto(s.el, '');
    expect(s.stored()).toBe('null');
    cleanup();
    s = setup({ initial: 7, optional: false, emptyValue: 0 });
    typeInto(s.el, '');
    expect(s.stored()).toBe('0');
    fireEvent.blur(s.el);
    expect(s.el.value).toBe('0');
    cleanup();
    s = setup({ initial: 7, optional: false });
    typeInto(s.el, '');
    expect(s.r.container.querySelector('.numfield-msg')?.textContent).toBe('Required');
    fireEvent.blur(s.el);
    expect(s.stored()).toBe('7');
    expect(s.el.value).toBe('7');
  });

  test('zeroAsEmpty shows 0 as an empty field', () => {
    const { el, stored } = setup({ initial: 0, optional: false, emptyValue: 0, zeroAsEmpty: true, placeholder: 'none' });
    expect(el.value).toBe('');
    typeInto(el, '');
    fireEvent.blur(el);
    expect(el.value).toBe('');
    expect(stored()).toBe('0');
  });

  test('integer rejects a fraction and reverts', () => {
    const { el, stored } = setup({ initial: 3, integer: true });
    typeInto(el, '2.5');
    expect(stored()).toBe('2');
    fireEvent.blur(el);
    expect(el.value).toBe('2');
  });

  test('focus and blur alone never change the value (decimals)', () => {
    const { el, log } = setup({ initial: 12.3456, decimals: 1 });
    expect(el.value).toBe('12.3');
    fireEvent.focus(el);
    fireEvent.blur(el);
    expect(log).toEqual([]);
  });

  test('a unit is drawn inside', () => {
    const { r } = setup({ initial: 5, unit: 'kg' });
    expect(r.container.querySelector('.numfield.unit-input > span')?.textContent).toBe('kg');
  });
});

describe('hangar NumInput shim', () => {
  function H({ log, ...p }: { log: (number | null)[]; optional?: boolean; max?: number }) {
    const [v, setV] = useState<number | null>(5);
    return <><NumInput {...p} value={v} ariaLabel="x" onChange={(x) => { log.push(x); setV(x); }} /><output data-testid="s">{String(v)}</output></>;
  }
  test('empty commits 0 unless optional; over the max clamps', () => {
    const log: (number | null)[] = [];
    const r = render(<H log={log} max={10} />);
    const el = r.getByLabelText('x') as HTMLInputElement;
    typeInto(el, '');
    expect(r.getByTestId('s').textContent).toBe('0');
    typeInto(el, '60');
    fireEvent.blur(el);
    expect(r.getByTestId('s').textContent).toBe('10');
    cleanup();
    const r2 = render(<H log={[]} optional />);
    const el2 = r2.getByLabelText('x') as HTMLInputElement;
    expect(el2.placeholder).toBe('—');
    typeInto(el2, '');
    expect(r2.getByTestId('s').textContent).toBe('null');
  });
  test('parseNum is parseDecimal', () => {
    expect(parseNum('1,5')).toBe(1.5);
    expect(parseNum('')).toBeNull();
    expect(parseNum('x')).toBeNaN();
  });
});
