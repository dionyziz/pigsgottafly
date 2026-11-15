// @vitest-environment jsdom
// The editor's NumberInput commits in-range keystrokes live; an out-of-range entry must never be
// cut to its first digits (typing 60 into a max-54 field once stored 6 and W&B read 'ok').
import { afterEach, describe, expect, test } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NumberInput, parseNumberDraft } from '../../../src/features/editor/panels/ui';

afterEach(cleanup);

function Harness({ initial, min, max, log }: { initial: number | null; min?: number; max?: number; log: (number | null)[] }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <>
      <NumberInput value={v} min={min} max={max} testId="n" onCommit={(x) => { log.push(x); setV(x); }} />
      <output data-testid="stored">{v == null ? 'null' : String(v)}</output>
    </>
  );
}

/** Types `text` one character at a time, as a person would. */
function typeInto(el: HTMLInputElement, text: string) {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: '' } });
  let acc = '';
  for (const ch of text) { acc += ch; fireEvent.change(el, { target: { value: acc } }); }
}

describe('parseNumberDraft', () => {
  test('in range, out of range, bad, empty', () => {
    expect(parseNumberDraft('12,5', { min: 0, max: 54 })).toEqual({ kind: 'ok', value: 12.5 });
    expect(parseNumberDraft('60', { min: 0, max: 54 })).toEqual({ kind: 'range', value: 60, clamped: 54 });
    expect(parseNumberDraft('-3', { min: 0 })).toEqual({ kind: 'range', value: -3, clamped: 0 });
    expect(parseNumberDraft('abc', {})).toEqual({ kind: 'bad' });
    expect(parseNumberDraft(' ', {})).toEqual({ kind: 'ok', value: null });
    expect(parseNumberDraft('', { allowEmpty: false })).toEqual({ kind: 'bad' });
  });
});

describe('NumberInput', () => {
  test('an in-range value commits live and stays after blur', () => {
    const log: (number | null)[] = [];
    const r = render(<Harness initial={null} min={0} max={500} log={log} />);
    const el = r.getByTestId('n') as HTMLInputElement;
    typeInto(el, '60');
    expect(r.getByTestId('stored').textContent).toBe('60');
    fireEvent.blur(el);
    expect(el.value).toBe('60');
    expect(r.getByTestId('stored').textContent).toBe('60');
  });

  test('above max: flagged while typing, clamped (not truncated) on blur', () => {
    const log: (number | null)[] = [];
    const r = render(<Harness initial={15} min={0} max={180} log={log} />);
    const el = r.getByTestId('n') as HTMLInputElement;
    typeInto(el, '200');
    expect(el.value).toBe('200');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.title).toBe('Max 180');
    fireEvent.blur(el);
    expect(el.value).toBe('180');
    expect(r.getByTestId('stored').textContent).toBe('180');
    expect(el.getAttribute('aria-invalid')).toBeNull();
  });

  test('Enter settles an out-of-range draft too', () => {
    const log: (number | null)[] = [];
    const r = render(<Harness initial={10} min={0} max={54} log={log} />);
    const el = r.getByTestId('n') as HTMLInputElement;
    typeInto(el, '60');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(r.getByTestId('stored').textContent).toBe('54');
    expect(el.value).toBe('54');
  });

  test('an unparseable draft reverts to the stored value on blur', () => {
    const log: (number | null)[] = [];
    const r = render(<Harness initial={42} log={log} />);
    const el = r.getByTestId('n') as HTMLInputElement;
    typeInto(el, '4x');
    fireEvent.blur(el);
    expect(el.value).toBe('4');
    expect(r.getByTestId('stored').textContent).toBe('4');
  });
});
