// Flight-plan filing through autorouter (FilingState etc. in src/shared/briefing.ts):
//   GET  /flights/:id/filing                 state: enabled?, proposed AFTN addressees, filed plan, log
//   POST /flights/:id/filing                 { fpl, addresses, eobt? } → file
//   POST /flights/:id/filing/delay           { eobt }
//   POST /flights/:id/filing/cancel          { reason }
//   POST /flights/:id/filing/refresh         poll the status
//   GET  /filing/log                         the pilot's filing actions
// Filing stays disabled ("filing not enabled yet", 503 on the actions) until the deployment sets
// AUTOROUTER_EMAIL / AUTOROUTER_PASSWORD and AUTOROUTER_FILING=1 (API access granted). Every action,
// refused or not, is logged for the pilot.
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, newId } from '../http.js';
import type { Queryable } from '../db.js';
import type { AutorouterClient } from '../autorouter.js';
import { AutorouterError } from '../autorouter.js';
import type { FilingLogEntry, FilingRecord, FilingState, FilingStatus } from '../../../src/shared/briefing.js';
import { generateAddressees } from '../addressees.js';
import { flightContext } from '../flightContext.js';

const STATUSES = new Set<FilingStatus>(['created', 'filed', 'manual_correction', 'suspended', 'departed', 'terminated', 'arriving', 'arrived', 'closed', 'cancelled', 'rejected']);
/** Plans in these states can no longer be delayed or cancelled. */
const FINAL = new Set<FilingStatus>(['closed', 'cancelled', 'rejected', 'arrived']);

export function filingAvailability(ar: AutorouterClient | null): { enabled: boolean; reason: string | null } {
  if (!ar) return { enabled: false, reason: 'Filing is not enabled yet: autorouter API access has been requested and is not configured on this server.' };
  if (!ar.filingEnabled) return { enabled: false, reason: 'Filing is not enabled yet: waiting for autorouter to grant API access for filing.' };
  return { enabled: true, reason: null };
}

const toStatus = (s: string): FilingStatus => (STATUSES.has(s as FilingStatus) ? (s as FilingStatus) : 'unknown');

function toRecord(r: Record<string, any>): FilingRecord {
  return {
    provider: 'autorouter', providerId: r.provider_id ?? null, status: toStatus(r.status), eobt: r.eobt == null ? null : Number(r.eobt),
    fpl: r.fpl, addresses: r.addresses ?? [], message: r.message ?? '', filed: r.filed == null ? null : Number(r.filed),
    updated: Number(r.updated), polled: r.polled == null ? null : Number(r.polled),
  };
}
const toLog = (r: Record<string, any>): FilingLogEntry => ({ id: r.id, flightId: r.flight_id ?? null, at: Number(r.at), action: r.action, ok: !!r.ok, message: r.message });

