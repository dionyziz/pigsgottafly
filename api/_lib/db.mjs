// Postgres access. One SQL dialect everywhere:
//   DATABASE_URL=postgres://…  → Neon (serverless HTTP driver), used in production on Vercel
//   anything else              → PGlite, Postgres compiled to WebAssembly and run in-process:
//                                a directory path for local use, or 'memory://' for tests.
// Returns { query(text, params) → rows, close() } with the schema in place.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     google_sub TEXT UNIQUE,
     email TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     picture TEXT NOT NULL DEFAULT '',
     created BIGINT NOT NULL,
     last_login BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS flights (
     id TEXT PRIMARY KEY,
     owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     data JSONB NOT NULL,
     summary JSONB NOT NULL DEFAULT '{}',
     version INTEGER NOT NULL DEFAULT 1,
     created BIGINT NOT NULL,
     updated BIGINT NOT NULL,
     opened BIGINT NOT NULL DEFAULT 0,
     deleted BOOLEAN NOT NULL DEFAULT FALSE)`,
  `CREATE INDEX IF NOT EXISTS flights_owner ON flights (owner, deleted)`,
];

export async function openDb(where = process.env.DATABASE_URL || 'memory://') {
  let query, close;
  if (/^postgres(ql)?:\/\//.test(where)) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(where);
    query = (text, params = []) => sql.query(text, params);
    close = async () => {};
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const pg = await PGlite.create(where);
    query = async (text, params = []) => (await pg.query(text, params)).rows;
    close = () => pg.close();
  }
  for (const s of SCHEMA) await query(s);
  return { query, close };
}
