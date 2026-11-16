// The picture an aircraft shows until it has a photo: one of public/aircraft/placeholder-{1,2,3}.webp,
// chosen at random when the aircraft is created (the column default) and kept. Existing aircraft get
// a random one too (a volatile default is evaluated per row).
const sql = `
ALTER TABLE aircraft ADD COLUMN placeholder SMALLINT NOT NULL DEFAULT (1 + floor(random() * 3))::smallint
  CHECK (placeholder BETWEEN 1 AND 3);
`;
export default sql;
