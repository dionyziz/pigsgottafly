// Every e-mail sent on a pilot's behalf to an authority or an operator (Form 731, General
// Declaration, and later operator declarations), for the sending caps in api/_lib/sendCaps.ts:
// at most MAIL_DAILY_CAP messages per pilot and MAIL_FLIGHT_FORM_CAP per flight and form in any
// rolling 24 hours, re-sends included. form_submissions keeps only the last send of each form, so
// it cannot count re-sends. A row is written before the message goes out (a reservation) and
// removed if sending fails. flight_id has no foreign key: a flight's sends still count after it is
// deleted. Deleted with the pilot.
const sql = `
CREATE TABLE mail_log (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  flight_id TEXT,
  form TEXT NOT NULL,
  at BIGINT NOT NULL
);
CREATE INDEX mail_log_pilot_at ON mail_log (pilot_id, at DESC);
`;
export default sql;
