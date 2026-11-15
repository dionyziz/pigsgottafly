// Aircraft photo and documents (POH/AFM and other PDFs) in the existing aircraft_attachments table.
// kind: 'report' (compass swing report: content in `data`, as before), 'photo' or 'document'
// (content in aircraft_attachment_chunks, base64, in AIRCRAFT_FILE_CHUNK_BYTES pieces, because a
// POH is larger than a serverless request or response may be). An upload creates the row with
// complete = false, adds its chunks, then completes; incomplete uploads are never listed and are
// cleared by the next upload to the aircraft after a day. Rows keep pilot_id = the aircraft's owner.
const sql = `
ALTER TABLE aircraft_attachments ADD COLUMN kind TEXT NOT NULL DEFAULT 'report';
ALTER TABLE aircraft_attachments ADD CONSTRAINT aircraft_attachments_kind CHECK (kind IN ('report', 'photo', 'document'));
ALTER TABLE aircraft_attachments ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE aircraft_attachments ADD COLUMN chunks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE aircraft_attachments ADD COLUMN complete BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX aircraft_attachments_kind_idx ON aircraft_attachments (aircraft_id, kind);
CREATE TABLE aircraft_attachment_chunks (
  attachment_id TEXT NOT NULL REFERENCES aircraft_attachments(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (attachment_id, seq)
);
`;
export default sql;
