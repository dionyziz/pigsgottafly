// Shared aircraft. The pilot who created an aircraft owns it (aircraft.pilot_id, unchanged); they
// can share it with other pilots as a viewer (see it, fly it: choose it on their flights) or an
// editor (also change it and its files, and manage the sharing). Only the owner deletes it.
//
// A flight (and a pilot's default aircraft) may now reference an aircraft of another pilot, so
// their composite (id, pilot_id) foreign keys become plain ones on aircraft(id); the API checks
// access instead. Existing rows all reference the pilot's own aircraft and stay valid. Deleting an
// aircraft still clears it from every flight and default (ON DELETE SET NULL). Revoking a share
// clears the pilot's default only: their flights keep the aircraft id and show it as unavailable.
// Files (aircraft_attachments) keep pilot_id = the owner, whoever uploads them.
const sql = `
CREATE TABLE aircraft_shares (
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  created BIGINT NOT NULL,
  created_by TEXT REFERENCES pilots(id) ON DELETE SET NULL,
  PRIMARY KEY (aircraft_id, pilot_id)
);
CREATE INDEX aircraft_shares_pilot ON aircraft_shares (pilot_id);
CREATE INDEX IF NOT EXISTS pilots_email_lower ON pilots (lower(email));

-- every foreign key from flights or pilots to aircraft (001 created one each; dropped by lookup,
-- not by name, so a differently named constraint cannot survive and keep blocking shared aircraft)
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname, conrelid::regclass AS t FROM pg_constraint
           WHERE contype = 'f' AND confrelid = 'aircraft'::regclass AND conrelid IN ('flights'::regclass, 'pilots'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.t, c.conname);
  END LOOP;
END $$;

ALTER TABLE flights ADD CONSTRAINT flights_aircraft_fk
  FOREIGN KEY (aircraft_id) REFERENCES aircraft(id) ON DELETE SET NULL;
ALTER TABLE pilots ADD CONSTRAINT pilots_default_aircraft_fk
  FOREIGN KEY (default_aircraft_id) REFERENCES aircraft(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS flights_aircraft ON flights (aircraft_id);
`;
export default sql;
