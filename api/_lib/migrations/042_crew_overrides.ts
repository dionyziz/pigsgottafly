// Manifest following: the snapshot fields edited on the flight (FlightCrew.overrides, e.g. a weight
// typed for this flight) stop following the passenger list / profile. Existing rows: none.
const sql = `
ALTER TABLE flight_crew ADD COLUMN overrides JSONB NOT NULL DEFAULT '[]'::jsonb;
`;
export default sql;
