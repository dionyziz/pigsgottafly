// Filing by fax (AIP Greece GEN 3.1.5.3: from an aerodrome without ATS, the plan goes by fax or
// telephone to the nearest ATS reporting office; faxRoutes.ts says which). The fax is the website's
// own print (sheetPdf.ts → src/pdf/: a cover page and the filled ICAO form, FaxSheets.tsx), sent
// through the deployment's fax service (faxProviders.ts). A fax is delivered or not: the office
// re-keys the plan by hand and no ACK or REJ comes back (capabilities.ackRej = false); its DLA and
// CNL are faxed too, as ICAO messages (icaoMessages.ts), to the number the plan went to.
//
// Every fax is a fax_log row (migration 057), written before anything is printed and counted against
// the caps (429 beyond): FAX_PILOT_CAP per pilot and FAX_FLIGHT_CAP per flight per rolling 24 hours,
// and FAX_DAILY_CAP (env, default 100) for the whole service. The delivery report (the service's
// webhook, routes/filing.ts, or a poll on "Refresh status") settles the row and the filing.
import type { FilingStatus } from '../../../src/shared/briefing.js';
import type { FaxDestination, FaxKind, FplFaxContent } from '../../../src/shared/fax.js';
import type { Pilot } from '../../../src/shared/types.js';
import type { Queryable } from '../db.js';
import { newId } from '../http.js';
import { CAP_WINDOW_MS } from '../sendCaps.js';
import type { FaxPdfRenderer } from '../sheetPdf.js';
import { type FaxProvider, FaxProviderError, type FaxReport, type FaxState } from './faxProviders.js';
import { faxDestination } from './faxRoutes.js';
import { cnlMessage, dlaMessage } from './icaoMessages.js';
import type { FiledRef, Filer } from './types.js';
import { FilerError } from './types.js';

export const FAX_PILOT_CAP = 10;
export const FAX_FLIGHT_CAP = 6;
export function faxDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.FAX_DAILY_CAP);
  return Number.isInteger(n) && n > 0 ? n : 100;
}

/** What the service accepted counts, delivered or not (a failed call is still dialled and paid). */
const COUNTED = `(result IN ('pending', 'sending', 'delivered') OR (result = 'failed' AND provider_fax_id IS NOT NULL))`;
const WHAT: Record<FaxKind, string> = { file: 'FPL', delay: 'DLA', cancel: 'CNL' };
const hhmmZ = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;
const to = (d: FaxDestination) => `${d.unit} (${d.number})`;

export interface FaxFilerOptions {
  provider: FaxProvider;
  /** Prints the fax (sheetPdf.ts); null: printing is off on this server. */
  render: FaxPdfRenderer | null;
  /** The pilot is on FAX_PILOTS. */
  allowed: boolean;
  /** Where the service reports deliveries (…/api/filing/fax/webhook/<provider>); null: polled only. */
  webhookUrl: string | null;
  env?: NodeJS.ProcessEnv;
}

async function reserve(
  db: Queryable,
  e: { pilotId: string; flightId: string; kind: FaxKind; provider: string; dest: FaxDestination; detail: unknown },
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const id = await newId('fx');
  const now = Date.now();
  await db.query(
    `INSERT INTO fax_log (id, pilot_id, flight_id, kind, provider, recipient, unit, at, updated, result, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,'pending',$9::jsonb)`,
    [id, e.pilotId, e.flightId, e.kind, e.provider, e.dest.number, e.dest.unit, now, JSON.stringify(e.detail)],
  );
  const since = now - CAP_WINDOW_MS;
  const [c] = await db.query(
    `SELECT count(*) FILTER (WHERE pilot_id = $1)::int AS pilot,
            count(*) FILTER (WHERE pilot_id = $1 AND flight_id = $2)::int AS flight,
            count(*)::int AS total
     FROM fax_log WHERE at > $3 AND ${COUNTED}`,
    [e.pilotId, e.flightId, since],
  );
  const over =
    c.flight > FAX_FLIGHT_CAP
      ? `This flight has been faxed ${FAX_FLIGHT_CAP} times in the last 24 hours, the most allowed.`
      : c.pilot > FAX_PILOT_CAP
        ? `You have sent ${FAX_PILOT_CAP} faxes in the last 24 hours, the most allowed.`
        : c.total > faxDailyCap(env)
          ? 'The service has reached its daily limit of faxes.'
          : null;
  if (over) {
    await db.query(`UPDATE fax_log SET result = 'capped', error = $2 WHERE id = $1`, [id, over]);
    throw new FilerError(over, 429, false);
  }
  return id;
}

/**
 * Settles a fax_log row with a delivery report and carries it to the flight's filing: the plan's
 * fax delivered or failed, a DLA or CNL fax that failed puts the plan back as it was. Idempotent: a
 * row already settled is left alone (the service may report twice; a poll may race the webhook).
 */
