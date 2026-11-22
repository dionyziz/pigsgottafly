// Filing through more than one backend (api/_lib/filers/): autorouter, or a fax to the ATS
// reporting office of the departure (api/_lib/filers/fax.ts).
//   flight_filings.fax_to   where a faxed plan went ({number, unit}): its DLA and CNL go to the same number
//   filing_log.via          the backend that acted ('autorouter', 'fax'; NULL: refused before any)
//   fax_log                 every fax sent (or refused by the caps): the sending accounting, as mail_log
//                           is for e-mail. result: pending → sending → delivered | failed; capped; the
//                           provider's id is how its delivery report (webhook or poll) finds the row.
const sql = `
ALTER TABLE flight_filings ADD COLUMN fax_to JSONB;
ALTER TABLE filing_log ADD COLUMN via TEXT;

CREATE TABLE fax_log (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  flight_id TEXT,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_fax_id TEXT,
  recipient TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  pages INTEGER,
  at BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  result TEXT NOT NULL,
  error TEXT,
  detail JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX fax_log_pilot_at ON fax_log (pilot_id, at DESC);
CREATE INDEX fax_log_at ON fax_log (at DESC);
CREATE UNIQUE INDEX fax_log_provider_fax ON fax_log (provider, provider_fax_id) WHERE provider_fax_id IS NOT NULL;
`;
export default sql;
