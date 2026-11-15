// Sending a form to HCAA claims (flight, form) first, so that two requests at the same moment (a
// double click, two tabs) cannot both send: the second finds the claim and is refused. A claim lasts
// until the send finishes (deleted then) or, if the function dies mid-send, until `until` passes.
const sql: string = String.raw`
CREATE TABLE form_send_claims (
  flight_id TEXT NOT NULL,
  pilot_id TEXT NOT NULL,
  form TEXT NOT NULL CHECK (form IN ('731', 'gendec')),
  until BIGINT NOT NULL,
  PRIMARY KEY (flight_id, form),
  FOREIGN KEY (flight_id, pilot_id) REFERENCES flights(id, pilot_id) ON DELETE CASCADE
);
`;
export default sql;
