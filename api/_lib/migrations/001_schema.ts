// v3 schema (see the SQL comments). Migrations are TS modules so the Vercel bundle includes them.
const sql: string = String.raw`-- v3 schema. Converts the v2 production schema in place without losing data or sessions:
--   users(id, google_sub, email, name, picture, created, last_login)  → pilots (same ids)
--   sessions(token_hash, user_id, created)                            → sessions(token_hash, pilot_id, created)
--   flights(id, owner, data jsonb, summary jsonb, …)                  → legacy_flights (kept; converted
--                                                                        into the new flights by 004)
-- On an empty database it simply creates everything.
-- Tenancy: every owned row carries pilot_id; references between owned rows are composite
-- (id, pilot_id) foreign keys, so a row can never point at another pilot's record.

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL AND to_regclass('public.pilots') IS NULL THEN
    ALTER TABLE users RENAME TO pilots;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'flights' AND column_name = 'owner') THEN
    ALTER TABLE flights RENAME TO legacy_flights;
    IF to_regclass('public.flights_pkey') IS NOT NULL THEN
      ALTER INDEX flights_pkey RENAME TO legacy_flights_pkey;
    END IF;
    IF to_regclass('public.flights_owner') IS NOT NULL THEN
      ALTER INDEX flights_owner RENAME TO legacy_flights_owner;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'user_id') THEN
    ALTER TABLE sessions RENAME COLUMN user_id TO pilot_id;
  END IF;
END
$$;

-- ---------------------------------------------------------------- pilots and sessions
CREATE TABLE IF NOT EXISTS pilots (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  created BIGINT NOT NULL,
  last_login BIGINT NOT NULL
);
ALTER TABLE pilots
  ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS date_of_birth TEXT,
  ADD COLUMN IF NOT EXISTS weight_kg DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS id_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS id_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS nationality TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS relation TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS licence_no TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS home_aerodrome TEXT,
  ADD COLUMN IF NOT EXISTS default_aircraft_id TEXT,
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seeded_at BIGINT;
-- the v2 name was the Google display name; use it as the form name until the pilot edits it
UPDATE pilots SET full_name = name WHERE full_name = '' AND name <> '';

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  created BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_pilot ON sessions (pilot_id);

-- ---------------------------------------------------------------- hangar
CREATE TABLE aircraft (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  registration TEXT NOT NULL,
  make_model TEXT NOT NULL DEFAULT '',
  icao_type TEXT NOT NULL DEFAULT '',
  wake TEXT NOT NULL DEFAULT 'L',
  serial TEXT NOT NULL DEFAULT '',
  operator TEXT NOT NULL DEFAULT '',
  home_base TEXT NOT NULL DEFAULT '',
  colours TEXT NOT NULL DEFAULT '',
  cruise_tas_kt DOUBLE PRECISION NOT NULL,
  pattern_tas_kt DOUBLE PRECISION NOT NULL,
  climb_tas_kt DOUBLE PRECISION,
  fuel JSONB NOT NULL,
  mass_balance JSONB NOT NULL,
  performance JSONB NOT NULL,
  equipment JSONB NOT NULL,
  compass_cards JSONB NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  UNIQUE (id, pilot_id),
  UNIQUE (pilot_id, registration)
);

ALTER TABLE pilots ADD CONSTRAINT pilots_default_aircraft_fk
  FOREIGN KEY (default_aircraft_id, id) REFERENCES aircraft(id, pilot_id) ON DELETE SET NULL (default_aircraft_id);

-- ---------------------------------------------------------------- people and places
CREATE TABLE passengers (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  date_of_birth TEXT,
  weight_kg DOUBLE PRECISION,
  id_number TEXT NOT NULL DEFAULT '',
  id_type TEXT NOT NULL DEFAULT '',
  nationality TEXT NOT NULL DEFAULT '',
  relation TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  UNIQUE (id, pilot_id)
);
CREATE INDEX passengers_pilot ON passengers (pilot_id);

CREATE TABLE waypoints (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  UNIQUE (id, pilot_id)
);
CREATE INDEX waypoints_pilot ON waypoints (pilot_id);

-- ---------------------------------------------------------------- flights
CREATE TABLE flights (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  block_off TEXT NOT NULL DEFAULT '',
  aircraft_id TEXT,
  taxi_out_min INTEGER,
  taxi_in_min INTEGER,
  fob_l DOUBLE PRECISION,
  route JSONB NOT NULL DEFAULT '[]',
  leg_overrides JSONB NOT NULL DEFAULT '{}',
  atc JSONB,
  baggage_kg JSONB NOT NULL DEFAULT '{}',
  options JSONB NOT NULL DEFAULT '{}',
  summary JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  opened BIGINT NOT NULL DEFAULT 0,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (id, pilot_id),
  FOREIGN KEY (aircraft_id, pilot_id) REFERENCES aircraft(id, pilot_id) ON DELETE SET NULL (aircraft_id)
);
CREATE INDEX flights_pilot ON flights (pilot_id, deleted);

-- The manifest. PIC = the pilot (passenger_id NULL); PAX reference the passenger list. Every person
-- has a seat (a SeatPosition id of the aircraft, e.g. 'front-left'); one person per seat. The snapshot
-- keeps the details as they were when added, so old forms stay correct after edits.
CREATE TABLE flight_crew (
  flight_id TEXT NOT NULL,
  pilot_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PIC', 'PAX')),
  passenger_id TEXT,
  seat TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  PRIMARY KEY (flight_id, position),
  UNIQUE (flight_id, seat),
  FOREIGN KEY (flight_id, pilot_id) REFERENCES flights(id, pilot_id) ON DELETE CASCADE,
  FOREIGN KEY (passenger_id, pilot_id) REFERENCES passengers(id, pilot_id) ON DELETE SET NULL (passenger_id)
);
CREATE INDEX flight_crew_pilot ON flight_crew (pilot_id);
CREATE INDEX flight_crew_passenger ON flight_crew (passenger_id);

-- ---------------------------------------------------------------- shared reference data (AIRAC)
CREATE TABLE ref_airac (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  effective TEXT NOT NULL,
  current BOOLEAN NOT NULL DEFAULT FALSE,
  loaded BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE ref_aerodromes (
  airac TEXT NOT NULL REFERENCES ref_airac(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  icao TEXT,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  doc JSONB NOT NULL,
  PRIMARY KEY (airac, id)
);
CREATE TABLE ref_runways (
  airac TEXT NOT NULL REFERENCES ref_airac(id) ON DELETE CASCADE,
  aerodrome_id TEXT NOT NULL,
  designator TEXT NOT NULL,
  doc JSONB NOT NULL,
  PRIMARY KEY (airac, aerodrome_id, designator)
);
CREATE TABLE ref_airspaces (
  airac TEXT NOT NULL REFERENCES ref_airac(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  doc JSONB NOT NULL,
  PRIMARY KEY (airac, id)
);
CREATE TABLE ref_fis (
  airac TEXT PRIMARY KEY REFERENCES ref_airac(id) ON DELETE CASCADE,
  doc JSONB NOT NULL
);
-- VFR reporting points
CREATE TABLE ref_waypoints (
  airac TEXT NOT NULL REFERENCES ref_airac(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  chart TEXT NOT NULL,
  doc JSONB NOT NULL,
  PRIMARY KEY (airac, id)
);
CREATE TABLE ref_vfr_routes (
  airac TEXT NOT NULL REFERENCES ref_airac(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  chart TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  doc JSONB NOT NULL,
  PRIMARY KEY (airac, id)
);
CREATE TABLE ref_atc_units (
  airac TEXT NOT NULL REFERENCES ref_airac(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  doc JSONB NOT NULL,
  PRIMARY KEY (airac, id)
);
CREATE TABLE ref_sun (
  airac TEXT NOT NULL REFERENCES ref_airac(id) ON DELETE CASCADE,
  icao TEXT NOT NULL,
  doc JSONB NOT NULL,
  PRIMARY KEY (airac, icao)
);
`;
export default sql;
