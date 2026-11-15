// @vitest-environment jsdom
// src/ui/Combobox key handling (pure and rendered), AerodromeInput resolution, PersonPicker.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { AerodromeInput, Combobox, Dialog, PersonPicker, comboKey, matchPeople } from '../../../src/ui';
import { aerodrome, resolveAerodrome, searchAerodromes } from '../../../src/data/ref';
import { AerodromePicker } from '../../../src/features/profile/AerodromePicker';
import type { RefAerodrome } from '../../../src/shared';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('comboKey', () => {
  const s = (open: boolean, active: number, count = 3) => ({ open, active, count });
  test('ArrowDown opens, then moves and wraps', () => {
    expect(comboKey(s(false, 0), 'ArrowDown')).toEqual({ open: true, active: 0, handled: true });
    expect(comboKey(s(true, 0), 'ArrowDown')).toEqual({ open: true, active: 1, handled: true });
    expect(comboKey(s(true, 2), 'ArrowDown')).toEqual({ open: true, active: 0, handled: true });
    expect(comboKey(s(false, 0, 0), 'ArrowDown').handled).toBe(false);
  });
  test('ArrowUp moves and wraps; does nothing closed', () => {
    expect(comboKey(s(true, 1), 'ArrowUp').active).toBe(0);
    expect(comboKey(s(true, 0), 'ArrowUp').active).toBe(2);
    expect(comboKey(s(false, 1), 'ArrowUp').handled).toBe(false);
  });
  test('Home / End', () => {
    expect(comboKey(s(true, 1), 'Home').active).toBe(0);
    expect(comboKey(s(true, 1), 'End').active).toBe(2);
  });
  test('Enter picks the active option only when the list shows', () => {
    expect(comboKey(s(true, 2), 'Enter')).toEqual({ open: false, active: 0, pick: 2, handled: true });
    expect(comboKey(s(true, 7), 'Enter').pick).toBe(2);
    expect(comboKey(s(false, 1), 'Enter')).toEqual({ open: false, active: 1, handled: false });
  });
  test('Escape closes; handled (swallowed) only when the list was showing', () => {
    expect(comboKey(s(true, 1), 'Escape')).toEqual({ open: false, active: 0, handled: true });
    expect(comboKey(s(false, 1), 'Escape').handled).toBe(false);
  });
  test('Tab closes without swallowing; other keys pass', () => {
    expect(comboKey(s(true, 1), 'Tab')).toEqual({ open: false, active: 0, handled: false });
    expect(comboKey(s(true, 1), 'a')).toEqual({ open: true, active: 1, handled: false });
  });
});

const FRUIT = ['apple', 'apricot', 'banana'];
function Fruit({ onPick }: { onPick: (s: string) => void }) {
  const [t, setT] = useState('');
  return (
    <Combobox<string> text={t} onText={setT} options={FRUIT.filter((f) => f.startsWith(t))} optionKey={(f) => f}
      renderOption={(f) => f} onPick={(f) => { setT(f); onPick(f); }} testId="c" />
  );
}

