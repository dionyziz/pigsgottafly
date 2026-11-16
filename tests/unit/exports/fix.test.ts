// Export warnings → where they are fixed (src/features/exports/fix.ts).
import { describe, expect, test } from 'vitest';

import { EDITOR_FOCUS_SECTION, fixLink, planningFix } from '../../../src/features/exports/fix';

describe('fix links', () => {
  test('editor, hangar, profile and passenger links', () => {
    const ctx = { flightId: 'f1', aircraftId: 'a1' };
    expect(fixLink({ kind: 'flight', focus: 'blockOff' }, ctx)?.to).toBe('/flights/f1?focus=blockOff');
    expect(fixLink({ kind: 'flight' }, ctx)?.to).toBe('/flights/f1');
    expect(fixLink({ kind: 'aircraft', focus: 'colours' }, ctx)?.to).toBe('/hangar/a1?focus=colours');
    expect(fixLink({ kind: 'aircraft', id: 'a2' }, ctx)?.to).toBe('/hangar/a2');
    expect(fixLink({ kind: 'aircraft' }, { flightId: 'f1' })).toBeNull();
    expect(fixLink({ kind: 'profile', focus: 'phone' }, ctx)?.to).toBe('/profile?focus=phone');
    expect(fixLink({ kind: 'person', key: 'PIC', fields: ['phone'] }, ctx)?.to).toBe(
      '/passengers?edit=me&fields=phone',
    );
  });

  test('every editor focus key belongs to a panel section', () => {
    for (const s of Object.values(EDITOR_FOCUS_SECTION))
      expect(['when', 'aircraft', 'manifest', 'fuel', 'performance', 'fpl']).toContain(s);
  });
});

describe('planning warnings from src/calc', () => {
  test.each([
    ['Block-off time not set: 12:00Z assumed.', { kind: 'flight', focus: 'blockOff' }],
    [
      'Performance: Block-off time not set: take-off and landing times, and so the weather, are unknown.',
      { kind: 'flight', focus: 'blockOff' },
    ],
    ['Taxi-out time not set: 0 min used.', { kind: 'flight', focus: 'taxiOut' }],
    ['Aircraft burn rate not set: leg fuel cannot be computed.', { kind: 'aircraft', focus: 'burnLph' }],
    ['Compass card "A" expired on 2026-01-01: swing required.', { kind: 'aircraft', focus: 'compass' }],
    ['W&B: The manifest is empty: no pilot or passengers in the balance.', { kind: 'flight', focus: 'manifest' }],
    ['W&B: Empty mass is not set (weighing report).', { kind: 'aircraft', focus: 'emptyMassKg' }],
    ['Fuel on board 40 L is below required 52 L.', { kind: 'flight', focus: 'fob' }],
    [
      'Fuel reserve not set in the profile: no reserve added to the default fuel on board.',
      { kind: 'profile', focus: 'reserveMin' },
    ],
    [
      'Performance: Destination: Runway 03 is grass: choose the surface condition (short dry grass assumed).',
      { kind: 'flight', focus: 'performance' },
    ],
    ['Landing at 18:20Z is after sunset (17:10Z) at LGMG.', { kind: 'flight', focus: 'blockOff' }],
  ])('%s', (text, fix) => expect(planningFix(text)).toEqual(fix));
});
