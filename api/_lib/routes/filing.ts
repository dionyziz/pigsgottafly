// Flight-plan filing through the filing backends (api/_lib/filers/: autorouter, fax; FilingState etc.
// in src/shared/briefing.ts):
//   GET  /flights/:id/filing                 state: the backends, proposed AFTN addressees, filed plan, log
//   POST /flights/:id/filing                 { fpl, addresses, eobt?, copyTo?, via? } → file
//   POST /flights/:id/filing/delay           { eobt }
//   POST /flights/:id/filing/cancel          { reason }
//   POST /flights/:id/filing/refresh         poll the status
//   GET  /filing/log                         the pilot's filing actions
//   POST /filing/fax/webhook/:provider       the fax service's delivery report (signed; no session)
// A plan is filed through the first backend available for the pilot and flight (FILERS order); a
// transient failure falls through to the next (filers/select.ts). The record keeps the backend that
// filed it: its delay, cancellation and status go to that one. Filing is disabled (503 on the
// actions, with the reason) when no backend is available. Every action, refused or not, is logged
// for the pilot, with the backend that acted.
// Backends send real ATC messages in the pilot's name from the deployment's accounts, so:
//   - autorouter only for the pilots on AUTOROUTER_PILOTS, fax only for those on FAX_PILOTS (app.ts);
//   - the plan's aircraft identification (item 7) and REG/ (item 18) must be the registration of
//     the flight's aircraft, which is in the pilot's own hangar.
import type {
  FilerId,
  FilingLogEntry,
  FilingRecord,
  FilingState,
  FplCopyRecipient,
} from '../../../src/shared/briefing.js';
import type { FaxDestination } from '../../../src/shared/fax.js';
import type { Pilot } from '../../../src/shared/types.js';
import { flightFor } from '../access.js';
import { generateAddressees } from '../addressees.js';
import type { Queryable, Row } from '../db.js';
import { applyDelivery } from '../filers/fax.js';
import { FaxSignatureError } from '../filers/faxProviders.js';
import { filerInfos, withFallback } from '../filers/select.js';
import { FINAL, toStatus } from '../filers/status.js';
import { type FiledRef, type FileOutcome, type Filer, FilerError } from '../filers/types.js';
import { type FlightContext, flightContext } from '../flightContext.js';
import { type CopyKind, copyRecipients, fplCopyMail } from '../fplCopy.js';
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, newId, reply } from '../http.js';
import { mailAvailability, sendMail, sendSystemMail } from '../mail.js';
import { sendLogged } from '../sendCaps.js';

/** Longest FPL message accepted (an AFTN message is far shorter). */
const MAX_FPL_CHARS = 4000;
const MAX_ADDRESSES = 50;
/** An EOBT may be this far in the past (a late delay)… */
const EOBT_PAST_MS = 30 * 60e3;
/** …and at most this far ahead (5 days). */
const EOBT_AHEAD_MS = 120 * 3600e3;

const UNKNOWN_CAPS = { file: false, delay: false, cancel: false, status: false, ackRej: false };

function toRecord(r: Row, filers: Filer[]): FilingRecord {
  const provider = r.provider === 'fax' ? 'fax' : 'autorouter';
  const f = filers.find((x) => x.id === provider);
  const faxTo = (r.fax_to ?? null) as FaxDestination | null;
  return {
    provider,
    providerLabel: provider === 'fax' ? `Fax to ${faxTo?.unit ?? 'ATS'}` : 'autorouter',
    capabilities:
      f?.capabilities ??
      (provider === 'fax' ? { ...UNKNOWN_CAPS, file: true, delay: true, cancel: true, status: true } : UNKNOWN_CAPS),
    providerId: r.provider_id ?? null,
    faxTo,
    status: toStatus(r.status),
    eobt: r.eobt == null ? null : Number(r.eobt),
    fpl: r.fpl,
    addresses: r.addresses ?? [],
    message: r.message ?? '',
    filed: r.filed == null ? null : Number(r.filed),
    updated: Number(r.updated),
    polled: r.polled == null ? null : Number(r.polled),
  };
}
const toLog = (r: Row): FilingLogEntry => ({
  id: r.id,
  flightId: r.flight_id ?? null,
  at: Number(r.at),
  action: r.action,
  via: r.via ?? null,
  ok: !!r.ok,
  message: r.message,
});

