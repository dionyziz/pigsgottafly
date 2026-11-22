// @vitest-environment jsdom
// Looking at an earlier version of an aircraft (src/features/hangar/versions.ts, VersionPreview.tsx,
// src/shared/aircraftHistory.ts): its differences in words (this version, and now), the restore lines
// of the history, every difference of the form found and highlighted in the read-only form, and the
// preview's Restore, for editors only, confirmed in the page.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { diffAircraft, diffSnapshots } from '../../../api/_lib/aircraftLog';
import { MassBalanceSection } from '../../../src/features/hangar/MassBalanceSection';
import { PerformanceSection } from '../../../src/features/hangar/PerformanceSection';
import { FplSection, FuelSection, IdentitySection, SpeedsSection } from '../../../src/features/hangar/sections';
import { VersionPreview } from '../../../src/features/hangar/VersionPreview';
import { CHANGED_CLASS, markChanged, pathTarget, splitChanges } from '../../../src/features/hangar/versions';
import { entryTitle, revisionSummary, versionChangeText } from '../../../src/shared/aircraftHistory';
import type { AircraftRevisionDetail, AircraftSnapshot } from '../../../src/shared/sharing';
import type { AircraftFile, AircraftInput } from '../../../src/shared/types';
import { fleetSeed } from '../../../tools/build_seed';

afterEach(cleanup);

const olga = { pilotId: 'p_o', name: 'Olga Owner' };
const eddie = { pilotId: 'p_e', name: 'Eddie Editor' };
const AT = Date.UTC(2026, 10, 22, 12, 5);
const doc = (id: string, title: string): AircraftFile => ({
  id,
  kind: 'document',
  title,
  name: `${title}.pdf`,
  mime: 'application/pdf',
  size: 10,
  chunks: 1,
  uploaded: 0,
});
const snap = (aircraft: AircraftInput, documents: AircraftFile[] = []): AircraftSnapshot => ({
  aircraft,
  photo: null,
  documents,
});

describe('in words', () => {
  test('a difference reads as this version, then now', () => {
    expect(versionChangeText({ path: 'cruiseTasKt', from: 110, to: 95 })).toBe('Cruise TAS: 95 kt (now 110 kt)');
    expect(versionChangeText({ path: 'serial', from: '17262', to: '' })).toBe('Serial number: — (now 17262)');
    expect(versionChangeText({ path: 'massBalance.stations', summary: '1 station added' })).toBe('1 station added');
    expect(versionChangeText({ path: 'notes' })).toBe('Notes differs');
  });

  test('a restore names the version and its author; the summary adds what it changed', () => {
    const e = {
      id: 9,
      at: AT,
      kind: 'restore' as const,
      by: eddie,
      changes: [{ path: 'cruiseTasKt', from: 110, to: 95 }],
      restored: { id: 3, at: AT, by: olga },
    };
    expect(entryTitle(e, 'p_e')).toBe('You restored the version of 2026-11-22 14:05 by Olga Owner');
    expect(entryTitle(e, 'p_o')).toBe('Eddie Editor restored the version of 2026-11-22 14:05 by you');
    expect(revisionSummary(e)).toBe(
      'Eddie Editor restored the version of 2026-11-22 14:05 by Olga Owner: Cruise TAS: 110 kt → 95 kt',
    );
    expect(entryTitle({ id: 1, at: AT, kind: 'baseline', by: { pilotId: null, name: '' }, changes: [] }, 'p_o')).toBe(
      'The aircraft as it was when version history began',
    );
  });

  test('files are compared by reference: added, removed, renamed, no longer stored, the photo', () => {
    const [ac] = fleetSeed();
    const now = {
      ...snap(ac, [doc('f1', 'POH'), doc('f2', 'AFM')]),
      photo: { ...doc('p1', ''), kind: 'photo' as const },
    };
    const then = snap(ac, [doc('f1', 'Handbook'), doc('f3', 'Old'), doc('f4', 'W&B')]);
    const changes = diffSnapshots(now, then, new Set(['f1', 'f2', 'f3', 'p1']));
    expect(changes.map(versionChangeText)).toEqual([
      'Document “POH” renamed “Handbook”',
      'Document “Old” added',
      'Document “W&B” is no longer stored',
      'Document “AFM” removed',
      'Photo removed',
    ]);
    expect(splitChanges([{ path: 'cruiseTasKt', from: 1, to: 2 }, ...changes]).fields).toHaveLength(1);
  });
});

