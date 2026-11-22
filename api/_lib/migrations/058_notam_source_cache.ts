// What a paid NOTAM source returned, per source, location (item A / FIR) and UTC-day window, shared by
// every server instance (api/_lib/notamSources/cache.ts): saves the source's credits.
const sql = `
CREATE TABLE notam_source_cache (
  source TEXT NOT NULL,
  loc TEXT NOT NULL,
  bucket TEXT NOT NULL,
  fetched BIGINT NOT NULL,
  notams JSONB NOT NULL,
  PRIMARY KEY (source, loc, bucket)
);
CREATE INDEX notam_source_cache_fetched ON notam_source_cache (fetched);
`;
export default sql;