export async function applyDelivery(db: Queryable, row: Record<string, unknown>, r: FaxReport): Promise<boolean> {
  if (r.state === 'sending' || row.result === 'delivered' || row.result === 'failed') return false;
  const now = Date.now();
  const kind = row.kind as FaxKind;
  const detail = (row.detail ?? {}) as { fileId?: string; prevEobt?: number | null; prevStatus?: FilingStatus };
  const fileId = kind === 'file' ? String(row.id) : String(detail.fileId ?? '');
  const settled = await db.query(
    `UPDATE fax_log SET result = $2, error = $3, pages = COALESCE($4, pages), updated = $5
     WHERE id = $1 AND result IN ('pending', 'sending') RETURNING id`,
    [row.id, r.state, r.error ?? null, r.pages ?? null, now],
  );
  if (!settled.length) return false;
  const ok = r.state === 'delivered';
  const where = `flight_id = $1 AND pilot_id = $2 AND provider = 'fax' AND provider_id = $3`;
  const args = [row.flight_id, row.pilot_id, fileId];
  const why = r.error ? ` (${r.error.replace(/_/g, ' ')})` : '';
  let message: string;
  if (kind === 'file') {
    message = ok ? '' : `The fax did not go through${why}: file again.`;
    await db.query(`UPDATE flight_filings SET status = $4, message = $5, updated = $6 WHERE ${where}`, [
      ...args,
      ok ? 'delivered' : 'failed',
      message,
      now,
    ]);
  } else if (ok) {
    message = kind === 'delay' ? 'Delay delivered by fax.' : 'Cancellation delivered by fax.';
    await db.query(`UPDATE flight_filings SET message = $4, updated = $5 WHERE ${where}`, [...args, message, now]);
  } else if (kind === 'delay') {
    message = `The delay fax did not go through${why}: delay again.`;
    await db.query(`UPDATE flight_filings SET eobt = $4, message = $5, updated = $6 WHERE ${where}`, [
      ...args,
      detail.prevEobt ?? null,
      message,
      now,
    ]);
  } else {
    message = `The cancellation fax did not go through${why}: cancel again.`;
    await db.query(`UPDATE flight_filings SET status = $4, message = $5, updated = $6 WHERE ${where}`, [
      ...args,
      detail.prevStatus ?? 'delivered',
      message,
      now,
    ]);
  }
  const pages = r.pages ? `, ${r.pages} page${r.pages > 1 ? 's' : ''}` : '';
  await db.query(
    `INSERT INTO filing_log (id, pilot_id, flight_id, at, action, ok, message, detail, via)
     VALUES ($1,$2,$3,$4,'delivery',$5,$6,$7::jsonb,'fax')`,
    [
      await newId('fg'),
      row.pilot_id,
      row.flight_id,
      now,
      ok,
      ok
        ? `${WHAT[kind]} fax delivered to ${String(row.unit)} (${String(row.recipient)}${pages})`
        : `${WHAT[kind]} fax to ${String(row.unit)} (${String(row.recipient)}) failed${why}`,
      JSON.stringify({ fax: row.id, error: r.error ?? null }),
    ],
  );
  return true;
}

