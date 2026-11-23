// The core's Plan edits against the website's sections: choosing the aircraft and typing the fuel.
import { describe, expect, test } from 'vitest';

import { setAircraft as webSetAircraft } from '../../../src/features/editor/panels/aircraftChoice';
import { withFuel, withTypedFuel } from '../../../src/features/editor/panels/fuelEdit';
import { fuelEdit, setAircraft } from '../../../src/native/core';
import type { Aircraft } from '../../../src/shared';
import { AC, ad, crew, flight } from './fixtures';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const pick = <T extends object, K extends keyof T>(o: T, keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

describe('setAircraft', () => {
  const f = flight([ad('LGTT'), ad('LGMG')], {
    crew: [crew('PIC', 'nowhere', 'Test Pilot', 80), crew('PAX', 'rear-left', 'Robin Rider', 70)],
    baggageKg: { bag1: 10, gone: 5 },
    options: { compassCard: 'missing', category: 'utility' } as never,
  });
  const keys: ('aircraftId' | 'crew' | 'baggageKg' | 'options')[] = ['aircraftId', 'crew', 'baggageKg', 'options'];

  test('as the Aircraft section: seats, baggage, compass card and category follow the aircraft', () => {
    const got = setAircraft(json({ doc: f, aircraft: AC }));
    expect(got).toEqual(json(pick(webSetAircraft(f, AC), keys)));
    expect(got.aircraftId).toBe('ac1');
    expect(got.crew[0].seat).not.toBe('nowhere');
    expect(got.baggageKg).toEqual({ bag1: 10 });
    expect(got.options.compassCard).toBeNull();
  });

  test('no aircraft', () => {
    const got = setAircraft(json({ doc: f, aircraft: null }));
    expect(got).toEqual(json(pick(webSetAircraft(f, null), keys)));
    expect(got.aircraftId).toBeNull();
  });
});

describe('fuelEdit', () => {
  const two = { ...AC, fuel: { ...AC.fuel, types: [{ type: 'MOGAS' }, { type: 'AVGAS' }] } } as Aircraft;
  const f = flight([ad('LGTT'), ad('LGMG')], { fobL: 100 });

  test('per type: the sum is the FOB, the split is kept unless only the first fuel is typed', () => {
    const a = fuelEdit(json({ doc: f, op: 'type', fuel: two.fuel, type: 'AVGAS', litres: 20 }));
    const web = withTypedFuel(f, two.fuel, 'AVGAS', 20);
    expect(a).toEqual(json({ fobL: web.fobL, options: web.options }));
    expect(a).toMatchObject({ fobL: 120, options: { fuelL: { MOGAS: 100, AVGAS: 20 } } });
    const doc = { ...f, ...a };
    const b = fuelEdit(json({ doc, op: 'type', fuel: two.fuel, type: 'AVGAS', litres: null }));
    expect(b).toMatchObject({ fobL: 100, options: { fuelL: null } });
    const c = fuelEdit(json({ doc: { ...doc, ...b }, op: 'type', fuel: two.fuel, type: 'MOGAS', litres: null }));
    expect(c).toMatchObject({ fobL: null, options: { fuelL: null } });
  });

  test('a total and back to required + reserve', () => {
    expect(fuelEdit(json({ doc: f, op: 'total', litres: 90 }))).toEqual(
      json(pick(withFuel(f, 90, null), ['fobL', 'options'])),
    );
    expect(fuelEdit(json({ doc: f, op: 'default' }))).toMatchObject({ fobL: null, options: { fuelL: null } });
  });
});
