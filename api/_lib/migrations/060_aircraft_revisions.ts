// Version history of aircraft (api/_lib/aircraftLog.ts): every log entry that changes the aircraft or
// its files keeps `snapshot`, the aircraft as it was after it (AircraftSnapshot: the record, and the
// photo and documents attached, by reference). Sharing entries have none: they change no version.
// Two more kinds: 'restore' (a version brought back, itself a revision) and 'baseline' (the starting
// version of an aircraft whose log had no entry to hold it).
//
// aircraft_attachments.detached: a photo or document a restore took off the aircraft. It stays
// stored, so restoring a later version (or undoing the restore) can put it back; it is listed nowhere.
//
// Backfill: the newest entry of every aircraft that changed it gets the current aircraft as its
// snapshot (it is what that entry left); an aircraft without one gets a 'baseline' revision.
import { BASELINE_SQL, snapshotOf } from '../aircraftLog.js';
import type { Queryable } from '../db.js';

const sql = `
ALTER TABLE aircraft_log ADD COLUMN snapshot JSONB;
ALTER TABLE aircraft_log DROP CONSTRAINT aircraft_log_kind_check;
ALTER TABLE aircraft_log ADD CONSTRAINT aircraft_log_kind_check CHECK (kind IN ('create', 'edit', 'document-add',
  'document-remove', 'document-rename', 'photo-set', 'photo-remove', 'share-add', 'share-role', 'share-remove',
  'restore', 'baseline'));
CREATE INDEX aircraft_log_revisions ON aircraft_log (aircraft_id, id DESC) WHERE snapshot IS NOT NULL;
ALTER TABLE aircraft_attachments ADD COLUMN detached BOOLEAN NOT NULL DEFAULT FALSE;
`;

export async function run(q: Queryable): Promise<void> {
  const aircraft = await q.query('SELECT id, updated FROM aircraft ORDER BY id');
  for (const a of aircraft) {
    const snapshot = JSON.stringify(await snapshotOf(q, a.id));
    const [last] = await q.query(
      `SELECT id FROM aircraft_log WHERE aircraft_id = $1 AND kind NOT LIKE 'share-%' ORDER BY id DESC LIMIT 1`,
      [a.id],
    );
    if (last) await q.query('UPDATE aircraft_log SET snapshot = $2::jsonb WHERE id = $1', [last.id, snapshot]);
    else await q.query(BASELINE_SQL, [a.id, Number(a.updated), snapshot]);
  }
}

export default sql;
