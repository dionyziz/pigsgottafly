// @vitest-environment jsdom
// Aircraft page sections: every issue of the save bar finds the input it is about (issueTarget),
// the point tables and the stations reorder from the keyboard, fuel densities are the standard ones.
import { afterEach, describe, expect, test } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { issueTarget, toInput } from '../../../src/features/hangar/AircraftPage';
import { CompassSection } from '../../../src/features/hangar/CompassSection';
import { MassBalanceSection } from '../../../src/features/hangar/MassBalanceSection';
import { PerformanceSection } from '../../../src/features/hangar/PerformanceSection';
import { FplSection, FuelSection, IdentitySection, SpeedsSection } from '../../../src/features/hangar/sections';
import { validateAircraft } from '../../../src/features/hangar/model';
import type { AircraftInput } from '../../../src/shared/types';
import { fleetSeed } from '../../../tools/build_seed';

afterEach(cleanup);

function Page({ initial, onDraft }: { initial: AircraftInput; onDraft?: (a: AircraftInput) => void }) {
  const [a, setA] = useState(initial);
  const edit = (fn: (d: AircraftInput) => void) =>
    setA((d) => {
      const c = structuredClone(d);
      fn(c);
      onDraft?.(c);
      return c;
    });
  const issues = validateAircraft(a, '2026-11-15');
  const p = { a, edit, issues };
  return (
    <div data-testid="aircraft-page">
      <IdentitySection {...p} />
      <FplSection {...p} />
      <SpeedsSection {...p} />
      <FuelSection {...p} />
      <MassBalanceSection {...p} />
      <PerformanceSection {...p} />
      <CompassSection {...p} today="2026-11-15" aircraftId="ac1" />
    </div>
  );
}

describe('aircraft page', () => {
  test('every issue of a broken aircraft resolves to an input or a list of its own', () => {
    const a = structuredClone(fleetSeed()[0]);
    a.registration = '';
    a.cruiseTasKt = 0;
    a.fuel.usableL = 500;
    a.massBalance.stations[1].armM = 99;
    a.massBalance.combinedLimits[0].maxKg = 0;
    a.massBalance.envelopes.normal.polygon[1] = [2, 600];
    a.compassCards[0].expires = '';
    a.compassCards[0].points = [[0, 0]];
    a.performance.factors.safetyFactorTakeoff = 0.5;
    const issues = validateAircraft(a, '2026-11-15');
    const { container } = render(<Page initial={a} />);
    const byPath = Object.fromEntries(issues.map((i) => [i.path, issueTarget(container, i)]));
    const name = (p: string) => byPath[p]?.getAttribute('name') ?? byPath[p]?.getAttribute('data-path');
    expect(name('registration')).toBe('registration');
    expect(name('cruiseTasKt')).toBe('cruiseTasKt');
    expect(name('fuel.usableL')).toBe('fuel.usableL');
    expect(name('massBalance.stations.1.armM')).toBe('massBalance.stations.1.armM');
    expect(name('massBalance.combinedLimits.0')).toBe('massBalance.combinedLimits.0');
    expect(name('massBalance.envelopes.normal.polygon')).toBe('massBalance.envelopes.normal.polygon.0.x');
    expect(name('compassCards.0.expires')).toBe('compassCards.0.expires');
    expect(name('compassCards.0.points')).toBe('compassCards.0.points.0.x');
    expect(name('performance.factors.safetyFactorTakeoff')).toBe('performance.factors.safetyFactorTakeoff');
    for (const i of issues) expect(byPath[i.path], i.path).toBeTruthy();
  });

  test('stations, envelope points and compass cards reorder from the keyboard on their handles', () => {
    const a = structuredClone(fleetSeed()[1]); // SX-ASG: two compass cards
    let last = a;
    const { container } = render(
      <Page
        initial={a}
        onDraft={(d) => {
          last = d;
        }}
      />,
    );
    const handles = (sel: string) => [...container.querySelectorAll<HTMLElement>(`${sel} .drag-handle`)];
    act(() => {
      fireEvent.keyDown(handles('.ed-table.stations')[0], { key: 'ArrowDown' });
    });
    expect(last.massBalance.stations.map((s) => s.id).slice(0, 2)).toEqual([
      a.massBalance.stations[1].id,
      a.massBalance.stations[0].id,
    ]);
    act(() => {
      fireEvent.keyDown(handles('[data-testid=env-cg]')[0], { key: 'ArrowDown' });
    });
    expect(last.massBalance.envelopes.normal.polygon.slice(0, 2)).toEqual([
      a.massBalance.envelopes.normal.polygon[1],
      a.massBalance.envelopes.normal.polygon[0],
    ]);
    const cards = [...container.querySelectorAll<HTMLElement>('[data-testid=compass-card] > .cc-head .drag-handle')];
    act(() => {
      fireEvent.keyDown(cards[1], { key: 'ArrowUp' });
    });
    expect(last.compassCards.map((c) => c.name)).toEqual([a.compassCards[1].name, a.compassCards[0].name]);
  });

  test('fuel: standard densities, no density inputs, endurance as 4h48', () => {
    const a = structuredClone(fleetSeed()[0]);
    a.fuel.types[0].densityKgPerL = 0.7;
    const input = toInput({ ...a, id: 'x', created: 0, updated: 0 } as never);
    expect(input.fuel.types.map((g) => g.densityKgPerL)).toEqual([0.72, 0.75]);
    const { container } = render(<Page initial={a} />);
    expect(container.querySelector('[aria-label$=" density"]')).toBeNull();
    expect([...container.querySelectorAll('.fuel-tbl tbody td.num')].map((e) => e.textContent)).toEqual([
      '0.72',
      '0.75',
    ]);
    expect(container.querySelector('[data-testid=endurance] b')?.textContent).toBe('4h48');
  });
});