function Form({ a }: { a: AircraftInput }) {
  const p = { a, edit: () => {}, issues: [] };
  return (
    <form data-testid="form">
      <fieldset disabled>
        <IdentitySection {...p} />
        <FplSection {...p} />
        <SpeedsSection {...p} />
        <FuelSection {...p} />
        <MassBalanceSection {...p} />
        <PerformanceSection {...p} />
      </fieldset>
    </form>
  );
}

describe('the read-only form', () => {
  test('every difference of the record is found in the form and highlighted, and unmarked again', () => {
    const [now] = fleetSeed();
    const then = structuredClone(now);
    then.serial = 'OLD-1';
    then.cruiseTasKt = now.cruiseTasKt + 7;
    then.fuel.usableL = now.fuel.usableL - 10;
    then.massBalance.emptyMassKg = now.massBalance.emptyMassKg + 3;
    then.massBalance.stations[0].armM += 0.05;
    then.performance.takeoff.rows[0].massKg += 10;
    then.equipment.item10a = 'SDFGRY';
    then.notes = 'line one\nline two';
    const changes = diffAircraft(now, then);
    expect(changes.map((c) => c.path)).toEqual([
      'serial',
      'cruiseTasKt',
      'fuel.usableL',
      'massBalance.emptyMassKg',
      'massBalance.stations',
      'performance.takeoff.table',
      'equipment.item10a',
      'notes',
    ]);
    const { container } = render(<Form a={then} />);
    for (const c of changes) expect(pathTarget(container, c.path), c.path).not.toBeNull();
    const undo = markChanged(container, changes);
    const label = (name: string) => container.querySelector(`[name="${name}"]`)!.closest('label.field')!;
    expect(label('serial').classList.contains(CHANGED_CLASS)).toBe(true);
    expect(label('cruiseTasKt').classList.contains(CHANGED_CLASS)).toBe(true);
    expect(label('registration').classList.contains(CHANGED_CLASS)).toBe(false);
    expect(container.querySelectorAll(`.${CHANGED_CLASS}`).length).toBeGreaterThanOrEqual(6);
    undo();
    expect(container.querySelectorAll(`.${CHANGED_CLASS}`)).toHaveLength(0);
  });
});

describe('VersionPreview', () => {
  const [ac] = fleetSeed();
  const detail: AircraftRevisionDetail = {
    revision: { id: 3, at: AT, kind: 'edit', by: olga, changes: [], summary: '' },
    snapshot: snap(ac),
    changes: [
      { path: 'cruiseTasKt', from: 110, to: 95 },
      { path: 'documents.f1', summary: 'document “POH” removed' },
    ],
    head: { id: 5, at: AT },
  };

  test('lists the differences; an editor restores after confirming in the page', async () => {
    const onRestore = vi.fn(async () => {});
    render(<VersionPreview detail={detail} myId="p_o" canRestore onRestore={onRestore} onClose={() => {}} />);
    expect(screen.getByTestId('version-preview').textContent).toContain('Version of 2026-11-22 14:05');
    expect([...screen.getByTestId('version-changes').querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'Cruise TAS: 95 kt (now 110 kt)',
      'Document “POH” removed',
    ]);
    fireEvent.click(screen.getByTestId('version-restore'));
    expect(onRestore).not.toHaveBeenCalled();
    const confirm = screen.getByTestId('version-confirm');
    expect(confirm.textContent).toContain('Restore the version of 2026-11-22 14:05?');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await vi.waitFor(() => expect(onRestore).toHaveBeenCalledOnce());
  });

  test('a viewer sees the version but cannot restore it; the current version has nothing to restore', () => {
    const { rerender } = render(
      <VersionPreview detail={detail} myId="p_v" canRestore={false} onRestore={async () => {}} onClose={() => {}} />,
    );
    expect(screen.queryByTestId('version-restore')).toBeNull();
    rerender(
      <VersionPreview
        detail={{ ...detail, changes: [] }}
        myId="p_o"
        canRestore
        onRestore={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId('version-restore')).toBeNull();
    expect(screen.getByTestId('version-preview').textContent).toContain('Same as the current version');
  });
});
