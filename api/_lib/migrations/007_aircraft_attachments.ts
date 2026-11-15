// Files stored with an aircraft: the compass swing reports of its compass cards (PLAN-v3 Hangar:
// "compass swing cards … with the swing report attached"). The card keeps a reference
// (CompassCard.report = { id, name, mime, size, uploaded }); the content lives here, base64, so the
// aircraft list stays small. Owned by the pilot; deleted with the aircraft.
const sql: string = String.raw`
CREATE TABLE aircraft_attachments (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL,
  aircraft_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created BIGINT NOT NULL,
  FOREIGN KEY (aircraft_id, pilot_id) REFERENCES aircraft(id, pilot_id) ON DELETE CASCADE
);
CREATE INDEX aircraft_attachments_aircraft ON aircraft_attachments (pilot_id, aircraft_id);
`;
export default sql;
