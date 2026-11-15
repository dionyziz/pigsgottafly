// Numbered migrations, applied in order and recorded in schema_migrations. Used by the local
// server, the tests and production (the Vercel function runs pending migrations on cold start,
// before serving). Safe under concurrency: a session-level advisory lock serialises runners, and
// each migration runs in its own transaction together with its schema_migrations row.
//
// To add a migration: add api/_lib/migrations/NNN_name.ts (default export: SQL string, or export a
// run function) and list it in MIGRATIONS below. Never edit a migration that has been applied in production.
import type { Db, Queryable } from './db.js';
import schema001 from './migrations/001_schema.js';
import ref002 from './migrations/002_ref_2609.js';
import existingPilots003 from './migrations/003_existing_pilot_data.js';
import { convertLegacyFlights } from './migrations/004_legacy_flights.js';

export interface Migration {
  /** Unique, sortable: 'NNN_name'. */
  name: string;
  /** A SQL script (several statements, no parameters) … */
  sql?: string;
  /** … and/or code, run inside the migration's transaction after the SQL. */
  run?: (q: Queryable) => Promise<void>;
}

// Migrations are TS modules (SQL as a default-exported string) so the Vercel function bundle
// contains them without extra file includes.
export const MIGRATIONS: Migration[] = [
  { name: '001_schema', sql: schema001 },
  { name: '002_ref_2609', sql: ref002 },
  { name: '003_existing_pilot_data', sql: existingPilots003 },
  { name: '004_legacy_flights', run: convertLegacyFlights },
];

const LOCK_KEY = 7243_0001; // arbitrary, constant

async function applied(q: Queryable): Promise<Set<string>> {
  await q.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied BIGINT NOT NULL)`);
  const rows = await q.query<{ name: string }>('SELECT name FROM schema_migrations');
  return new Set(rows.map((r) => r.name));
}

// Runners in this process are serialised per Db too: PGlite is one connection, where a session
// advisory lock is re-entrant and would not exclude a second runner.
const running = new WeakMap<Db, Promise<unknown>>();

/** Applies pending migrations; returns the names applied now. */
export function migrate(db: Db, list: Migration[] = MIGRATIONS): Promise<string[]> {
  const prev = running.get(db) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => migrateLocked(db, list));
  running.set(db, next);
  return next;
}

async function migrateLocked(db: Db, list: Migration[]): Promise<string[]> {
  // fast path (one HTTP round trip on Neon): nothing to do
  try {
    const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
    if (list.every((m) => done.has(m.name))) return [];
  } catch {
    /* table missing: first run */
  }
  return db.session(async (s) => {
    await s.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      const done = await applied(s);
      const now: string[] = [];
      for (const m of list) {
        if (done.has(m.name)) continue;
        await s.exec('BEGIN');
        try {
          if (m.sql) await s.exec(m.sql);
          if (m.run) await m.run(s);
          await s.query('INSERT INTO schema_migrations (name, applied) VALUES ($1, $2)', [m.name, Date.now()]);
          await s.exec('COMMIT');
        } catch (e) {
          await s.exec('ROLLBACK').catch(() => {});
          throw new Error(`migration ${m.name} failed: ${(e as Error).message}`);
        }
        now.push(m.name);
      }
      return now;
    } finally {
      await s.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  });
}
