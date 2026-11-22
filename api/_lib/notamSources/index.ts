// The NOTAM sources configured on this server, in priority order (NOTAM_SOURCES, e.g.
// "autorouter,nms,notamify"; default: every configured one in that order). Each is a NotamSourceDriver
// (types.ts); the briefing route keeps those available to the pilot and the flight, and queries
// them together (multiplex.ts).
import type { Ctx } from '../http.js';
import { autorouterNotamSource } from './autorouter.js';
import { cached, dbNotamCache } from './cache.js';
import { nmsNotamSource } from './nms.js';
import { notamifyNotamSource } from './notamify.js';
import type { NotamSource, NotamSourceDriver } from './types.js';

export const NOTAM_SOURCE_IDS: readonly NotamSource[] = ['autorouter', 'nms', 'notamify'];

/** NOTAM_SOURCES → the order; undefined when unset (every configured source). Unknown names are dropped. */
export function sourceOrderFromEnv(v: string | undefined): NotamSource[] | undefined {
  if (v === undefined || !v.trim()) return undefined;
  const ids = v
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  for (const x of ids)
    if (!NOTAM_SOURCE_IDS.includes(x as NotamSource)) console.warn(`NOTAM_SOURCES: unknown source ${x}`);
  return [...new Set(ids.filter((x): x is NotamSource => NOTAM_SOURCE_IDS.includes(x as NotamSource)))];
}

/**
 * The configured sources for this request, in priority order: autorouter when the server has the account
 * (its driver applies the pilot gate), the international feed (NMS) with NMS_CLIENT_ID/SECRET, Notamify
 * with NOTAMIFY_API_KEY. `refresh`: past the source caches.
 */
export function configuredSources(
  ctx: Pick<Ctx, 'db' | 'config' | 'autorouter' | 'autorouterLinked' | 'autorouterDenied'>,
  refresh: boolean,
): NotamSourceDriver[] {
  const store = dbNotamCache(ctx.db);
  const all: Partial<Record<NotamSource, NotamSourceDriver>> = {};
  if (ctx.autorouter || ctx.autorouterDenied)
    all.autorouter = autorouterNotamSource(ctx.autorouter, ctx.autorouterLinked);
  if (ctx.config.nms) all.nms = nmsNotamSource(ctx.config.nms);
  if (ctx.config.notamify) all.notamify = notamifyNotamSource(ctx.config.notamify);
  return (ctx.config.notamSources ?? NOTAM_SOURCE_IDS)
    .map((id) => all[id])
    .filter((d): d is NotamSourceDriver => !!d)
    .map((d) => cached(d, store, { refresh }));
}