async function log(
  db: Queryable,
  pilotId: string,
  flightId: string,
  action: FilingLogEntry['action'],
  ok: boolean,
  message: string,
  detail: unknown = {},
  via: FilerId | null = null,
) {
  await db.query(
    'INSERT INTO filing_log (id, pilot_id, flight_id, at, action, ok, message, detail, via) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
    [await newId('fg'), pilotId, flightId, Date.now(), action, ok, message.slice(0, 1000), JSON.stringify(detail), via],
  );
}

async function recordRow(db: Queryable, pilotId: string, flightId: string): Promise<Row | null> {
  const [r] = await db.query('SELECT * FROM flight_filings WHERE flight_id = $1 AND pilot_id = $2', [
    flightId,
    pilotId,
  ]);
  return r ?? null;
}

/** The aerodromes of the route (departure, stops, destination), not the alternates. */
const routeIcaos = (ctx: FlightContext) =>
  [...ctx.used].filter(([, role]) => role !== 'alternate').map(([icao]) => icao);
const departure = (ctx: FlightContext) => [...ctx.used].find(([, role]) => role.startsWith('departure'))?.[0] ?? '';

const copyTo = (db: Queryable, pilotId: string, flightId: string, ctx: FlightContext): Promise<FplCopyRecipient[]> =>
  copyRecipients(db, pilotId, flightId, routeIcaos(ctx));

/**
 * E-mails a copy of what was just transmitted (the plan, its delay or cancellation): to those who
 * ask for one with the pilot in cc, else to the pilot alone (the services' own notices go to the
 * app's accounts, not to the pilot). Logged as 'copy'; a failure never undoes the action.
 */
async function sendCopy(
  db: Queryable,
  filer: Filer,
  pilot: Pilot,
  flightId: string,
  kind: CopyKind,
  plan: { providerId: string; fpl: string; addresses: string[]; faxTo: FaxDestination | null; message: string },
  /** The copies the pilot left ticked (out of copyTo); undefined = all of them. */
  chosen?: string[],
): Promise<void> {
  const ctx = await flightContext(db, pilot.id, flightId);
  const pilotEmail = String(pilot.email || '').trim();
  const wanted = chosen && new Set(chosen.map((e) => e.toLowerCase()));
  const others = (await copyTo(db, pilot.id, flightId, ctx))
    .map((r) => r.email)
    .filter((e) => !wanted || wanted.has(e.toLowerCase()));
  const emails = others.length ? others : pilotEmail ? [pilotEmail] : [];
  const at = Date.now();
  const sent = await filer.transmitted(plan, plan.message).catch(() => []);
  if (!emails.length) return;
  const { subject, text } = fplCopyMail({ kind, sent, fpl: plan.fpl, addresses: plan.addresses, at, via: filer.id });
  const mail = mailAvailability();
  const refused = !mail.enabled ? mail.reason! : !pilotEmail ? 'your account has no e-mail address to copy' : null;
  if (refused)
    return log(db, pilot.id, flightId, 'copy', false, `Copy not e-mailed: ${refused}`, { to: emails }, filer.id);
  try {
    await sendLogged(
      db,
      { pilotId: pilot.id, flightId, form: 'fpl-copy', recipient: emails.join(', '), subject },
      () =>
        others.length
          ? sendMail({ to: emails, pilotEmail, subject, text })
          : sendSystemMail({ to: emails, subject, text }),
    );
    await log(db, pilot.id, flightId, 'copy', true, `Copy e-mailed to ${emails.join(', ')}`, { to: emails }, filer.id);
  } catch (e) {
    const msg = String(((e as { cause?: Error })?.cause ?? (e as Error))?.message || e);
    await log(db, pilot.id, flightId, 'copy', false, `Copy not e-mailed: ${msg}`, { to: emails }, filer.id);
  }
}

