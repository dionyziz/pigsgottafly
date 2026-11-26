// Shared reference data (read-only, airac.ts): GET /ref/airac (in effect today), /ref/cycles (today's and the
// ones loaded after it: a flight uses the one in effect on its date), /ref/bundle, /ref/<kind>.
// /ref/bundle: today's cycle, or ?airac=<id> (one of /ref/cycles) or ?date=YYYY-MM-DD (the cycle in effect then);
// ETag by AIRAC, Cache-Control private, today's kept a day at most and never past the next loaded cycle's
// effective date (a chosen cycle's records do not change with the date: a day), 304 on If-None-Match; the full
// bundle and /ref/<kind> are rate-limited per pilot (rateLimit.ts).
import { airacInEffect, airacOn, airacsFromToday, nextAirac } from '../airac.js';
import type { Route } from '../http.js';
import { badRequest, notFound, reply } from '../http.js';
import { rateLimit } from '../rateLimit.js';

/** Bumped when the bundle's shape changes (part of its ETag). */
const BUNDLE_FORMAT = 1;
import type { RefAerodrome, RefAirac, RefBundle } from '../../../src/shared/ref.js';
import type { Queryable } from '../db.js';

async function current(db: Queryable): Promise<RefAirac> {
  const r = await airacInEffect(db);
  if (!r) throw notFound('no reference data loaded');
  return { id: r.id, name: r.name, effective: r.effective };
}

/** Seconds a client may keep the bundle: a day, but not past 0000 UTC of the next loaded cycle's date. */
async function bundleMaxAge(db: Queryable, now = Date.now()): Promise<number> {
  const next = await nextAirac(db, now);
  const until = next ? Math.floor((Date.parse(next.effective + 'T00:00:00Z') - now) / 1000) : Infinity;
  return Math.max(0, Math.min(86400, until));
}

const TABLES: Record<string, { table: string; order: string }> = {
  aerodromes: { table: 'ref_aerodromes', order: 'id' },
  runways: { table: 'ref_runways', order: 'aerodrome_id, designator' },
  airspaces: { table: 'ref_airspaces', order: 'id' },
  'vfr-points': { table: 'ref_waypoints', order: 'chart, name, id' },
  'vfr-routes': { table: 'ref_vfr_routes', order: 'id' },
  'atc-units': { table: 'ref_atc_units', order: 'id' },
  areas: { table: 'ref_areas', order: 'id' },
};

async function docs(db: Queryable, kind: keyof typeof TABLES, airac: string) {
  if (!Object.hasOwn(TABLES, kind)) throw notFound();
  const t = TABLES[kind];
  return (await db.query(`SELECT doc FROM ${t.table} WHERE airac = $1 ORDER BY ${t.order}`, [airac])).map((r) => r.doc);
}

/** The cycle a bundle request asks for: ?airac=<id>, else ?date=YYYY-MM-DD, else today's. */
async function requested(db: Queryable, query: URLSearchParams): Promise<{ airac: RefAirac; chosen: boolean }> {
  const id = query.get('airac');
  const date = query.get('date');
  if (id) {
    const [r] = await db.query<RefAirac>('SELECT id, name, effective FROM ref_airac WHERE id = $1', [id]);
    if (!r) throw notFound('no such AIRAC cycle loaded');
    return { airac: { id: r.id, name: r.name, effective: r.effective }, chosen: true };
  }
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('date must be YYYY-MM-DD');
    const r = await airacOn(db, date);
    if (!r) throw notFound('no reference data loaded');
    return { airac: { id: r.id, name: r.name, effective: r.effective }, chosen: true };
  }
  return { airac: await current(db), chosen: false };
}

/** An aerodrome in the cycle in effect on `day` (a flight's date), else today's. */
export async function findAerodrome(db: Queryable, idOrIcao: string, day?: string): Promise<RefAerodrome | null> {
  const airac = day ? await airacOn(db, day) : await current(db);
  const [r] = await db.query(`SELECT doc FROM ref_aerodromes WHERE airac = $2 AND (id = $1 OR icao = $1) LIMIT 1`, [
    idOrIcao.toUpperCase(),
    airac?.id,
  ]);
  return r ? (r.doc as RefAerodrome) : null;
}

export const routes: Route[] = [
  { method: 'GET', path: '/ref/airac', handler: async ({ db }) => current(db) },
  {
    method: 'GET',
    path: '/ref/cycles',
    handler: async ({ db }) =>
      (await airacsFromToday(db)).map((a) => ({ id: a.id, name: a.name, effective: a.effective })),
  },
  {
    method: 'GET',
    path: '/ref/bundle',
    async handler({ db, pilot, req, query }) {
      const { airac, chosen } = await requested(db, query);
      // the bundle changes only with the AIRAC: a client keeps today's until the next cycle can take effect, then
      // revalidates by ETag
      const etag = `"ref-${airac.id}-${BUNDLE_FORMAT}"`;
      const maxAge = chosen ? 86400 : await bundleMaxAge(db);
      const cache = { ETag: etag, 'Cache-Control': `private, max-age=${maxAge}` };
      if (
        String(req.headers['if-none-match'] || '')
          .split(',')
          .map((s) => s.trim().replace(/^W\//, ''))
          .includes(etag)
      )
        return reply(304, undefined, cache);
      await rateLimit(db, 'ref', { pilotId: pilot?.id, req });
      const [fis] = await db.query('SELECT doc FROM ref_fis WHERE airac = $1', [airac.id]);
      const bundle: RefBundle = {
        airac,
        aerodromes: await docs(db, 'aerodromes', airac.id),
        runways: await docs(db, 'runways', airac.id),
        airspaces: await docs(db, 'airspaces', airac.id),
        fis: fis?.doc ?? { units: [], boundary: [], source: '' },
        vfrPoints: await docs(db, 'vfr-points', airac.id),
        vfrRoutes: await docs(db, 'vfr-routes', airac.id),
        atcUnits: await docs(db, 'atc-units', airac.id),
        areas: await docs(db, 'areas', airac.id),
      };
      return reply(200, bundle, cache);
    },
  },
  {
    method: 'GET',
    path: '/ref/fis',
    async handler({ db }) {
      const airac = await current(db);
      const [fis] = await db.query('SELECT doc FROM ref_fis WHERE airac = $1', [airac.id]);
      if (!fis) throw notFound();
      return fis.doc;
    },
  },
  {
    method: 'GET',
    path: '/ref/:kind',
    async handler({ db, params, pilot, req }) {
      if (!Object.hasOwn(TABLES, params.kind)) throw notFound();
      await rateLimit(db, 'ref', { pilotId: pilot?.id, req });
      return docs(db, params.kind, (await current(db)).id);
    },
  },
];
