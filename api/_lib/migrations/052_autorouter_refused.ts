// autorouter refused a new token (too many live ones): when sign-in may be tried again, shared by every
// server instance so none of them keeps asking (api/_lib/autorouter.ts REFUSED_WAIT_MS). The row may
// now exist without a token.
const sql = `
ALTER TABLE autorouter_token ALTER COLUMN token DROP NOT NULL;
ALTER TABLE autorouter_token ALTER COLUMN expires DROP NOT NULL;
ALTER TABLE autorouter_token ADD COLUMN refused_until BIGINT;
`;
export default sql;
