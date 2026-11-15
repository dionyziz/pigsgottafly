// GET /flights/:id/notams → NotamBriefing (src/shared/briefing.ts).
// Source: the autorouter NOTAM API (Eurocontrol EAD data) with the app's account. There is no keyless
// source that covers Greek NOTAMs completely (the FAA NOTAM search refuses automated clients and
// lacks NOTAMs not marked for international dissemination), so without autorouter credentials the
// briefing says so ('not-configured') instead of showing an incomplete list.
// The last briefing is stored per flight (flight_notams): served again for 10 minutes while the
// query is unchanged, and as a fallback (with a message) when the source fails.
import { rateLimit } from '../rateLimit.js';
import type { Route } from '../http.js';
import { badRequest } from '../http.js';
import type { Notam, NotamBriefing } from '../../../src/shared/briefing.js';
import { AutorouterError } from '../autorouter.js';
import { aerodromesNear, flightContext } from '../flightContext.js';
import { assessNotams, normalizeNotam } from '../notams.js';

export const NOTAM_TTL_MS = 10 * 60e3;
export const DEFAULT_CORRIDOR_NM = 10;
export const DEFAULT_MAX_ALT_FT = 10000;
export const MARGIN_MIN = 60;
const FIR = 'LGGG';
const MAX_LOCATIONS = 40;

function numParam(v: string | null, field: string, min: number, max: number): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${field} must be a number in [${min}, ${max}]`);
  return n;
}

export const routes: Route[] = [
  {
    method: 'GET', path: '/flights/:id/notams',
    async handler({ db, pilot, params, query, autorouter, autorouterDenied }): Promise<NotamBriefing> {
      await rateLimit(db, 'notams', { pilotId: pilot.id });
      const ctx = await flightContext(db, pilot.id, params.id);
      const planned = ctx.altitudesFt.filter(Number.isFinite);
      const maxAltFt = numParam(query.get('maxAltFt'), 'maxAltFt', 0, 60000) ?? (planned.length ? Math.max(...planned) : DEFAULT_MAX_ALT_FT);
      const corridorNm = numParam(query.get('corridorNm'), 'corridorNm', 0, 100) ?? DEFAULT_CORRIDOR_NM;
      const window = { from: ctx.blockOff - MARGIN_MIN * 60e3, to: ctx.blockOn + MARGIN_MIN * 60e3 };
      const locations = [...new Set([...ctx.used.keys(), ...aerodromesNear(ctx, corridorNm), FIR])].slice(0, MAX_LOCATIONS);
      const p = { maxAltFt, corridorNm, marginMin: MARGIN_MIN };
      // compared as a string: JSONB does not keep key order
      const paramsKey = JSON.stringify({ ...p, window, locations, route: ctx.route.map((r) => [r.lat, r.lon]) });
      const base = { window, params: p, locations };

      const [cached] = await db.query<{ fetched: string; params: { key?: string }; doc: NotamBriefing }>(
        'SELECT fetched, params, doc FROM flight_notams WHERE flight_id = $1 AND pilot_id = $2', [ctx.id, pilot.id]);
      const sameQuery = cached && cached.params?.key === paramsKey;
      if (sameQuery && query.get('refresh') !== '1' && Date.now() - Number(cached.fetched) < NOTAM_TTL_MS) return cached.doc;

      if (!autorouter) {
        return {
          ...base, status: 'not-configured', source: null, fetched: null, notams: [], relevantCount: 0, hiddenCount: 0,
          message: autorouterDenied
            ? 'NOTAMs are not available for this account: the server’s autorouter NOTAM source is limited to its listed pilots. Get the NOTAM briefing from AIS before flight.'
            : 'NOTAMs are not available yet: the autorouter NOTAM source is not configured (API access pending). Get the NOTAM briefing from AIS before flight.',
        };
      }
      let notams: Notam[];
      try {
        const rows = await autorouter.notams(locations, window.from, window.to);
        notams = rows.map(normalizeNotam).filter((n): n is Notam => !!n);
      } catch (e) {
        const msg = e instanceof AutorouterError ? e.message : 'the NOTAM source failed';
        if (!(e instanceof AutorouterError)) console.warn('notams:', String((e as Error)?.message || e));
        if (cached) return { ...cached.doc, message: `Could not refresh (${msg}); showing the briefing fetched at ${new Date(Number(cached.fetched)).toISOString().slice(0, 16).replace('T', ' ')}Z.` };
        return { ...base, status: 'error', source: 'autorouter', fetched: null, notams: [], relevantCount: 0, hiddenCount: 0, message: msg };
      }
      // a replaced NOTAM may appear next to its replacement: keep the newest of each key
      const byKey = new Map<string, Notam>();
      for (const n of notams) byKey.set(n.key, n);
      const assessed = assessNotams([...byKey.values()], { route: ctx.route, aerodromes: ctx.used, window, maxAltFt, corridorNm });
      const relevantCount = assessed.filter((n) => n.relevant).length;
      const fetched = Date.now();
      const doc: NotamBriefing = {
        ...base, status: 'ok', source: 'autorouter', fetched, notams: assessed, relevantCount, hiddenCount: assessed.length - relevantCount,
        message: ctx.timed ? null : 'Block-off time not set: NOTAMs for the whole day are shown.',
      };
      await db.query(
        `INSERT INTO flight_notams (flight_id, pilot_id, fetched, params, doc) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         ON CONFLICT (flight_id) DO UPDATE SET fetched = EXCLUDED.fetched, params = EXCLUDED.params, doc = EXCLUDED.doc
         WHERE flight_notams.pilot_id = EXCLUDED.pilot_id`,
        [ctx.id, pilot.id, fetched, JSON.stringify({ key: paramsKey }), JSON.stringify(doc)]);
      return doc;
    },
  },
];