async function log(db: Queryable, pilotId: string, flightId: string, action: FilingLogEntry['action'], ok: boolean, message: string, detail: unknown = {}) {
  await db.query('INSERT INTO filing_log (id, pilot_id, flight_id, at, action, ok, message, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [await newId('fg'), pilotId, flightId, Date.now(), action, ok, message.slice(0, 1000), JSON.stringify(detail)]);
}

async function record(db: Queryable, pilotId: string, flightId: string): Promise<FilingRecord | null> {
  const [r] = await db.query('SELECT * FROM flight_filings WHERE flight_id = $1 AND pilot_id = $2', [flightId, pilotId]);
  return r ? toRecord(r) : null;
}

async function state(db: Queryable, pilotId: string, flightId: string, ar: AutorouterClient | null): Promise<FilingState> {
  const ctx = await flightContext(db, pilotId, flightId);
  const addressees = generateAddressees({
    route: ctx.route, altitudesFt: ctx.altitudesFt, alternates: ctx.alternates,
    aerodromes: ctx.ref.aerodromes, airspaces: ctx.ref.airspaces, fis: ctx.ref.fis,
  });
  const rows = await db.query('SELECT * FROM filing_log WHERE pilot_id = $1 AND flight_id = $2 ORDER BY at DESC, id DESC LIMIT 50', [pilotId, flightId]);
  return { ...filingAvailability(ar), addressees, filing: await record(db, pilotId, flightId), log: rows.map(toLog) };
}

/** The action is refused (and logged) unless filing is enabled. */
async function requireEnabled(db: Queryable, pilotId: string, flightId: string, action: FilingLogEntry['action'], ar: AutorouterClient | null): Promise<AutorouterClient> {
  await flightContext(db, pilotId, flightId); // 404 for someone else's flight, before anything is logged
  const a = filingAvailability(ar);
  if (!a.enabled || !ar) {
    await log(db, pilotId, flightId, action, false, a.reason!);
    throw new HttpError(503, a.reason!, { error: a.reason, enabled: false });
  }
  return ar;
}

/** Runs a provider call, logging the outcome; provider errors become 4xx/502 with autorouter's text. */
async function attempt<T>(db: Queryable, pilotId: string, flightId: string, action: FilingLogEntry['action'], fn: () => Promise<T>, okMsg: (r: T) => string, detail: unknown = {}): Promise<T> {
  try {
    const r = await fn();
    await log(db, pilotId, flightId, action, true, okMsg(r), detail);
    return r;
  } catch (e) {
    const msg = e instanceof AutorouterError ? e.message : 'autorouter request failed';
    if (!(e instanceof AutorouterError)) console.warn('filing:', String((e as Error)?.message || e));
    await log(db, pilotId, flightId, action, false, msg, detail);
    throw new HttpError(e instanceof AutorouterError ? e.status : 502, msg);
  }
}

export function checkFpl(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('fpl must be the ICAO FPL message');
  const fpl = v.trim().replace(/\r\n?/g, '\n');
  if (fpl.length > 4000) throw badRequest('fpl is too long');
  if (!/^\(FPL-[A-Z0-9]{2,7}-[\s\S]+\)$/.test(fpl)) throw badRequest('fpl must be an ICAO message: (FPL-…)');
  if (!/^[A-Z0-9 \n()\-/.:+,]*$/.test(fpl)) throw badRequest('fpl contains characters AFTN cannot carry');
  return fpl;
}
export function checkAddresses(v: unknown): string[] {
  if (!Array.isArray(v)) throw badRequest('addresses must be an array');
  if (v.length > 50) throw badRequest('too many addresses');
  const out = v.map((a) => {
    const s = typeof a === 'string' ? a.trim().toUpperCase() : '';
    if (!/^[A-Z]{8}$/.test(s)) throw badRequest(`invalid AFTN address: ${String(a).slice(0, 20)}`);
    return s;
  });
  return [...new Set(out)];
}
function checkEobt(v: unknown, field = 'eobt'): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest(`${field} must be a time (ms since 1970)`);
  const now = Date.now();
  if (v < now - 30 * 60e3 || v > now + 120 * 3600e3) throw badRequest(`${field} must be between now and 5 days ahead`);
  return v;
}

