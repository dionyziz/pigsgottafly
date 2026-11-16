// Postgres access. One SQL dialect everywhere:
//   postgres://… → Neon (@neondatabase/serverless): HTTP for single queries, a WebSocket Pool for
//                  transactions, multi-statement scripts and session-scoped advisory locks.
//   anything else → PGlite (Postgres compiled to WebAssembly, in-process): a directory path for
//                  local use, or 'memory://' for tests.
// openDb() also runs pending migrations (api/_lib/migrate.ts) before returning.

/** Rows come back as plain objects keyed by column name. */
export type Row = Record<string, any>;

export interface Queryable {
  /** One statement with $1… parameters. */
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** A script of several statements, no parameters. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs fn inside BEGIN … COMMIT on one connection (ROLLBACK if it throws). */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Runs fn on one dedicated connection without a transaction (advisory locks). */
  session<T>(fn: (s: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'neon' | 'pglite';
}

export async function connect(where: string): Promise<Db> {
  if (/^postgres(ql)?:\/\//.test(where)) return connectNeon(where);
  return connectPglite(where);
}

/** connect() + migrate(): what the server and the Vercel function use. A failed migration is
 * recorded and e-mailed to the admins (api/_lib/monitor.ts), then rethrown. */
export async function openDb(where: string = process.env.DATABASE_URL || 'memory://'): Promise<Db> {
  const db = await connect(where);
  const { migrateReporting } = await import('./monitor.js');
  await migrateReporting(db);
  return db;
}

async function connectNeon(url: string): Promise<Db> {
  const { neon, neonConfig, Pool } = await import('@neondatabase/serverless');
  if (typeof (globalThis as any).WebSocket === 'function' && !neonConfig.webSocketConstructor) {
    neonConfig.webSocketConstructor = (globalThis as any).WebSocket;
  }
  const sql = neon(url);
  // A pool per call: serverless functions must not keep WebSocket connections across requests.
  async function onClient<T>(fn: (c: Queryable) => Promise<T>, tx: boolean): Promise<T> {
    const pool = new Pool({ connectionString: url, max: 1 });
    const client = await pool.connect();
    const q: Queryable = {
      query: async (text, params = []) => (await client.query(text, params as any[])).rows as any[],
      exec: async (s) => { await client.query(s); },
    };
    try {
      if (tx) await client.query('BEGIN');
      const out = await fn(q);
      if (tx) await client.query('COMMIT');
      return out;
    } catch (e) {
      if (tx) await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
      await pool.end();
    }
  }
  return {
    kind: 'neon',
    query: async (text, params = []) => (await sql.query(text, params as any[])) as any[],
    exec: (s) => onClient((c) => c.exec(s), false),
    transaction: (fn) => onClient(fn, true),
    session: (fn) => onClient(fn, false),
    close: async () => {},
  };
}

async function connectPglite(where: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = await PGlite.create(where);
  const base: Queryable = {
    query: async (text, params = []) => (await pg.query(text, params as any[])).rows as any[],
    exec: async (s) => { await pg.exec(s); },
  };
  return {
    kind: 'pglite',
    ...base,
    transaction: (fn) => pg.transaction((tx) => fn({
      query: async (text, params = []) => (await tx.query(text, params as any[])).rows as any[],
      exec: async (s) => { await tx.exec(s); },
    })) as Promise<any>,
    // PGlite is a single connection: every call already runs on "the" session.
    session: (fn) => fn(base),
    close: () => pg.close(),
  };
}
