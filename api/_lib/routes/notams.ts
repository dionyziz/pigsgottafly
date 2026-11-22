// GET /flights/:id/notams → NotamBriefing (src/shared/briefing.ts).
// Sources (api/_lib/notamSources/): autorouter (Eurocontrol EAD data: the pilot's own linked account on
// any flight they are on, or the app's account for the AUTOROUTER_PILOTS on their own flights) and Notamify (NOTAMIFY_API_KEY, every pilot), in NOTAM_SOURCES
// order. Those available to the pilot on this flight are queried together; their NOTAMs are merged and
// de-duplicated, then assessed for the flight. There is no keyless source that covers Greek NOTAMs
// completely (the FAA NOTAM search refuses automated clients and lacks NOTAMs not marked for
// international dissemination), so without a source the briefing says so ('not-configured') instead
// of showing an incomplete list.
// The last briefing is stored per flight (flight_notams): served again for 10 minutes while the query
// and the pilot's sources are unchanged and every source answered, and as a fallback (with a message)
// when every source fails. A stored briefing is served only to a pilot entitled to every source it came
// from, so autorouter's NOTAMs never reach a pilot it is not for. A flight shared with the pilot
// (access.ts flightFor) is briefed as its owner's: the stored briefing keeps the owner's id.
import type { Notam, NotamBriefing, NotamSourceStatus } from '../../../src/shared/briefing.js';
import { flightFor } from '../access.js';
import { aerodromesNear, flightContext } from '../flightContext.js';
import type { Route } from '../http.js';
import { badRequest } from '../http.js';
import { assessNotams, toNotam } from '../notams.js';
import { configuredSources } from '../notamSources/index.js';
import { gatherNotams } from '../notamSources/multiplex.js';
import type { NotamSource } from '../notamSources/types.js';
import { rateLimit } from '../rateLimit.js';
import { serverTerrain } from '../terrain.js';

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

/** What a stored briefing came from (briefings stored before there were several sources: their one). */
const storedSources = (params: { sources?: unknown } | null, doc: NotamBriefing): NotamSource[] =>
  Array.isArray(params?.sources) ? (params.sources as NotamSource[]) : doc?.source ? [doc.source] : [];

const failures = (st: NotamSourceStatus[]) =>
  st.length === 1 ? (st[0].message ?? 'the NOTAM source failed') : st.map((s) => `${s.label}: ${s.message}`).join('; ');

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/flights/:id/notams',
    autorouter: true,
    async handler(c): Promise<NotamBriefing> {
      const { db, pilot, params, query } = c;
      await rateLimit(db, 'notams', { pilotId: pilot.id });
      const owner = (await flightFor(db, pilot, params.id)).owner.id;
      const refresh = query.get('refresh') === '1';
      const configured = configuredSources(c, refresh);
      // the licensing gate: a source not available here is not queried, nor its stored NOTAMs served
      const sources = configured.filter((d) => d.availableFor({ pilotId: pilot.id, ownerId: owner }));
      const ids = sources.map((d) => d.id);
      const ctx = await flightContext(db, owner, params.id);
      const planned = ctx.altitudesFt.filter(Number.isFinite);
      const maxAltFt =
        numParam(query.get('maxAltFt'), 'maxAltFt', 0, 60000) ??
        (planned.length ? Math.max(...planned) : DEFAULT_MAX_ALT_FT);
      const corridorNm = numParam(query.get('corridorNm'), 'corridorNm', 0, 100) ?? DEFAULT_CORRIDOR_NM;
      const window = { from: ctx.blockOff - MARGIN_MIN * 60e3, to: ctx.blockOn + MARGIN_MIN * 60e3 };
      const locations = [...new Set([...ctx.used.keys(), ...aerodromesNear(ctx, corridorNm), FIR])].slice(
        0,
        MAX_LOCATIONS,
      );
      const p = { maxAltFt, corridorNm, marginMin: MARGIN_MIN };
      // compared as a string: JSONB does not keep key order
      const paramsKey = JSON.stringify({
        ...p,
        window,
        locations,
        route: ctx.route.map((r) => [r.lat, r.lon]),
        alts: ctx.altitudesFt,
        sources: ids,
      });
      const base = { window, params: p, locations };

      if (!sources.length) {
        return {
          ...base,
          status: 'not-configured',
          source: null,
          sources: [],
          fetched: null,
          notams: [],
          relevantCount: 0,
          hiddenCount: 0,
          message: configured.length
            ? 'NOTAMs are not available for this account. Get the NOTAM briefing from AIS before flight.'
            : 'NOTAMs are not available on this server. Get the NOTAM briefing from AIS before flight.',
        };
      }

      const [row] = await db.query<{
        fetched: string;
        params: { key?: string; sources?: unknown; complete?: boolean };
        doc: NotamBriefing;
      }>('SELECT fetched, params, doc FROM flight_notams WHERE flight_id = $1 AND pilot_id = $2', [ctx.id, owner]);
      const cached = row && storedSources(row.params, row.doc).every((s) => ids.includes(s)) ? row : null;
      if (
        cached &&
        cached.params?.key === paramsKey &&
        cached.params.complete !== false &&
        !refresh &&
        Date.now() - Number(cached.fetched) < NOTAM_TTL_MS
      )
        return cached.doc;

      const { notams: merged, statuses } = await gatherNotams(sources, { locations, window });
      const ok = statuses.filter((s) => s.status === 'ok');
      if (!ok.length) {
        const msg = failures(statuses);
        if (cached)
          return {
            ...cached.doc,
            message: `Could not refresh (${msg}); showing the briefing fetched at ${new Date(Number(cached.fetched)).toISOString().slice(0, 16).replace('T', ' ')}Z.`,
          };
        return {
          ...base,
          status: 'error',
          source: ids[0],
          sources: statuses,
          fetched: null,
          notams: [],
          relevantCount: 0,
          hiddenCount: 0,
          message: msg,
        };
      }
      const assessed = assessNotams(
        merged.map((m) => toNotam(m.notam, m.sources)).filter((n): n is Notam => !!n),
        {
          route: ctx.route,
          aerodromes: ctx.used,
          window,
          maxAltFt,
          corridorNm,
          legAltFt: ctx.altitudesFt,
          fields: ctx.route.filter((p) => p.kind === 'aerodrome'),
          terrain: serverTerrain(),
        },
      );
      const relevantCount = assessed.filter((n) => n.relevant).length;
      const fetched = Date.now();
      const doc: NotamBriefing = {
        ...base,
        status: 'ok',
        source: ok[0].id,
        sources: statuses,
        fetched,
        notams: assessed,
        relevantCount,
        hiddenCount: assessed.length - relevantCount,
        message: ctx.timed ? null : 'Block start time not set: NOTAMs for the whole day are shown.',
      };
      await db.query(
        `INSERT INTO flight_notams (flight_id, pilot_id, fetched, params, doc) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         ON CONFLICT (flight_id) DO UPDATE SET fetched = EXCLUDED.fetched, params = EXCLUDED.params, doc = EXCLUDED.doc
         WHERE flight_notams.pilot_id = EXCLUDED.pilot_id`,
        [
          ctx.id,
          owner,
          fetched,
          JSON.stringify({ key: paramsKey, sources: ids, complete: ok.length === statuses.length }),
          JSON.stringify(doc),
        ],
      );
      return doc;
    },
  },
];