describe('Combobox', () => {
  test('type, arrow to the second option, Enter picks it', () => {
    const picked: string[] = [];
    const r = render(<Fruit onPick={(f) => picked.push(f)} />);
    const el = r.getByTestId('c');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: 'ap' } });
    expect(r.getAllByRole('option').map((o) => o.textContent)).toEqual(['apple', 'apricot']);
    expect(r.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(r.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    expect(el.getAttribute('aria-activedescendant')).toBe(r.getAllByRole('option')[1].id);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(picked).toEqual(['apricot']);
    expect(r.queryByRole('listbox')).toBeNull();
  });

  test('a click (mousedown) on an option picks it', () => {
    const picked: string[] = [];
    const r = render(<Fruit onPick={(f) => picked.push(f)} />);
    fireEvent.focus(r.getByTestId('c'));
    fireEvent.mouseDown(r.getAllByRole('option')[2]);
    expect(picked).toEqual(['banana']);
  });

  test('Escape closes the list without closing the dialog around it; a second Escape closes the dialog', () => {
    const close = vi.fn();
    const r = render(<Dialog title="T" onClose={close}><Fruit onPick={() => {}} /></Dialog>);
    const el = r.getByTestId('c');
    fireEvent.focus(el);
    expect(r.queryByRole('listbox')).not.toBeNull();
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(r.queryByRole('listbox')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('blur closes after a moment', () => {
    vi.useFakeTimers();
    const r = render(<Fruit onPick={() => {}} />);
    const el = r.getByTestId('c');
    fireEvent.focus(el);
    fireEvent.blur(el);
    expect(r.queryByRole('listbox')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(r.queryByRole('listbox')).toBeNull();
  });
});

describe('aerodrome search (src/data/ref)', () => {
  test('resolve and search', () => {
    expect(resolveAerodrome('lgtt')?.icao).toBe('LGTT');
    expect(resolveAerodrome(' LGAV ')?.icao).toBe('LGAV');
    expect(resolveAerodrome('XXXX')).toBeUndefined();
    expect(searchAerodromes('LGT')[0].icao).toMatch(/^LGT/);
    expect(searchAerodromes('LGT', 2)).toHaveLength(2);
  });
});

function AdHarness({ initial, log }: { initial: RefAerodrome | null; log: (string | null)[] }) {
  const [v, setV] = useState<RefAerodrome | null>(initial);
  return (
    <>
      <AerodromeInput value={v} onChange={(a) => { log.push(a?.id ?? null); setV(a); }} testId="ad" />
      <output data-testid="v">{v?.id ?? 'none'}</output>
      <button type="button" onClick={() => setV(aerodrome('LGMG') ?? null)}>set</button>
    </>
  );
}

describe('AerodromeInput', () => {
  test('a typed code resolves (green full name and elevation); an unknown one clears the value (red)', () => {
    const log: (string | null)[] = [];
    const r = render(<AdHarness initial={null} log={log} />);
    const el = r.getByTestId('ad') as HTMLInputElement;
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: 'lgtt' } });
    expect(r.getByTestId('v').textContent).toBe('LGTT');
    const ok = r.getByTestId('aerodrome-status');
    expect(ok.className).toContain('ok');
    expect(ok.textContent).toContain(aerodrome('LGTT')!.name);
    expect(ok.textContent).toMatch(/elevation \d+ ft/);
    fireEvent.change(el, { target: { value: 'ZZZZ' } });
    expect(r.getByTestId('v').textContent).toBe('none');
    fireEvent.keyDown(el, { key: 'Escape' });
    const bad = r.getByTestId('aerodrome-status');
    expect(bad.className).toContain('bad');
    expect(el.className).toContain('invalid');
    expect(log).toEqual(['LGTT', null]);
  });

  test('picking a suggestion sets the aerodrome and its code', () => {
    const r = render(<AdHarness initial={null} log={[]} />);
    const el = r.getByTestId('ad') as HTMLInputElement;
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: 'tatoi' } });
    const opt = r.getAllByRole('option').find((o) => o.textContent?.startsWith('LGTT'))!;
    fireEvent.mouseDown(opt);
    expect(el.value).toBe('LGTT');
    expect(r.getByTestId('v').textContent).toBe('LGTT');
  });

  test('a value set from outside replaces the draft', () => {
    const r = render(<AdHarness initial={aerodrome('LGTT') ?? null} log={[]} />);
    const el = r.getByTestId('ad') as HTMLInputElement;
    expect(el.value).toBe('LGTT');
    fireEvent.click(r.getByText('set'));
    expect(el.value).toBe('LGMG');
  });

  test('the old AerodromePicker (text-controlled) still works', () => {
    function P() { const [t, setT] = useState('LGA'); return <><AerodromePicker name="home" value={t} onChange={setT} /><output data-testid="t">{t}</output></>; }
    const r = render(<P />);
    const el = r.container.querySelector('input[name=home]') as HTMLInputElement;
    fireEvent.focus(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(r.getByTestId('t').textContent).toMatch(/^LGA/);
  });
});

describe('PersonPicker', () => {
  const people = [
    { id: 'a', fullName: 'Maria Papadopoulou', weightKg: 62 },
    { id: 'b', fullName: 'Eleni K.', weightKg: null },
    { id: 'c', fullName: 'Marios X', weightKg: 80 },
  ];
  test('matchPeople filters by name and exclusions', () => {
    expect(matchPeople(people, 'mar').map((p) => p.id)).toEqual(['a', 'c']);
    expect(matchPeople(people, 'mar', new Set(['a'])).map((p) => p.id)).toEqual(['c']);
    expect(matchPeople(people, '', undefined, 2)).toHaveLength(2);
  });
  test('Enter picks a person; the last option creates one from the typed name', () => {
    const pick = vi.fn(), create = vi.fn();
    const r = render(<PersonPicker people={people} onPick={pick} onCreate={create} testId="pp" />);
    const el = r.getByTestId('pp');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: 'eleni' } });
    expect(r.getAllByRole('option').map((o) => o.textContent)).toEqual(['Eleni K.no weight', ' Create “eleni”new passenger']);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(pick).toHaveBeenCalledWith(people[1]);
    fireEvent.change(el, { target: { value: 'Nikos' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(create).toHaveBeenCalledWith('Nikos');
  });
});
