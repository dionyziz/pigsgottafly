// Pilots' own autorouter accounts, linked through OAuth 2.0 authorization code (api/_lib/autorouterLinks.ts):
// autorouter's licence is personal, so each pilot files and reads NOTAMs with their own account.
//   access_token, refresh_token  sealed with AES-256-GCM (AUTOROUTER_TOKEN_KEY), never stored in clear
//   expires                      epoch ms; NULL when autorouter did not say
//   broken_at, last_error        autorouter refused the token and it could not be renewed: the pilot reconnects
const sql = `
CREATE TABLE autorouter_links (
  pilot_id TEXT PRIMARY KEY REFERENCES pilots(id) ON DELETE CASCADE,
  account TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires BIGINT,
  linked_at BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  broken_at BIGINT,
  last_error TEXT
);
`;
export default sql;
