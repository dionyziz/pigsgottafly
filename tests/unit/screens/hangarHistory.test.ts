// The aircraft edit log in words (src/features/hangar/history.ts): changes, entry lines, who, and the
// hangar card's "Updated … by …".
import { describe, expect, test } from 'vitest';

import { changeText, entryTitle, relativeTime, updatedText } from '../../../src/features/hangar/history';
import type { AircraftLogEntry } from '../../../src/shared/sharing';

const ME = 'p_me';
const olga = { pilotId: 'p_o', name: 'Olga Owner' };
const entry = (e: Partial<AircraftLogEntry>): AircraftLogEntry => ({
  id: 1,
  at: 0,
  kind: 'edit',
  by: olga,
  changes: [],
  ...e,
});

describe('changeText', () => {
  test('old → new with units; empty and booleans in words', () => {
    expect(changeText({ path: 'cruiseTasKt', from: 95, to: 100 })).toBe('Cruise TAS: 95 kt → 100 kt');
    expect(changeText({ path: 'colours', from: '', to: 'WHITE' })).toBe('Colours and markings: — → WHITE');
    expect(changeText({ path: 'massBalance.mlwKg', from: null, to: 1000 })).toBe('MLW: — → 1000 kg');
    expect(changeText({ path: 'equipment.emergencyRadio.elt', from: false, to: true })).toBe(
      'Emergency radio: ELT: no → yes',
    );
  });
  test('summaries as sentences; long text only changed; unknown paths named from the path', () => {
    expect(changeText({ path: 'massBalance.stations', summary: '3 stations changed' })).toBe('3 stations changed');
    expect(changeText({ path: 'performance.takeoff.table', summary: 'take-off table changed' })).toBe(
      'Take-off table changed',
    );
    expect(changeText({ path: 'notes' })).toBe('Notes changed');
    expect(changeText({ path: 'performance.factors.someNewFactor', from: 1, to: 2 })).toBe(
      'Factors some new factor: 1 → 2',
    );
  });
});

describe('entryTitle', () => {
  test('who did what', () => {
    expect(entryTitle(entry({ kind: 'create' }), ME)).toBe('Olga Owner added the aircraft');
    expect(entryTitle(entry({ by: { pilotId: ME, name: 'Me' }, changes: [{ path: 'notes' }] }), ME)).toBe(
      'You changed 1 field',
    );
    expect(entryTitle(entry({ by: { pilotId: null, name: '' }, kind: 'photo-set' }), ME)).toBe(
      'A former pilot changed the photo',
    );
    expect(entryTitle(entry({ kind: 'document-add', file: 'POH' }), ME)).toBe('Olga Owner added the document “POH”');
    expect(
      entryTitle(
        entry({ kind: 'document-rename', file: 'AFM', changes: [{ path: 'title', from: 'POH', to: 'AFM' }] }),
        ME,
      ),
    ).toBe('Olga Owner renamed the document “POH” to “AFM”');
  });
  test('sharing', () => {
    expect(entryTitle(entry({ kind: 'share-add', person: 'vera@example.com', role: 'view' }), ME)).toBe(
      'Olga Owner shared it with vera@example.com (can view)',
    );
    expect(entryTitle(entry({ kind: 'share-role', person: 'Me', personId: ME, role: 'edit' }), ME)).toBe(
      'Olga Owner gave you edit access',
    );
    expect(entryTitle(entry({ kind: 'share-remove', person: '', personId: null }), ME)).toBe(
      'Olga Owner removed a former pilot',
    );
    expect(entryTitle(entry({ kind: 'share-remove', person: 'Olga Owner', personId: 'p_o' }), ME)).toBe(
      'Olga Owner removed it from their hangar',
    );
  });
});

describe('updated', () => {
  const now = Date.UTC(2026, 10, 22, 12);
  test('relative time', () => {
    expect(relativeTime(now - 20e3, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60e3, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3600e3, now)).toBe('3 h ago');
    expect(relativeTime(now - 30 * 3600e3, now)).toBe('yesterday');
    expect(relativeTime(now - 4 * 86400e3, now)).toBe('4 days ago');
    expect(relativeTime(Date.UTC(2026, 0, 31, 23, 30), now)).toBe('on 2026-02-01');
  });
  test('by you, by a name, by a former pilot, or nobody known', () => {
    expect(updatedText(now - 60e3, { pilotId: ME, name: 'Me' }, ME, now)).toBe('Updated 1 min ago by you');
    expect(updatedText(now - 60e3, olga, ME, now)).toBe('Updated 1 min ago by Olga Owner');
    expect(updatedText(now - 60e3, { pilotId: null, name: '' }, ME, now)).toBe('Updated 1 min ago by a former pilot');
    expect(updatedText(now - 60e3, null, ME, now)).toBe('Updated 1 min ago');
  });
});
