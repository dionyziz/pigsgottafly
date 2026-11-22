// The core's hangar functions against the website's aircraft page modules: validation, the editors'
// helpers and the version history in words.
import { describe, expect, test } from 'vitest';

import {
  addCompassCard,
  addStation,
  addTakeoffAltitude,
  badPbn,
  cardStatus,
  deviationOf,
  issuesAt,
  item18Dropped,
  join10a,
  missingEssentials,
  removeHeadwind,
  sameTypeCopy,
  split10a,
  split10b,
  validateAircraft as webValidate,
} from '../../../src/features/hangar/model';
import { aircraftHelpers, historyText, validateAircraft } from '../../../src/native/core';
import type { AircraftInput } from '../../../src/shared';
import { changeText, entryTitle, revisionSummary, versionChangeText } from '../../../src/shared/aircraftHistory';
import type { AircraftLogEntry } from '../../../src/shared/sharing';
import { AC } from './fixtures';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const TODAY = '2026-11-15';

describe('validateAircraft: the aircraft page’s issues bar', () => {
  test('the issues of the website, the errors, what is missing, and one field’s', () => {
    const a: AircraftInput = json({ ...AC, registration: '', cruiseTasKt: 0 });
    const issues = webValidate(a, TODAY, 90);
    const out = validateAircraft({ aircraft: a, today: TODAY, path: 'registration' });
    expect(out.issues).toEqual(issues);
    expect(out.errors).toBe(issues.filter((x) => x.level === 'error').length);
    expect(out.errors).toBeGreaterThan(0);
    expect(out.missing).toEqual(missingEssentials(a));
    expect(out.at).toEqual(issuesAt(issues, 'registration'));
    expect(validateAircraft({ aircraft: AC, today: TODAY }).at).toBeNull();
  });
});

describe('aircraftHelpers', () => {
  test('FPL item 10 and 18', () => {
    expect(aircraftHelpers({ op: 'split10a', text: 'SDFGRY' })).toEqual({ codes: split10a('SDFGRY') });
    expect(aircraftHelpers({ op: 'join10a', codes: ['Y', 'S', 'G'] })).toEqual({ text: join10a(['Y', 'S', 'G']) });
    expect(aircraftHelpers({ op: 'split10b', text: 'SB2' })).toEqual(split10b('SB2'));
    expect(aircraftHelpers({ op: 'badPbn', text: 'B2Z9' })).toEqual({ bad: badPbn('B2Z9') });
    const eq = { ...AC.equipment, item18Extras: 'DOF/261115 NAV/GPS' };
    const a = { equipment: eq, operator: AC.operator, icaoType: AC.icaoType };
    expect(aircraftHelpers({ op: 'item18Dropped', aircraft: a })).toEqual({ dropped: item18Dropped(a) });
    const codes = aircraftHelpers({ op: 'codes' }) as { item10a: { code: string }[] };
    expect(codes.item10a.some((c) => c.code === 'S')).toBe(true);
  });

  test('compass cards', () => {
    const card = AC.compassCards[0];
    expect(aircraftHelpers({ op: 'cardStatus', card, today: TODAY, warnDays: 90 })).toEqual(
      cardStatus(card, TODAY, 90),
    );
    expect(aircraftHelpers({ op: 'deviation', forDeg: 350, steerDeg: 5 })).toEqual({
      deviationDeg: deviationOf(350, 5),
    });
    const web = json(AC) as AircraftInput;
    const webCard = addCompassCard(web, TODAY);
    expect(aircraftHelpers({ op: 'addCompassCard', aircraft: AC, today: TODAY })).toEqual(
      json({ aircraft: web, card: webCard }),
    );
  });

  test('changes come back as a changed copy; the input stays as it was', () => {
    const before = json(AC.massBalance);
    const web = json(AC.massBalance);
    const station = addStation(web, 'baggage');
    expect(aircraftHelpers({ op: 'addStation', massBalance: AC.massBalance, kind: 'baggage' })).toEqual(
      json({ massBalance: web, station }),
    );
    expect(AC.massBalance).toEqual(before);
    const t = AC.performance.takeoff;
    expect(aircraftHelpers({ op: 'takeoffTable', table: t, edit: 'addAltitude' })).toEqual(
      json({ table: addTakeoffAltitude(json(t)) }),
    );
    expect(aircraftHelpers({ op: 'takeoffTable', table: t, edit: 'removeHeadwind', row: 0, index: 0 })).toEqual(
      json({ table: removeHeadwind(json(t), 0, 0) }),
    );
    expect(aircraftHelpers({ op: 'sameTypeCopy', aircraft: AC, registration: 'SX-NEW' })).toEqual(
      json(sameTypeCopy(AC, 'SX-NEW')),
    );
    const fuel = aircraftHelpers({ op: 'addFuelType', fuel: AC.fuel, type: 'MOGAS' }) as {
      fuel: { types: { type: string }[] };
      others: string[];
    };
    expect(fuel.fuel.types.map((x) => x.type)).toContain('MOGAS');
    expect(fuel.others).not.toContain('MOGAS');
  });

  test('an unknown op fails', () => {
    expect(() => aircraftHelpers({ op: 'nope' } as never)).toThrow(/unknown aircraft helper/);
  });
});

describe('historyText', () => {
  test('entries and version differences in words', () => {
    const entries: AircraftLogEntry[] = [
      {
        id: 1,
        at: 0,
        kind: 'edit',
        by: { pilotId: 'p1', name: 'Test Pilot' },
        changes: [
          { path: 'cruiseTasKt', from: 90, to: 92 },
          { path: 'fuel.usableL', from: 140, to: 144 },
        ],
      },
      { id: 2, at: 0, kind: 'share-add', by: { pilotId: 'p2', name: 'Other' }, changes: [], person: 'X', role: 'edit' },
    ] as AircraftLogEntry[];
    const out = historyText({ entries, myId: 'p1', versionChanges: entries[0].changes });
    expect(out.entries).toEqual(
      entries.map((e) => ({
        title: entryTitle(e, 'p1'),
        changes: e.changes.map(changeText),
        summary: revisionSummary(e),
      })),
    );
    expect(out.entries[0].title).toBe('You changed 2 fields');
    expect(out.versionChanges).toEqual(entries[0].changes.map(versionChangeText));
  });
});
