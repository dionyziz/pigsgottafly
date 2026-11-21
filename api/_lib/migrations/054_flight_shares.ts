// Shared flights. The pilot who created a flight owns it (flights.pilot_id, unchanged); they share it
// by e-mail as a viewer (see it: the editor read-only, the briefing, the forms' state) or an editor
// (also change it and its manifest, and manage the sharing). Only the owner trashes, restores or
// deletes it, files its flight plan and sends its forms and declarations.
//
// flight_shares: pilots with an account. flight_invites: addresses with no account yet (lower-cased);
// an invite becomes a share when someone signs in with that verified address (routes/session.ts).
// `opened` is when the shared pilot last opened the flight (their lobby's order); the owner's stays
// on flights.opened. Rows of the flight kept per pilot (flight_crew, flight_filings, flight_notams,
// the forms' tables) keep the owner's id whoever edits the flight.
const sql = `
CREATE TABLE flight_shares (
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  created BIGINT NOT NULL,
  created_by TEXT REFERENCES pilots(id) ON DELETE SET NULL,
  opened BIGINT,
  PRIMARY KEY (flight_id, pilot_id)
);
CREATE INDEX flight_shares_pilot ON flight_shares (pilot_id);

CREATE TABLE flight_invites (
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email)),
  role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  created BIGINT NOT NULL,
  created_by TEXT REFERENCES pilots(id) ON DELETE SET NULL,
  PRIMARY KEY (flight_id, email)
);
CREATE INDEX flight_invites_email ON flight_invites (email);
`;
export default sql;
