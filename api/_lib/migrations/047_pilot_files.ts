// The pilot's own documents: their licence and medical certificate, one PDF each (optional), in the
// chunked file scheme of the aircraft and operator files (api/_lib/routes/files.ts). A new upload of
// a kind replaces the previous one when it completes. Deleted with the pilot (pilot_id).
const sql = `
CREATE TABLE pilot_files (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('licence', 'medical')),
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  complete BOOLEAN NOT NULL DEFAULT FALSE,
  created BIGINT NOT NULL
);
CREATE INDEX pilot_files_pilot ON pilot_files (pilot_id);
CREATE TABLE pilot_file_chunks (
  attachment_id TEXT NOT NULL REFERENCES pilot_files(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (attachment_id, seq)
);
`;
export default sql;
