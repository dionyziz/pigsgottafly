// The edit log of every aircraft (api/_lib/aircraftLog.ts): who changed what, and when.
//
// author_id is not named pilot_id on purpose: deleting an account deletes every pilot_id row
// (routes/account.ts), and the log of an aircraft someone else owns must keep that pilot's edits,
// only without saying who (ON DELETE SET NULL: "a former pilot"). subject_id / subject_email: the
// person a sharing entry is about (an account, else the invited address). before_doc: the aircraft
// as it was when an edit entry opened, kept only on the newest entry, which later saves by the same
// pilot extend; changes is the diff from it to the aircraft as it is now.
const sql = `
CREATE TABLE aircraft_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES pilots(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'edit', 'document-add', 'document-remove', 'document-rename',
    'photo-set', 'photo-remove', 'share-add', 'share-role', 'share-remove')),
  started BIGINT NOT NULL,
  at BIGINT NOT NULL,
  changes JSONB NOT NULL DEFAULT '[]',
  detail JSONB NOT NULL DEFAULT '{}',
  subject_id TEXT REFERENCES pilots(id) ON DELETE SET NULL,
  subject_email TEXT,
  before_doc JSONB
);
CREATE INDEX aircraft_log_aircraft ON aircraft_log (aircraft_id, id DESC);
CREATE INDEX aircraft_log_author ON aircraft_log (author_id);
`;
export default sql;
