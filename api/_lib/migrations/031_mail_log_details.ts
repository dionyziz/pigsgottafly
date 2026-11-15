// The e-mail action log (shown on /admin): mail_log (migration 030) records every outbound e-mail,
// not only the ones counted by the sending caps: forms to HCAA, W&B/performance declarations to
// operators, the admins' signup notices. Each row: time, pilot (NULL for the app's own messages
// with no pilot), kind ('731', 'gendec', 'wbperf', 'signup', 'signup-more'), recipient(s), subject,
// result ('pending' while sending, 'sent', 'failed', 'capped' = refused by a cap, never sent), the
// provider's message id, and the error of a failure. The caps count only 'pending' and 'sent' rows;
// rows that existed before (all were sends that went out or were in flight) count as 'sent'.
const sql = `
ALTER TABLE mail_log ALTER COLUMN pilot_id DROP NOT NULL;
ALTER TABLE mail_log ADD COLUMN recipient TEXT NOT NULL DEFAULT '';
ALTER TABLE mail_log ADD COLUMN subject TEXT NOT NULL DEFAULT '';
ALTER TABLE mail_log ADD COLUMN result TEXT NOT NULL DEFAULT 'sent' CHECK (result IN ('pending', 'sent', 'failed', 'capped'));
ALTER TABLE mail_log ADD COLUMN message_id TEXT;
ALTER TABLE mail_log ADD COLUMN error TEXT;
CREATE INDEX mail_log_at ON mail_log (at DESC);
CREATE INDEX mail_log_form_at ON mail_log (form, at DESC);
`;
export default sql;
