// One-off: copy flights from the old SQLite database (server/navlog.db) into Postgres,
// owned by the pilot with the given email. That pilot must have signed in once first.
//
//   DATABASE_URL=postgres://… node tools/migrate_sqlite.mjs you@gmail.com [server/navlog.db]
// Flights already present (same id) are left alone, so it is safe to run twice.
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../api/_lib/db.mjs';

const [email, file = 'server/navlog.db'] = process.argv.slice(2);
if (!email || !process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=postgres://… node tools/migrate_sqlite.mjs EMAIL [navlog.db]'); process.exit(1); }
const db = await openDb(process.env.DATABASE_URL);
const users = await db.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
if (users.length !== 1) { console.error(`${email}: ${users.length ? 'more than one account' : 'no account yet; sign in once first'}`); process.exit(1); }
const src = new DatabaseSync(file, { readOnly: true });
let n = 0;
for (const r of src.prepare('SELECT * FROM flights').all()) {
  const out = await db.query(`INSERT INTO flights (id, owner, data, summary, version, created, updated, opened, deleted)
                              VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [r.id, users[0].id, r.data, r.summary, r.version, r.created, r.updated, r.opened, !!r.deleted]);
  n += out.length;
}
console.log(`copied ${n} flight(s) to ${email}`);
await db.close();
