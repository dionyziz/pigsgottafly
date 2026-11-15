// Shared reference data (read-only, current AIRAC): GET /ref/airac, /ref/bundle, /ref/<kind>.
// Owned by the data agent from here on (declared distances, slopes, new AIRACs).
import type { Route } from '../http.js';
import { notFound } from '../http.js';
import type { Queryable } from '../db.js';
import type { RefAerodrome, RefAirac, RefBundle } from '../../../src/shared/ref.js';

async function current(db: Queryable): Promise<RefAirac> {
  const [r] = await db.query('SELECT id, name, effective FROM ref_airac WHERE current LIMIT 1');
  if (!r) throw notFound('no reference data loaded');
  return { id: r.id, name: r.name, effective: r.effective };
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

async function docs(db: Queryable, kind: keyof typeof TABLES | string, airac: string) {
  if (!Object.hasOwn(TABLES, kind)) throw notFound();
  const t = TABLES[kind];
  return (await db.query(`SELECT doc FROM ${t.table} WHERE airac = $1 ORDER BY ${t.order}`, [airac])).map((r) => r.doc);
}

/** Aerodrome by id or ICAO in the current AIRAC, or null. */
export async function findAerodrome(db: Queryable, idOrIcao: string): Promise<RefAerodrome | null> {
  const [r] = await db.query(
    `SELECT a.doc FROM ref_aerodromes a JOIN ref_airac c ON c.id = a.airac AND c.current WHERE a.id = $1 OR a.icao = $1 LIMIT 1`,
    [idOrIcao.toUpperCase()]);
  return r ? (r.doc as RefAerodrome) : null;
}

export const routes: Route[] = [
  { method: 'GET', path: '/ref/airac', handler: async ({ db }) => current(db) },
  {
    method: 'GET', path: '/ref/bundle',
    async handler({ db }): Promise<RefBundle> {
      const airac = await current(db);
      const [fis] = await db.query('SELECT doc FROM ref_fis WHERE airac = $1', [airac.id]);
      return {
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
    },
  },
  {
    method: 'GET', path: '/ref/fis',
    async handler({ db }) {
      const airac = await current(db);
      const [fis] = await db.query('SELECT doc FROM ref_fis WHERE airac = $1', [airac.id]);
      if (!fis) throw notFound();
      return fis.doc;
    },
  },
  {
    method: 'GET', path: '/ref/:kind',
    async handler({ db, params }) {
      if (!Object.hasOwn(TABLES, params.kind)) throw notFound();
      return docs(db, params.kind, (await current(db)).id);
    },
  },
];