export function faxFiler(o: FaxFilerOptions): Filer {
  const env = o.env ?? process.env;

  async function send(
    db: Queryable,
    pilot: Pilot,
    flightId: string,
    kind: FaxKind,
    dest: FaxDestination,
    plan: { fpl: string; addresses: string[] },
    message: string,
    detail: Record<string, unknown> = {},
  ): Promise<{ id: string; state: FaxState }> {
    const id = await reserve(db, { pilotId: pilot.id, flightId, kind, provider: o.provider.id, dest, detail }, env);
    const now = Date.now();
    const fullName = String(pilot.fullName || '').trim();
    const content: FplFaxContent = {
      kind,
      to: dest,
      from: { name: fullName, phone: String(pilot.phone || '').trim(), email: String(pilot.email || '').trim() },
      fpl: plan.fpl,
      addresses: plan.addresses,
      message,
      sentAt: now,
      signature: fullName ? { name: fullName, signedAt: now } : null,
    };
    const fail = async (e: unknown, msg: string, transient: boolean): Promise<never> => {
      await db.query(`UPDATE fax_log SET result = 'failed', error = $2, updated = $3 WHERE id = $1`, [
        id,
        String((e as Error)?.message ?? e).slice(0, 500),
        Date.now(),
      ]);
      throw new FilerError(msg, 502, transient);
    };
    let pdf: Buffer;
    try {
      pdf = await o.render!(content);
    } catch (e) {
      return fail(e, `The fax could not be printed: ${(e as Error)?.message ?? e}`, true);
    }
    let r: FaxReport;
    try {
      r = await o.provider.send({ to: dest.number, pdf, ref: id, callbackUrl: o.webhookUrl });
    } catch (e) {
      const transient = e instanceof FaxProviderError ? e.transient : true;
      return fail(e, e instanceof FaxProviderError ? e.message : 'the fax service failed', transient);
    }
    await db.query(
      `UPDATE fax_log SET provider_fax_id = $2, result = 'sending', pages = $3, updated = $4 WHERE id = $1`,
      [id, r.faxId, r.pages ?? null, Date.now()],
    );
    return { id, state: r.state };
  }

  /** Settles at once what the service already knows (the dry run: delivered on sending). */
  async function settleNow(db: Queryable, id: string, state: FaxState): Promise<void> {
    if (state === 'sending') return;
    const [row] = await db.query('SELECT * FROM fax_log WHERE id = $1', [id]);
    if (row) await applyDelivery(db, row, { faxId: row.provider_fax_id, state });
  }

  const destOf = (ref: FiledRef) => ref.faxTo ?? faxDestination('', env);

  return {
    id: 'fax',
    labelFor: (adep) => `Fax to ${faxDestination(adep, env).unit}`,
    capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: false },
    availableFor(pilot, flight) {
      if (!o.allowed) return { available: false, reason: 'Filing by fax is not available for this account.' };
      if (!o.render) return { available: false, reason: 'Printing the fax is not available on this server.' };
      if (!/^LG[A-Z]{2}$/.test(flight.adep))
        return { available: false, reason: 'Filing by fax is for departures from Greece.' };
      if (!String(pilot.phone || '').trim() && !String(pilot.email || '').trim())
        return {
          available: false,
          reason: 'Add your phone number to your profile: the fax asks the office to acknowledge to it.',
        };
      return { available: true, reason: null };
    },
    async file(db, plan) {
      const dest = faxDestination(plan.adep, env);
      const r = await send(db, plan.pilot, plan.flightId, 'file', dest, plan, plan.fpl);
      return {
        providerId: r.id,
        status: 'sending',
        message: '',
        logText: `faxed to ${to(dest)}`,
        faxTo: dest,
        after: (d) => settleNow(d, r.id, r.state),
      };
    },
    async delay(db, ref, eobt) {
      const dest = destOf(ref);
      const msg = dlaMessage(ref.fpl, eobt);
      const r = await send(db, ref.pilot, ref.flightId, 'delay', dest, ref, msg, {
        fileId: ref.providerId,
        prevEobt: ref.eobt,
        message: msg,
      });
      return {
        message: 'Delay sent by fax.',
        sent: msg,
        logText: `DLA to ${hhmmZ(eobt)} faxed to ${to(dest)}`,
        after: (d) => settleNow(d, r.id, r.state),
      };
    },
    async cancel(db, ref) {
      const dest = destOf(ref);
      const msg = cnlMessage(ref.fpl, ref.eobt);
      const r = await send(db, ref.pilot, ref.flightId, 'cancel', dest, ref, msg, {
        fileId: ref.providerId,
        prevStatus: ref.status,
        message: msg,
      });
      return {
        status: 'cancelled',
        message: 'Cancellation sent by fax.',
        sent: msg,
        logText: `CNL faxed to ${to(dest)}`,
        after: (d) => settleNow(d, r.id, r.state),
      };
    },
    async status(db, ref) {
      const rows = await db.query(
        `SELECT * FROM fax_log WHERE flight_id = $1 AND pilot_id = $2 AND (id = $3 OR detail->>'fileId' = $3)
           AND result = 'sending' AND provider_fax_id IS NOT NULL ORDER BY at`,
        [ref.flightId, ref.pilot.id, ref.providerId],
      );
      const seen: string[] = [];
      for (const row of rows) {
        let r: FaxReport;
        try {
          r = await o.provider.get(String(row.provider_fax_id));
        } catch (e) {
          throw new FilerError(e instanceof FaxProviderError ? e.message : 'the fax service failed', 502);
        }
        seen.push(`${WHAT[row.kind as FaxKind]} ${r.state}`);
        await applyDelivery(db, row, r);
      }
      const [cur] = await db.query('SELECT status, eobt FROM flight_filings WHERE flight_id = $1 AND pilot_id = $2', [
        ref.flightId,
        ref.pilot.id,
      ]);
      return {
        status: (cur?.status ?? ref.status) as FilingStatus,
        eobt: cur?.eobt == null ? null : Number(cur.eobt),
        logText: seen.length ? `fax ${seen.join(', ')}` : `status ${cur?.status ?? ref.status}`,
      };
    },
    async transmitted(ref, message) {
      const dest = ref.faxTo;
      return [
        { text: message, priority: 'FF', recipients: dest ? [`${dest.unit.toUpperCase()} FAX ${dest.number}`] : [] },
      ];
    },
  };
}
