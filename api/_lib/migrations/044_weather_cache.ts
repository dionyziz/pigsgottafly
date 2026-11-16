// Forecast cache (api/_lib/routes/weatherGrid.ts): Open-Meteo data shared by every pilot, one row per
// (model, endpoint, model run, variable set, location, UTC day). A location is a grid node
// ('38.25,23.75') or an aerodrome ('p:37.936,23.945'). Rows expire once a newer run has replaced
// them (forecast) or after a week (archived forecasts); expired rows are deleted now and then.
//   weather_budget   Open-Meteo calls per UTC day (weighted the way Open-Meteo counts them), against
//                    OPEN_METEO_DAILY_BUDGET.
const sql = `
CREATE TABLE IF NOT EXISTS weather_cache (
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  run BIGINT NOT NULL,
  kind TEXT NOT NULL,
  loc TEXT NOT NULL,
  day TEXT NOT NULL,
  data JSONB,
  fetched BIGINT NOT NULL,
  expires BIGINT NOT NULL,
  PRIMARY KEY (model, endpoint, run, kind, loc, day)
);
CREATE INDEX IF NOT EXISTS weather_cache_expires ON weather_cache (expires);
CREATE TABLE IF NOT EXISTS weather_budget (
  day TEXT PRIMARY KEY,
  calls DOUBLE PRECISION NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0
);
`;
export default sql;
