// Sending caps and the e-mail action log. The service e-mails authorities (HCAA) and operators on a
// pilot's behalf, and hands out signing links, so each pilot gets a bounded number per rolling 24
// hours (429 beyond):
//   e-mails         MAIL_DAILY_CAP per pilot, MAIL_FLIGHT_FORM_CAP per flight and form (re-sends included),
//                   MAIL_RECIPIENT_CAP per pilot to any one operator declarations address,
//                   (Form 731 to a passenger, '731-pax': the per-flight cap and the pause are per recipient)
//                   and a global cap on everything sent to HCAA by all pilots together (hcaaDailyCap():
//                   HCAA_DAILY_CAP, default 200)
//   re-sends        a flight's form goes out at most once every RESEND_MIN_MS (10 min)
//   signing links   LINK_DAILY_CAP per pilot, LINK_FLIGHT_CAP per flight (renewals included)
// Every outbound e-mail is a mail_log row (migrations 030, 031), also the app's own (signup
// notices): reserveMail()/logMail() write it as 'pending' before sending, mailSent()/mailFailed()
// settle it; a send refused by a cap stays as 'capped'. The caps count 'pending' and 'sent' rows.
// The log is shown to the admins (GET /admin/mail). Links are counted in form_links (rows are kept
// when revoked).
import type { Queryable } from './db.js';
import { HttpError, newId } from './http.js';

export const CAP_WINDOW_MS = 24 * 3600e3;
export const MAIL_DAILY_CAP = 20;
export const MAIL_FLIGHT_FORM_CAP = 5;
export const MAIL_RECIPIENT_CAP = 10;
export const RESEND_MIN_MS = 10 * 60e3;
export const LINK_DAILY_CAP = 60;
export const LINK_FLIGHT_CAP = 20;
export const HCAA_FORMS = ['731', 'gendec'];
/** Forms sent to each person on a flight separately: the per-flight cap and pause count per recipient. */
const PER_RECIPIENT_FORMS = ['731-pax'];

/** All pilots together, per 24 hours, to the HCAA mailboxes (env HCAA_DAILY_CAP, default 200). */
export function hcaaDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.HCAA_DAILY_CAP);
  return Number.isInteger(n) && n > 0 ? n : 200;
}

const COUNTED = `result IN ('pending', 'sent')`;
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const tooMany = (message: string, until: number) => {
  const retryAfter = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  const error = `${message} Try again after ${hhmm(until + 60e3)} UTC.`;
  return new HttpError(429, error, { error, retryAfter });
};

export interface MailEntry {
  /** The pilot it is sent for (null: the app's own message with no pilot). */
  pilotId: string | null;
  flightId: string | null;
  /** '731', '731-pax' (to a passenger), 'gendec', 'wbperf', 'signup', 'signup-more' */
  form: string;
  /** The To addresses, comma-separated. */
  recipient: string;
  subject: string;
}