export const routes: Route[] = [
  { method: 'GET', path: '/flights/:id/filing', handler: async ({ db, pilot, params, autorouter }) => state(db, pilot.id, params.id, autorouter) },
  {
    method: 'POST', path: '/flights/:id/filing',
    async handler({ db, pilot, params, body, autorouter }) {
      const ar = await requireEnabled(db, pilot.id, params.id, 'file', autorouter);
      const input = await body();
      const fpl = checkFpl(input.fpl);
      const addresses = checkAddresses(input.addresses ?? []);
      let eobt: number;
      if (input.eobt !== undefined) eobt = checkEobt(input.eobt);
      else {
        const ctx = await flightContext(db, pilot.id, params.id);
        if (!ctx.timed) throw badRequest('set the block-off time first');
        eobt = checkEobt(ctx.blockOff, 'the flight’s block-off time');
      }
      const cur = await record(db, pilot.id, params.id);
      if (cur && cur.providerId && !FINAL.has(cur.status)) throw conflict('this flight already has a filed plan: delay or cancel it');
      const filed = await attempt(db, pilot.id, params.id, 'file', () => ar.file(fpl, addresses),
        (r) => (r.queued ? `queued for manual correction (id ${r.providerId})` : `filed (id ${r.providerId})`), { addresses, eobt });
      const now = Date.now();
      await db.query(
        `INSERT INTO flight_filings (flight_id, pilot_id, provider, provider_id, status, eobt, fpl, addresses, message, filed, updated, polled)
         VALUES ($1,$2,'autorouter',$3,$4,$5,$6,$7::jsonb,'',$8,$8,NULL)
         ON CONFLICT (flight_id) DO UPDATE SET provider_id = EXCLUDED.provider_id, status = EXCLUDED.status, eobt = EXCLUDED.eobt, fpl = EXCLUDED.fpl,
           addresses = EXCLUDED.addresses, message = '', filed = EXCLUDED.filed, updated = EXCLUDED.updated, polled = NULL
         WHERE flight_filings.pilot_id = EXCLUDED.pilot_id`,
        [params.id, pilot.id, filed.providerId, filed.queued ? 'manual_correction' : 'filed', eobt, fpl, JSON.stringify(addresses), now]);
      return state(db, pilot.id, params.id, autorouter);
    },
  },
  {
    method: 'POST', path: '/flights/:id/filing/delay',
    async handler({ db, pilot, params, body, autorouter }) {
      const ar = await requireEnabled(db, pilot.id, params.id, 'delay', autorouter);
      const eobt = checkEobt((await body()).eobt);
      const cur = await record(db, pilot.id, params.id);
      if (!cur?.providerId || FINAL.has(cur.status)) throw conflict('no open filed plan to delay');
      await attempt(db, pilot.id, params.id, 'delay', () => ar.delay(cur.providerId!, eobt), () => `delayed to ${new Date(eobt).toISOString().slice(11, 16)}Z`, { eobt });
      await db.query('UPDATE flight_filings SET eobt = $3, message = \'\', updated = $4 WHERE flight_id = $1 AND pilot_id = $2', [params.id, pilot.id, eobt, Date.now()]);
      return state(db, pilot.id, params.id, autorouter);
    },
  },
  {
    method: 'POST', path: '/flights/:id/filing/cancel',
    async handler({ db, pilot, params, body, autorouter }) {
      const ar = await requireEnabled(db, pilot.id, params.id, 'cancel', autorouter);
      const input = await body();
      const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 200) : 'Cancelled by the pilot';
      const cur = await record(db, pilot.id, params.id);
      if (!cur?.providerId || FINAL.has(cur.status)) throw conflict('no open filed plan to cancel');
      await attempt(db, pilot.id, params.id, 'cancel', () => ar.cancel(cur.providerId!, reason), () => 'cancelled', { reason });
      await db.query('UPDATE flight_filings SET status = \'cancelled\', message = $3, updated = $4 WHERE flight_id = $1 AND pilot_id = $2', [params.id, pilot.id, reason, Date.now()]);
      return state(db, pilot.id, params.id, autorouter);
    },
  },
  {
    method: 'POST', path: '/flights/:id/filing/refresh',
    async handler({ db, pilot, params, autorouter }) {
      const ar = await requireEnabled(db, pilot.id, params.id, 'refresh', autorouter);
      const cur = await record(db, pilot.id, params.id);
      if (!cur?.providerId) throw conflict('this flight has no filed plan');
      const s = await attempt(db, pilot.id, params.id, 'refresh', () => ar.status(cur.providerId!), (r) => `status ${r.status}`);
      const now = Date.now();
      await db.query('UPDATE flight_filings SET status = $3, eobt = COALESCE($4, eobt), polled = $5, updated = $5 WHERE flight_id = $1 AND pilot_id = $2',
        [params.id, pilot.id, toStatus(s.status), s.eobt, now]);
      return state(db, pilot.id, params.id, autorouter);
    },
  },
  {
    method: 'GET', path: '/filing/log',
    async handler({ db, pilot }): Promise<FilingLogEntry[]> {
      const rows = await db.query('SELECT * FROM filing_log WHERE pilot_id = $1 ORDER BY at DESC, id DESC LIMIT 200', [pilot.id]);
      return rows.map(toLog);
    },
  },
];
