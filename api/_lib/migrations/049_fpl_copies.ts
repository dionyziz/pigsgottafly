// E-mail copies of filed flight plans (api/_lib/fplCopy.ts):
//   operators.requires_fpl_copy / fpl_copy_email   the operator wants one, sent there;
//   ref_aerodrome_contacts                          aerodromes that want one (none listed = none do).
const sql = `
ALTER TABLE operators ADD COLUMN requires_fpl_copy BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE operators ADD COLUMN fpl_copy_email TEXT NOT NULL DEFAULT '';
CREATE TABLE ref_aerodrome_contacts (
  icao TEXT PRIMARY KEY,
  fpl_copy_email TEXT NOT NULL DEFAULT ''
);
INSERT INTO ref_aerodrome_contacts (icao, fpl_copy_email) VALUES ('LGTT', 'lgttatc@gmail.com');
`;
export default sql;