/** Writes a 'pending' log row for an e-mail about to be sent, without any cap; returns its id. */
export async function logMail(db: Queryable, e: MailEntry): Promise<string> {
  const id = await newId('ml');
  await db.query(
    `INSERT INTO mail_log (id, pilot_id, flight_id, form, at, recipient, subject, result) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
    [id, e.pilotId, e.flightId, e.form, Date.now(), e.recipient.slice(0, 500), e.subject.slice(0, 300)],
  );
  return id;
}

/**
 * Counts an e-mail about to be sent for a pilot and returns its log id, or throws 429 when it is over
 * a cap (the row then stays as 'capped'). The row is written first and then counted, so two
 * concurrent sends cannot both slip under a cap.
 */
export async function reserveMail(db: Queryable, e: MailEntry & { pilotId: string }): Promise<string> {
  const id = await logMail(db, e);
  const now = Date.now();
  const since = now - CAP_WINDOW_MS;
  const perRecipient = PER_RECIPIENT_FORMS.includes(e.form);
  const same = `flight_id IS NOT DISTINCT FROM $3 AND form = $4${perRecipient ? ' AND lower(recipient) = lower($5)' : ''}`;
  const [c] = await db.query(
    `SELECT count(*)::int AS total, min(at) AS oldest,
       count(*) FILTER (WHERE ${same})::int AS same,
       min(at) FILTER (WHERE ${same}) AS same_oldest,
       count(*) FILTER (WHERE lower(recipient) = lower($5) AND form = $4)::int AS addr,
       min(at) FILTER (WHERE lower(recipient) = lower($5) AND form = $4) AS addr_oldest,
       max(at) FILTER (WHERE ${same} AND result = 'sent') AS last_sent
     FROM mail_log WHERE pilot_id = $1 AND at > $2 AND ${COUNTED}`,
    [e.pilotId, since, e.flightId, e.form, e.recipient],
  );
  const toWhom = perRecipient ? ` to ${e.recipient}` : '';
  let err: HttpError | null = null;
  if (e.flightId && c.last_sent != null && Number(c.last_sent) > now - RESEND_MIN_MS) {
    err = tooMany(
      `This form was e-mailed${toWhom} for this flight less than ${RESEND_MIN_MS / 60e3} minutes ago.`,
      Number(c.last_sent) + RESEND_MIN_MS,
    );
  } else if (e.flightId && c.same > MAIL_FLIGHT_FORM_CAP) {
    err = tooMany(
      `This form was already e-mailed${toWhom} ${MAIL_FLIGHT_FORM_CAP} times for this flight in the last 24 hours.`,
      Number(c.same_oldest) + CAP_WINDOW_MS,
    );
  } else if (e.form === 'wbperf' && c.addr > MAIL_RECIPIENT_CAP) {
    err = tooMany(
      `You have sent ${MAIL_RECIPIENT_CAP} declarations to ${e.recipient} in the last 24 hours, the most allowed.`,
      Number(c.addr_oldest) + CAP_WINDOW_MS,
    );
  } else if (c.total > MAIL_DAILY_CAP) {
    err = tooMany(
      `You have sent ${MAIL_DAILY_CAP} e-mails in the last 24 hours, the most allowed.`,
      Number(c.oldest) + CAP_WINDOW_MS,
    );
  } else if (HCAA_FORMS.includes(e.form)) {
    const cap = hcaaDailyCap();
    const [g] = await db.query(
      `SELECT count(*)::int AS n, min(at) AS oldest FROM mail_log WHERE form = ANY($1::text[]) AND at > $2 AND ${COUNTED}`,
      [HCAA_FORMS, since],
    );
    if (g.n > cap)
      err = tooMany(
        'The service has reached its daily limit of forms sent to the HCAA.',
        Number(g.oldest) + CAP_WINDOW_MS,
      );
  }
  if (err) {
    await db.query(`UPDATE mail_log SET result = 'capped', error = $2 WHERE id = $1`, [id, err.message.slice(0, 500)]);
    throw err;
  }
  return id;
}

export async function mailSent(db: Queryable, id: string, messageId: string): Promise<void> {
  await db.query(`UPDATE mail_log SET result = 'sent', message_id = $2 WHERE id = $1`, [id, messageId]);
}

/** The send failed: it does not count, and the log keeps why. */
export async function mailFailed(db: Queryable, id: string, error: unknown): Promise<void> {
  // the provider's own error when a route wrapped it (HttpError 502 with a cause)
  const e = ((error as { cause?: unknown })?.cause ?? error) as Error;
  const msg = String(e?.message || e || 'failed').slice(0, 500);
  await db.query(`UPDATE mail_log SET result = 'failed', error = $2 WHERE id = $1`, [id, msg]);
}

/** Runs `send` as a logged e-mail (no caps): the row ends 'sent' with its message id, or 'failed'. */
export async function sendLogged(
  db: Queryable,
  e: MailEntry,
  send: () => Promise<{ id: string }>,
): Promise<{ id: string }> {
  const id = await logMail(db, e);
  try {
    const r = await send();
    await mailSent(db, id, r.id);
    return r;
  } catch (err) {
    await mailFailed(db, id, err);
    throw err;
  }
}

/** Throws 429 unless `n` more signing links fit under the pilot's and the flight's caps. */
export async function checkLinkCap(db: Queryable, pilotId: string, flightId: string, n: number): Promise<void> {
  if (n <= 0) return;
  const [c] = await db.query(
    `SELECT count(*)::int AS total, min(created) AS oldest,
       count(*) FILTER (WHERE flight_id = $3)::int AS flight, min(created) FILTER (WHERE flight_id = $3) AS flight_oldest
     FROM form_links WHERE pilot_id = $1 AND created > $2`,
    [pilotId, Date.now() - CAP_WINDOW_MS, flightId],
  );
  if (c.flight + n > LINK_FLIGHT_CAP) {
    throw tooMany(
      `Too many signing links for this flight: at most ${LINK_FLIGHT_CAP} in 24 hours.`,
      Number(c.flight_oldest ?? Date.now()) + CAP_WINDOW_MS,
    );
  }
  if (c.total + n > LINK_DAILY_CAP) {
    throw tooMany(
      `Too many signing links: at most ${LINK_DAILY_CAP} in 24 hours.`,
      Number(c.oldest ?? Date.now()) + CAP_WINDOW_MS,
    );
  }
}
