// @vitest-environment jsdom
// src/ui/TimeField (typed or picked from the 15-minute list) and src/ui/DateField (dashes as typed,
// paste, validation, min/max, the month calendar).
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';

import { DateField, type DateFieldProps, Dialog, TimeField, type TimeFieldProps } from '../../../src/ui';

afterEach(cleanup);

function TimeHarness({
  initial,
  log,
  ...p
}: Omit<TimeFieldProps, 'value' | 'onChange'> & { initial: string; log: string[] }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <label>
        Block-off
        <TimeField
          {...p}
          value={v}
          testId="t"
          onChange={(x) => {
            log.push(x);
            setV(x);
          }}
        />
      </label>
      <output data-testid="stored">{v}</output>
    </>
  );
}

const setupTime = (p: Omit<TimeFieldProps, 'value' | 'onChange'> & { initial?: string } = {}) => {
  const log: string[] = [];
  const r = render(<TimeHarness initial="" {...p} log={log} />);
  const el = r.getByTestId('t') as HTMLInputElement;
  return {
    r,
    log,
    el,
    stored: () => r.getByTestId('stored').textContent,
    list: () => r.queryByRole('listbox'),
    active: () => r.queryByRole('listbox')?.querySelector('[aria-selected=true]')?.textContent ?? null,
  };
};

function typeInto(el: HTMLInputElement, text: string) {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: '' } });
  let acc = '';
  for (const ch of text) {
    acc += ch;
    fireEvent.change(el, { target: { value: acc, selectionStart: acc.length } });
  }
}

