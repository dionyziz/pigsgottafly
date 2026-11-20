// The autorouter bearer token, shared by every server instance so a cold start reuses it
// (autorouter caps the live tokens per account): one row, api/_lib/app.ts tokenStore.
const sql = `
CREATE TABLE autorouter_token (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT NOT NULL,
  expires BIGINT NOT NULL
);
`;
export default sql;
