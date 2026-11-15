// Form 731 signatures and the forms e-mailed to HCAA (PLAN-v3 "Form 731: signatures and submission
// to HCAA", "Sending forms to HCAA by email"):
//   form_links        one signing link per passenger and flight (/sign/<token>): the token is stored
//                     hashed (SHA-256); created / first and last opened; revoked; expires after the flight
//   form_signatures   who signed which version of the form (text_hash = SHA-256 of the form's text;
//                     a signature on another version is "needs to sign again")
//   form_submissions  the forms sent: when, the provider's message id, and the version sent
// Owned by the pilot; deleted with the flight.
const sql: string = String.raw`
CREATE TABLE form_links (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL,
  flight_id TEXT NOT NULL,
  person_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created BIGINT NOT NULL,
  first_opened BIGINT,
  last_opened BIGINT,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  expires BIGINT NOT NULL,
  FOREIGN KEY (flight_id, pilot_id) REFERENCES flights(id, pilot_id) ON DELETE CASCADE
);
CREATE INDEX form_links_flight ON form_links (pilot_id, flight_id);

CREATE TABLE form_signatures (
  flight_id TEXT NOT NULL,
  pilot_id TEXT NOT NULL,
  person_key TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  signed_at BIGINT NOT NULL,
  text_hash TEXT NOT NULL,
  PRIMARY KEY (flight_id, person_key),
  FOREIGN KEY (flight_id, pilot_id) REFERENCES flights(id, pilot_id) ON DELETE CASCADE
);

CREATE TABLE form_submissions (
  flight_id TEXT NOT NULL,
  pilot_id TEXT NOT NULL,
  form TEXT NOT NULL CHECK (form IN ('731', 'gendec')),
  sent_at BIGINT NOT NULL,
  message_id TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  PRIMARY KEY (flight_id, form),
  FOREIGN KEY (flight_id, pilot_id) REFERENCES flights(id, pilot_id) ON DELETE CASCADE
);
`;
export default sql;
