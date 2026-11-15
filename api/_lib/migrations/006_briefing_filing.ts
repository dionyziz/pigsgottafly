// NOTAM briefing cache and flight-plan filing (PLAN-v3: NOTAMs, filing via autorouter).
//   flight_notams   the last NOTAM briefing of a flight (cache + what the briefing export prints)
//   flight_filings  the filed flight plan of a flight: provider id, polled status, EOBT, message, addressees
//   filing_log      every filing action of a pilot (file, delay, cancel, refresh), successful or not
// All three are owned by the pilot (pilot_id) and scoped to the session pilot by every query.
const sql: string = String.raw`
CREATE TABLE flight_notams (
  flight_id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL,
  fetched BIGINT NOT NULL,
  params JSONB NOT NULL,
  doc JSONB NOT NULL,
  FOREIGN KEY (flight_id, pilot_id) REFERENCES flights(id, pilot_id) ON DELETE CASCADE
);

CREATE TABLE flight_filings (
  flight_id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'autorouter',
  provider_id TEXT,
  status TEXT NOT NULL,
  eobt BIGINT,
  fpl TEXT NOT NULL,
  addresses JSONB NOT NULL DEFAULT '[]',
  message TEXT NOT NULL DEFAULT '',
  filed BIGINT,
  updated BIGINT NOT NULL,
  polled BIGINT,
  FOREIGN KEY (flight_id, pilot_id) REFERENCES flights(id, pilot_id) ON DELETE CASCADE
);

CREATE TABLE filing_log (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  flight_id TEXT,
  at BIGINT NOT NULL,
  action TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX filing_log_pilot ON filing_log (pilot_id, at DESC);
`;
export default sql;
