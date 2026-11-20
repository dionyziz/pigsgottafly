// One-time codes that hand a sign-in from Apple's sign-in sheet to the iOS app's web view
// (api/_lib/routes/appLogin.ts): stored hashed, valid two minutes, deleted when used.
const sql = `
CREATE TABLE app_login_codes (
  code_hash TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);
`;
export default sql;
