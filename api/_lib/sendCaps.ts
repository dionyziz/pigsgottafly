// Sending caps: the service e-mails authorities (HCAA) and operators on a pilot's behalf, and hands
// out signing links, so each pilot gets a bounded number per rolling 24 hours (429 beyond):
//   e-mails         MAIL_DAILY_CAP per pilot, MAIL_FLIGHT_FORM_CAP per flight and form (re-sends included)
//   signing links   LINK_DAILY_CAP per pilot, LINK_FLIGHT_CAP per flight (renewals included)
// E-mails are counted in mail_log (migration 030): reserveMail() writes the row before sending and
// releaseMail() removes it when the send fails. Links are counted in form_links (rows are kept when
// revoked). Any sender of e-mail (forms.ts; operator declarations) goes through reserveMail().
import type { Queryable } from './db.js';
import { HttpError, newId } from './http.js';

export const CAP_WINDOW_MS = 24 * 3600e3;
export const MAIL_DAILY_CAP = 20;
export const MAIL_FLIGHT_FORM_CAP = 5;
export const LINK_DAILY_CAP = 60;
export const LINK_FLIGHT_CAP = 20;

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
/** "Try again after 14:05 UTC" from the oldest counted event of the window. */
const retryText = (oldest: number) => `Try again after ${hhmm(oldest + CAP_WINDOW_MS + 60e3)} UTC.`;
const tooMany = (message: string, oldest: number) => {
  const retryAfter = Math.max(1, Math.ceil((oldest + CAP_WINDOW_MS - Date.now()) / 1000));
  const error = `${message} ${retryText(oldest)}`;
  return new HttpError(429, error, { error, retryAfter });
};

/**
 * Counts an e-mail about to be sent (form: '731', 'gendec', an operator declaration…) and returns
 * its reservation id, or throws 429 when the pilot or this flight's form is over its cap. The row
 * is written first and then counted, so two concurrent sends cannot both slip under the cap.
 */
export async function reserveMail(db: Queryable, pilotId: string, flightId: string | null, form: string): Promise<string> {
  const id = await newId('ml');
  const now = Date.now();
  await db.query('INSERT INTO mail_log (id, pilot_id, flight_id, form, at) VALUES ($1,$2,$3,$4,$5)', [id, pilotId, flightId, form, now]);
  const [c] = await db.query(
    `SELECT count(*)::int AS total, min(at) AS oldest,
       count(*) FILTER (WHERE flight_id IS NOT DISTINCT FROM $3 AND form = $4)::int AS same,
       min(at) FILTER (WHERE flight_id IS NOT DISTINCT FROM $3 AND form = $4) AS same_oldest
     FROM mail_log WHERE pilot_id = $1 AND at > $2`,
    [pilotId, now - CAP_WINDOW_MS, flightId, form]);
  let err: HttpError | null = null;
  if (flightId && c.same > MAIL_FLIGHT_FORM_CAP) {
    err = tooMany(`This form was already e-mailed ${MAIL_FLIGHT_FORM_CAP} times for this flight in the last 24 hours.`, Number(c.same_oldest));
  } else if (c.total > MAIL_DAILY_CAP) {
    err = tooMany(`You have sent ${MAIL_DAILY_CAP} e-mails in the last 24 hours, the most allowed.`, Number(c.oldest));
  }
  if (err) {
    await releaseMail(db, id);
    throw err;
  }
  return id;
}

/** The send failed: it does not count. */
export async function releaseMail(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM mail_log WHERE id = $1', [id]);
}

/** Throws 429 unless `n` more signing links fit under the pilot's and the flight's caps. */
export async function checkLinkCap(db: Queryable, pilotId: string, flightId: string, n: number): Promise<void> {
  if (n <= 0) return;
  const [c] = await db.query(
    `SELECT count(*)::int AS total, min(created) AS oldest,
       count(*) FILTER (WHERE flight_id = $3)::int AS flight, min(created) FILTER (WHERE flight_id = $3) AS flight_oldest
     FROM form_links WHERE pilot_id = $1 AND created > $2`,
    [pilotId, Date.now() - CAP_WINDOW_MS, flightId]);
  if (c.flight + n > LINK_FLIGHT_CAP) {
    throw tooMany(`Too many signing links for this flight: at most ${LINK_FLIGHT_CAP} in 24 hours.`, Number(c.flight_oldest ?? Date.now()));
  }
  if (c.total + n > LINK_DAILY_CAP) {
    throw tooMany(`Too many signing links: at most ${LINK_DAILY_CAP} in 24 hours.`, Number(c.oldest ?? Date.now()));
  }
}