async function state(
  db: Queryable,
  pilot: Pilot,
  ownerId: string,
  flightId: string,
  filers: Filer[],
  notOwner = false,
): Promise<FilingState> {
  const ctx = await flightContext(db, ownerId, flightId);
  const addressees = generateAddressees({
    route: ctx.route,
    altitudesFt: ctx.altitudesFt,
    alternates: ctx.alternates,
    aerodromes: ctx.ref.aerodromes,
    airspaces: ctx.ref.airspaces,
    fis: ctx.ref.fis,
  });
  const rows = await db.query(
    'SELECT * FROM filing_log WHERE pilot_id = $1 AND flight_id = $2 ORDER BY at DESC, id DESC LIMIT 50',
    [ownerId, flightId],
  );
  const infos = filerInfos(filers, pilot, departure(ctx));
  const first = infos.find((f) => f.available);
  const rec = await recordRow(db, ownerId, flightId);
  return {
    ...(notOwner
      ? { enabled: false, reason: 'Only the flight’s owner files its flight plan.' }
      : first
        ? { enabled: true, reason: null }
        : { enabled: false, reason: infos.find((f) => f.reason)?.reason ?? 'Filing is not available on this server.' }),
    filers: infos,
    addressees,
    copyTo: await copyTo(db, ownerId, flightId, ctx),
    filing: rec ? toRecord(rec, filers) : null,
    log: rows.map(toLog),
  };
}

/** Refuses (and logs) with 503 and the reason. */
async function refuse(db: Queryable, pilotId: string, flightId: string, action: FilingLogEntry['action'], why: string) {
  await log(db, pilotId, flightId, action, false, why);
  return new HttpError(503, why, { error: why, enabled: false });
}

/**
 * The backend that filed the flight's plan, for its delay, cancellation and status: refused (and
 * logged) when it is not available to this pilot any more.
 */
async function filerOf(
  db: Queryable,
  pilot: Pilot,
  flightId: string,
  action: FilingLogEntry['action'],
  filers: Filer[],
  rec: Row,
): Promise<Filer> {
  const ctx = await flightContext(db, pilot.id, flightId);
  const f = filers.find((x) => x.id === rec.provider);
  const a = f?.availableFor(pilot, { adep: departure(ctx) });
  if (!f || !a?.available) {
    const why =
      a?.reason ??
      (rec.provider === 'fax'
        ? 'Filing by fax is not available on this server.'
        : 'Filing is not available on this server.');
    throw await refuse(db, pilot.id, flightId, action, why);
  }
  return f;
}

/** Runs a backend's call, logging the outcome; its errors become 4xx/5xx with the backend's text. */
async function attempt<T>(
  db: Queryable,
  pilotId: string,
  flightId: string,
  action: FilingLogEntry['action'],
  filer: Filer,
  fn: () => Promise<T>,
  okMsg: (r: T) => string,
  detail: unknown = {},
): Promise<T> {
  try {
    const r = await fn();
    await log(db, pilotId, flightId, action, true, okMsg(r), detail, filer.id);
    return r;
  } catch (e) {
    const err = e instanceof FilerError ? e : new FilerError(String((e as Error)?.message || e));
    await log(db, pilotId, flightId, action, false, err.message, detail, filer.id);
    throw new HttpError(err.status, err.message, { error: err.message });
  }
}

const refOf = (rec: Row, pilot: Pilot, flightId: string): FiledRef => ({
  flightId,
  pilot,
  providerId: rec.provider_id,
  fpl: rec.fpl,
  addresses: rec.addresses ?? [],
  eobt: rec.eobt == null ? null : Number(rec.eobt),
  status: toStatus(rec.status),
  faxTo: rec.fax_to ?? null,
});

export function checkFpl(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('fpl must be the ICAO FPL message');
  const fpl = v.trim().replace(/\r\n?/g, '\n');
  if (fpl.length > MAX_FPL_CHARS) throw badRequest('fpl is too long');
  if (!/^\(FPL-[A-Z0-9]{2,7}-[\s\S]+\)$/.test(fpl)) throw badRequest('fpl must be an ICAO message: (FPL-…)');
  if (!/^[A-Z0-9 \n()\-/.:+,]*$/.test(fpl)) throw badRequest('fpl contains characters AFTN cannot carry');
  return fpl;
}
/** The ticked e-mail copies: a list of addresses, or undefined (all). */
function checkCopyTo(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > MAX_ADDRESSES || !v.every((e) => typeof e === 'string'))
    throw badRequest('copyTo must be a list of e-mail addresses');
  return v;
}
function checkVia(v: unknown, filers: Filer[]): Filer[] {
  if (v === undefined || v === null || v === '') return filers;
  const f = filers.find((x) => x.id === v);
  if (!f) throw badRequest('via must be one of the filing backends');
  return [f];
}