describe('TimeField', () => {
  test.each([
    ['0930', '09:30'],
    ['930', '09:30'],
    ['9:30', '09:30'],
    ['09:30', '09:30'],
    ['9', '09:00'],
  ])('typed %j → %j on blur', (typed, want) => {
    const { el, stored } = setupTime();
    typeInto(el, typed);
    fireEvent.blur(el);
    expect(stored()).toBe(want);
    expect(el.value).toBe(want);
    expect(el.getAttribute('aria-invalid')).toBeNull();
  });

  test('Enter normalises what was typed', () => {
    const { el, stored, list } = setupTime();
    typeInto(el, '1745');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(stored()).toBe('17:45');
    expect(el.value).toBe('17:45');
    expect(list()).toBeNull();
  });

  test('a complete time is committed as typed; shorter digits wait for blur', () => {
    const { el, log } = setupTime();
    typeInto(el, '93');
    expect(log).toEqual([]);
    typeInto(el, '09:30');
    expect(log).toEqual(['09:30']);
  });

  test('invalid text stays, red, and the value is kept', () => {
    const { el, stored, log } = setupTime({ initial: '08:00' });
    typeInto(el, '2575');
    fireEvent.blur(el);
    expect(el.value).toBe('2575');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.className).toContain('invalid');
    expect(stored()).toBe('08:00');
    expect(log).toEqual([]);
  });

  test('clearing the field clears the value', () => {
    const { el, stored } = setupTime({ initial: '08:00' });
    typeInto(el, '');
    fireEvent.blur(el);
    expect(stored()).toBe('');
  });

  test('focus opens the listbox of 15-minute times at the value', () => {
    const { el, list, active } = setupTime({ initial: '10:15' });
    expect(list()).toBeNull();
    fireEvent.focus(el);
    const lb = list()!;
    expect(lb).not.toBeNull();
    expect(lb.querySelectorAll('[role=option]')).toHaveLength(96);
    expect(el.getAttribute('role')).toBe('combobox');
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(el.getAttribute('aria-controls')).toBe(lb.id);
    expect(el.getAttribute('inputmode')).toBe('numeric');
    expect(active()).toBe('10:15');
    expect(el.getAttribute('aria-activedescendant')).toBe(lb.querySelector('[aria-selected=true]')!.id);
  });

  test('a value between slots highlights the nearest one', () => {
    const { el, active } = setupTime({ initial: '10:22' });
    fireEvent.focus(el);
    expect(active()).toBe('10:15');
  });

  test('typing moves the highlight', () => {
    const { el, active } = setupTime();
    typeInto(el, '14');
    expect(active()).toBe('14:00');
    typeInto(el, '1440');
    expect(active()).toBe('14:45');
  });

  test('arrows move through the list, Enter picks', () => {
    const { el, active, stored, list } = setupTime({ initial: '10:00' });
    fireEvent.focus(el);
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(active()).toBe('10:30');
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    expect(active()).toBe('10:15');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(stored()).toBe('10:15');
    expect(el.value).toBe('10:15');
    expect(list()).toBeNull();
  });

  test('ArrowUp from the first time wraps to the last', () => {
    const { el, active } = setupTime({ initial: '00:00' });
    fireEvent.focus(el);
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    expect(active()).toBe('23:45');
  });

  test('Enter after typing takes the typed time, not the nearest slot', () => {
    const { el, stored } = setupTime();
    typeInto(el, '937');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(stored()).toBe('09:37');
  });

  test('a click on a time picks it and closes the list', () => {
    const { r, el, stored, list } = setupTime();
    fireEvent.focus(el);
    fireEvent.mouseDown(r.getByRole('option', { name: '13:45' }));
    expect(stored()).toBe('13:45');
    expect(list()).toBeNull();
    // a click on the input opens it again
    fireEvent.click(el);
    expect(list()).not.toBeNull();
  });

  test('Escape closes the list, without closing the dialog around it', () => {
    let closed = 0;
    const r = render(
      <Dialog title="T" onClose={() => closed++}>
        <TimeField value="" onChange={() => {}} ariaLabel="Time" testId="t" />
      </Dialog>,
    );
    const el = r.getByTestId('t');
    fireEvent.focus(el);
    expect(r.queryByRole('listbox')).not.toBeNull();
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(r.queryByRole('listbox')).toBeNull();
    expect(closed).toBe(0);
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(closed).toBe(1);
  });

  test('option notes (local time beside UTC)', () => {
    const { r, el } = setupTime({ optionNote: (s) => `${s}LT` });
    fireEvent.focus(el);
    expect(r.getByRole('option', { name: /^09:30/ }).textContent).toBe('09:3009:30LT');
  });

  test('a new value from outside replaces the text', () => {
    const r = render(<TimeField value="08:00" onChange={() => {}} testId="t" />);
    r.rerender(<TimeField value="09:15" onChange={() => {}} testId="t" />);
    expect((r.getByTestId('t') as HTMLInputElement).value).toBe('09:15');
  });
});

function DateHarness({
  initial,
  log,
  ...p
}: Omit<DateFieldProps, 'value' | 'onChange'> & { initial: string; log: string[] }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <label>
        Date
        <DateField
          {...p}
          value={v}
          testId="d"
          onChange={(x) => {
            log.push(x);
            setV(x);
          }}
        />
      </label>
      <output data-testid="stored">{v}</output>
    </>
  );
}

const setupDate = (p: Omit<DateFieldProps, 'value' | 'onChange'> & { initial?: string } = {}) => {
  const log: string[] = [];
  const r = render(<DateHarness initial="" {...p} log={log} />);
  const el = r.getByTestId('d') as HTMLInputElement;
  return { r, log, el, stored: () => r.getByTestId('stored').textContent };
};

/** Types at the end, one character at a time, as a keyboard would. */
function typeDate(el: HTMLInputElement, text: string) {
  for (const ch of text) {
    const v = el.value + ch;
    el.setSelectionRange?.(el.value.length, el.value.length);
    fireEvent.change(el, { target: { value: v } });
  }
}

describe('DateField', () => {
  test('dashes go in as the digits are typed, the date commits when complete', () => {
    const { el, log } = setupDate();
    fireEvent.focus(el);
    const seen: string[] = [];
    for (const ch of '20261116') {
      typeDate(el, ch);
      seen.push(el.value);
    }
    expect(seen).toEqual(['2', '20', '202', '2026-', '2026-1', '2026-11-', '2026-11-1', '2026-11-16']);
    expect(log).toEqual(['2026-11-16']);
    expect(el.getAttribute('inputmode')).toBe('numeric');
  });

  test('typing the dashes yourself works too', () => {
    const { el, stored } = setupDate();
    fireEvent.focus(el);
    typeDate(el, '2026-11-16');
    expect(el.value).toBe('2026-11-16');
    expect(stored()).toBe('2026-11-16');
  });

  test('backspace over a dash removes it', () => {
    const { el } = setupDate();
    fireEvent.focus(el);
    typeDate(el, '202611');
    expect(el.value).toBe('2026-11-');
    fireEvent.change(el, { target: { value: '2026-11' } });
    expect(el.value).toBe('2026-11');
    fireEvent.change(el, { target: { value: '2026-1' } });
    expect(el.value).toBe('2026-1');
  });

  test.each([
    ['2026-11-16', '2026-11-16'],
    ['20261116', '2026-11-16'],
    ['2026/11/16', '2026-11-16'],
  ])('pasted %j → %j', (pasted, want) => {
    const { el, stored } = setupDate();
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: pasted } });
    expect(el.value).toBe(want);
    expect(stored()).toBe(want);
  });

  test('not a real date: red on blur, value kept', () => {
    const { el, stored, log } = setupDate({ initial: '2026-01-01' });
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: '2026-02-30' } });
    expect(el.getAttribute('aria-invalid')).toBeNull();
    fireEvent.blur(el);
    expect(el.value).toBe('2026-02-30');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.className).toContain('invalid');
    expect(stored()).toBe('2026-01-01');
    expect(log).toEqual([]);
  });

  test('incomplete date: red on Enter', () => {
    const { el } = setupDate();
    fireEvent.focus(el);
    typeDate(el, '202611');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(el.getAttribute('aria-invalid')).toBe('true');
  });

  test('outside min / max is not accepted', () => {
    const { el, stored } = setupDate({ min: '2026-01-01', max: '2026-12-31' });
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: '2027-01-05' } });
    fireEvent.blur(el);
    expect(stored()).toBe('');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.title).toBe('Latest 2026-12-31');
  });

  test('cleared: the value is cleared', () => {
    const { el, stored } = setupDate({ initial: '2026-01-01' });
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: '' } });
    fireEvent.blur(el);
    expect(stored()).toBe('');
  });

  test('the calendar picks a day', () => {
    const { r, stored } = setupDate({ initial: '2026-11-16' });
    fireEvent.click(r.getByRole('button', { name: 'Choose a date' }));
    const dlg = r.getByRole('dialog');
    expect(dlg.textContent).toContain('November 2026');
    expect(r.getByRole('button', { name: '2026-11-16' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(r.getByRole('button', { name: '2026-11-20' }));
    expect(stored()).toBe('2026-11-20');
    expect(r.queryByRole('dialog')).toBeNull();
  });

  test('calendar keys: arrows move the day, PageDown the month, Escape closes', () => {
    const { r, stored } = setupDate({ initial: '2026-11-16' });
    fireEvent.click(r.getByRole('button', { name: 'Choose a date' }));
    const dlg = r.getByRole('dialog');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('2026-11-16');
    fireEvent.keyDown(dlg, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('2026-11-17');
    fireEvent.keyDown(dlg, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('2026-11-24');
    fireEvent.keyDown(dlg, { key: 'PageDown' });
    expect(dlg.textContent).toContain('December 2026');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('2026-12-24');
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(r.queryByRole('dialog')).toBeNull();
    expect(stored()).toBe('2026-11-16');
  });

  test('calendar: days outside min / max are disabled', () => {
    const { r } = setupDate({ initial: '2026-11-16', max: '2026-11-20' });
    fireEvent.click(r.getByRole('button', { name: 'Choose a date' }));
    expect((r.getByRole('button', { name: '2026-11-21' }) as HTMLButtonElement).disabled).toBe(true);
    expect((r.getByRole('button', { name: '2026-11-20' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