export function checkAddresses(v: unknown): string[] {
  if (!Array.isArray(v)) throw badRequest('addresses must be an array');
  if (v.length > MAX_ADDRESSES) throw badRequest('too many addresses');
  const out = v.map((a) => {
    const s = typeof a === 'string' ? a.trim().toUpperCase() : '';
    if (!/^[A-Z]{8}$/.test(s)) throw badRequest(`invalid AFTN address: ${String(a).slice(0, 20)}`);
    return s;
  });
  return [...new Set(out)];
}
/**
 * The plan must be for the flight's aircraft: item 7 (aircraft identification) is its registration
 * without the hyphen, and a REG/ in item 18, if given, is the same. Refuses a plan for an aircraft
 * that is not in the pilot's hangar, or for another callsign.
 */
export function checkFplAircraft(fpl: string, registration: string | null): void {
  if (!registration) throw badRequest('choose the flight’s aircraft before filing');
  const reg = registration.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const ident = /^\(FPL-([A-Z0-9]{2,7})-/.exec(fpl)?.[1];
  if (ident !== reg)
    throw badRequest(`item 7 must be the registration of the flight’s aircraft (${reg}), not ${ident ?? '?'}`);
  for (const m of fpl.matchAll(/(?:^|[\s-])REG\/([A-Z0-9]+)/g)) {
    if (m[1] !== reg) throw badRequest(`REG/${m[1]} does not match the flight’s aircraft (${reg})`);
  }
}
function checkEobt(v: unknown, field = 'eobt'): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest(`${field} must be a time (ms since 1970)`);
  const now = Date.now();
  if (v < now - EOBT_PAST_MS || v > now + EOBT_AHEAD_MS)
    throw badRequest(`${field} must be between now and 5 days ahead`);
  return v;
}
/** Item 13's aerodrome, '(FPL-…-LGTT0800-…' → 'LGTT'. */
const adepOf = (fpl: string) => /^\(FPL(?:\s?-[^-]*){4}\s?-([A-Z]{4})\d{4}/.exec(fpl.replace(/\s+/g, ' '))?.[1] ?? '';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/flights/:id/filing',
    async handler({ db, pilot, params, filers }) {
      // a pilot the flight is shared with sees its filing (read-only): the owner's record and log
      const g = await flightFor(db, pilot, params.id);
      return state(db, pilot, g.owner.id, params.id, filers, g.role !== 'owner');
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/filing',
    async handler({ db, pilot, params, body, filers }) {
      await flightFor(db, pilot, params.id, 'owner'); // sends ATC messages in the owner's name
      const ctx = await flightContext(db, pilot.id, params.id); // 404 for someone else's flight, before anything is logged
      const input = await body();
      const tried = checkVia(input.via, filers);
      const adep0 = departure(ctx);
      if (!tried.some((f) => f.availableFor(pilot, { adep: adep0 }).available)) {
        const why = tried.map((f) => f.availableFor(pilot, { adep: adep0 }).reason).find(Boolean);
        throw await refuse(db, pilot.id, params.id, 'file', why || 'Filing is not available on this server.');
      }
      const fpl = checkFpl(input.fpl);
      const addresses = checkAddresses(input.addresses ?? []);
      checkFplAircraft(fpl, ctx.registration);
      let eobt: number;
      if (input.eobt !== undefined) eobt = checkEobt(input.eobt);
      else {
        if (!ctx.timed) throw badRequest('set the block start time first');
        eobt = checkEobt(ctx.blockOff, 'the flight’s block start time');
      }
      const cur = await recordRow(db, pilot.id, params.id);
      if (cur && cur.provider_id && !FINAL.has(toStatus(cur.status)))
        throw conflict('this flight already has a filed plan: delay or cancel it');
      const adep = adepOf(fpl) || adep0;
      let done: { filer: Filer; result: FileOutcome };
      try {
        done = await withFallback(
          tried,
          pilot,
          adep,
          (f) => f.file(db, { flightId: params.id, pilot, fpl, addresses, eobt, adep }),
          ({ filer, error }) =>
            log(db, pilot.id, params.id, 'file', false, error.message, { addresses, eobt }, filer.id),
        );
      } catch (e) {
        const err = e as FilerError;
        if (err.status === 503) throw await refuse(db, pilot.id, params.id, 'file', err.message);
        throw new HttpError(err.status, err.message, { error: err.message });
      }
      const { filer, result: filed } = done;
      await log(db, pilot.id, params.id, 'file', true, filed.logText, { addresses, eobt }, filer.id);
      const now = Date.now();
      await db.query(
        `INSERT INTO flight_filings (flight_id, pilot_id, provider, provider_id, status, eobt, fpl, addresses, message, filed, updated, polled, fax_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$10,NULL,$11::jsonb)
         ON CONFLICT (flight_id) DO UPDATE SET provider = EXCLUDED.provider, provider_id = EXCLUDED.provider_id, status = EXCLUDED.status,
           eobt = EXCLUDED.eobt, fpl = EXCLUDED.fpl, addresses = EXCLUDED.addresses, message = EXCLUDED.message, filed = EXCLUDED.filed,
           updated = EXCLUDED.updated, polled = NULL, fax_to = EXCLUDED.fax_to
         WHERE flight_filings.pilot_id = EXCLUDED.pilot_id`,
        [
          params.id,
          pilot.id,
          filer.id,
          filed.providerId,
          filed.status,
          eobt,
          fpl,
          JSON.stringify(addresses),
          filed.message,
          now,
          filed.faxTo ? JSON.stringify(filed.faxTo) : null,
        ],
      );
      await filed.after?.(db);
      await sendCopy(
        db,
        filer,
        pilot,
        params.id,
        'file',
        { providerId: filed.providerId, fpl, addresses, faxTo: filed.faxTo ?? null, message: fpl },
        checkCopyTo(input.copyTo),
      );
      return state(db, pilot, pilot.id, params.id, filers);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/filing/delay',
    async handler({ db, pilot, params, body, filers }) {
      await flightFor(db, pilot, params.id, 'owner'); // sends ATC messages in the owner's name
      await flightContext(db, pilot.id, params.id);
      const rec = await recordRow(db, pilot.id, params.id);
      if (!rec) {
        if (!filers.some((f) => f.availableFor(pilot, { adep: '' }).available))
          throw await refuse(db, pilot.id, params.id, 'delay', 'Filing is not available on this server.');
        throw conflict('no open filed plan to delay');
      }
      const filer = await filerOf(db, pilot, params.id, 'delay', filers, rec);
      const eobt = checkEobt((await body()).eobt);
      if (!rec.provider_id || FINAL.has(toStatus(rec.status))) throw conflict('no open filed plan to delay');
      const ref = refOf(rec, pilot, params.id);
      const r = await attempt(
        db,
        pilot.id,
        params.id,
        'delay',
        filer,
        () => filer.delay(db, ref, eobt),
        (x) => x.logText,
        { eobt },
      );
      await db.query(
        'UPDATE flight_filings SET eobt = $3, message = $4, updated = $5 WHERE flight_id = $1 AND pilot_id = $2',
        [params.id, pilot.id, eobt, r.message, Date.now()],
      );
      await r.after?.(db);
      await sendCopy(db, filer, pilot, params.id, 'delay', {
        ...ref,
        message: r.sent ?? ref.fpl,
      });
      return state(db, pilot, pilot.id, params.id, filers);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/filing/cancel',
    async handler({ db, pilot, params, body, filers }) {
      await flightFor(db, pilot, params.id, 'owner'); // sends ATC messages in the owner's name
      await flightContext(db, pilot.id, params.id);
      const rec = await recordRow(db, pilot.id, params.id);
      if (!rec) {
        if (!filers.some((f) => f.availableFor(pilot, { adep: '' }).available))
          throw await refuse(db, pilot.id, params.id, 'cancel', 'Filing is not available on this server.');
        throw conflict('no open filed plan to cancel');
      }
      const filer = await filerOf(db, pilot, params.id, 'cancel', filers, rec);
      const input = await body();
      const reason =
        typeof input.reason === 'string' && input.reason.trim()
          ? input.reason.trim().slice(0, 200)
          : 'Cancelled by the pilot';
      if (!rec.provider_id || FINAL.has(toStatus(rec.status))) throw conflict('no open filed plan to cancel');
      const ref = refOf(rec, pilot, params.id);
      const r = await attempt(
        db,
        pilot.id,
        params.id,
        'cancel',
        filer,
        () => filer.cancel(db, ref, reason),
        (x) => x.logText,
        { reason },
      );
      await db.query(
        'UPDATE flight_filings SET status = $3, message = $4, updated = $5 WHERE flight_id = $1 AND pilot_id = $2',
        [params.id, pilot.id, r.status ?? rec.status, r.message, Date.now()],
      );
      await r.after?.(db);
      await sendCopy(
        db,
        filer,
        pilot,
        params.id,
        'cancel',
        { ...ref, message: r.sent ?? ref.fpl },
        checkCopyTo(input.copyTo),
      );
      return state(db, pilot, pilot.id, params.id, filers);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/filing/refresh',
    async handler({ db, pilot, params, filers }) {
      await flightFor(db, pilot, params.id, 'owner'); // sends ATC messages in the owner's name
      await flightContext(db, pilot.id, params.id);
      const rec = await recordRow(db, pilot.id, params.id);
      if (!rec) {
        if (!filers.some((f) => f.availableFor(pilot, { adep: '' }).available))
          throw await refuse(db, pilot.id, params.id, 'refresh', 'Filing is not available on this server.');
        throw conflict('this flight has no filed plan');
      }
      const filer = await filerOf(db, pilot, params.id, 'refresh', filers, rec);
      if (!rec.provider_id) throw conflict('this flight has no filed plan');
      const s = await attempt(
        db,
        pilot.id,
        params.id,
        'refresh',
        filer,
        () => filer.status(db, refOf(rec, pilot, params.id)),
        (r) => r.logText,
      );
      const now = Date.now();
      await db.query(
        'UPDATE flight_filings SET status = $3, eobt = COALESCE($4, eobt), polled = $5, updated = $5 WHERE flight_id = $1 AND pilot_id = $2',
        [params.id, pilot.id, s.status, s.eobt ?? null, now],
      );
      return state(db, pilot, pilot.id, params.id, filers);
    },
  },
  {
    method: 'GET',
    path: '/filing/log',
    async handler({ db, pilot }): Promise<FilingLogEntry[]> {
      const rows = await db.query('SELECT * FROM filing_log WHERE pilot_id = $1 ORDER BY at DESC, id DESC LIMIT 200', [
        pilot.id,
      ]);
      return rows.map(toLog);
    },
  },
  {
    method: 'POST',
    path: '/filing/fax/webhook/:provider',
    auth: false,
    webhook: true,
    async handler({ db, params, query, req, rawBody, faxProvider }) {
      if (!faxProvider || faxProvider.id !== params.provider) return reply(404, { error: 'not found' });
      const raw = await rawBody();
      let report;
      try {
        report = faxProvider.webhook({ headers: req.headers, raw, query });
      } catch (e) {
        // a caller without the service's signature or our secret learns nothing, not even that the route exists
        if (e instanceof FaxSignatureError) return reply(404, { error: 'not found' });
        return reply(400, { error: 'unreadable report' });
      }
      // an event that reports nothing new, or a fax this app did not send: acknowledged, ignored
      if (!report || !report.faxId) return { ok: true };
      const [row] = await db.query('SELECT * FROM fax_log WHERE provider = $1 AND provider_fax_id = $2', [
        faxProvider.id,
        report.faxId,
      ]);
      if (!row || (report.ref && report.ref !== row.id)) return { ok: true };
      await applyDelivery(db, row, report);
      return { ok: true };
    },
  },
];
