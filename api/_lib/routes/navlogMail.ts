// The navlog e-mailed to the signed-in pilot as PDF (src/shared/navlogSheets.ts):
//   GET  /flights/:id/exports/navlog/email            → NavlogMailState
//   POST /flights/:id/exports/navlog/email { content } → NavlogMailState
// The flight's owner or any pilot it is shared with may e-mail it, to their own account's address and
// nobody else (no cc, no reply-to). The PDF is the website's own print of the sheets the page sent
// (config.navlogPdf: sheetPdf.ts, headless Chromium), normalized by navlogContentOf (bounded, no links
// or e-mail addresses); the subject, body and file name come from the flight's record. There is no
// other writer for the navlog: when the print fails the send fails (502), and the error is in the
// mail log and in app_errors (the dispatcher records every 5xx, app.ts). Every send is a mail_log row
// ('navlog') under the sending caps (sendCaps.ts: per pilot and per flight, a minute between sends).
import { sheetText } from '../../../src/shared/declarations.js';
import { type NavlogContent, navlogContentOf, type NavlogMailState } from '../../../src/shared/navlogSheets.js';
import { flightFor } from '../access.js';
import type { Queryable } from '../db.js';
import type { Route } from '../http.js';
import { badRequest, HttpError } from '../http.js';
import { mailAvailability, MailError, sendSystemMail } from '../mail.js';
import { mailFailed, mailSent, reserveMail } from '../sendCaps.js';

const NO_EMAIL = 'Your account has no e-mail address to send the navlog to.';
const NO_PRINT = 'Printing the navlog is not available on this server.';

/** A name as it may appear in a subject: letters, digits, spaces and - . / ( ) only. */
const token = (v: unknown, max: number) =>
  sheetText(v, max * 2)
    .replace(/[^\p{L}\p{N} ./()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

async function flightFacts(db: Queryable, flightId: string) {
  const [f] = await db.query('SELECT date, route FROM flights WHERE id = $1', [flightId]);
  const route = (Array.isArray(f?.route) ? f.route : typeof f?.route === 'string' ? JSON.parse(f.route) : []) as {
    name?: string;
  }[];
  const date = typeof f?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : '';
  const origin = token(route[0]?.name, 24);
  const destination = route.length > 1 ? token(route[route.length - 1]?.name, 24) : '';
  return { date, route: [origin, destination].filter(Boolean).join('–') };
}

async function state(
  db: Queryable,
  pilotId: string,
  email: string,
  flightId: string,
  canPrint: boolean,
): Promise<NavlogMailState> {
  const [s] = await db.query(
    `SELECT at, recipient FROM mail_log WHERE pilot_id = $1 AND flight_id = $2 AND form = 'navlog' AND result = 'sent'
     ORDER BY at DESC LIMIT 1`,
    [pilotId, flightId],
  );
  const mail = !email
    ? { enabled: false, reason: NO_EMAIL }
    : !canPrint
      ? { enabled: false, reason: NO_PRINT }
      : mailAvailability();
  return {
    to: email,
    sent: s ? { sentAt: Number(s.at), to: s.recipient as string } : null,
    emailEnabled: mail.enabled,
    emailReason: mail.reason,
  };
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/flights/:id/exports/navlog/email',
    async handler({ db, pilot, params, config }) {
      await flightFor(db, pilot, params.id);
      return state(db, pilot.id, String(pilot.email || '').trim(), params.id, !!config.navlogPdf);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/exports/navlog/email',
    async handler({ db, pilot, params, body, config }) {
      await flightFor(db, pilot, params.id);
      const to = String(pilot.email || '').trim();
      const st = await state(db, pilot.id, to, params.id, !!config.navlogPdf);
      if (!st.emailEnabled)
        throw new HttpError(to ? 503 : 403, st.emailReason!, { error: st.emailReason, emailEnabled: false });
      let content: NavlogContent;
      try {
        content = navlogContentOf((await body()).content);
      } catch (e) {
        throw badRequest(String((e as Error).message));
      }
      if (!content.sheets.length) throw badRequest('the navlog is empty');
      const facts = await flightFacts(db, params.id);
      const subject = ['Navlog', facts.date, facts.route].filter(Boolean).join(' ');
      // under the caps (429) and in the log before anything is printed
      const reservation = await reserveMail(db, {
        pilotId: pilot.id,
        flightId: params.id,
        form: 'navlog',
        recipient: to,
        subject,
      });
      try {
        let pdf: Buffer;
        try {
          pdf = await config.navlogPdf!(content);
        } catch (e) {
          throw Object.assign(new HttpError(502, `The navlog could not be printed: ${(e as Error)?.message ?? e}`), {
            cause: e,
          });
        }
        const n = content.sheets.length;
        const text = `The navigation log${facts.route ? ` of ${facts.route}` : ''}${facts.date ? ` on ${facts.date}` : ''}, ${n} sheet${n > 1 ? 's' : ''}, attached as PDF.`;
        let sent: { id: string };
        try {
          sent = await sendSystemMail({
            to: [to],
            subject,
            text,
            attachments: [
              {
                filename: `${facts.date ? `${facts.date}-` : ''}navlog.pdf`,
                content: pdf,
                contentType: 'application/pdf',
              },
            ],
          });
        } catch (e) {
          if (!(e instanceof MailError)) console.warn('navlog mail:', String((e as Error)?.message || e));
          throw Object.assign(new HttpError(502, e instanceof MailError ? e.message : 'the e-mail could not be sent'), {
            cause: e,
          });
        }
        await mailSent(db, reservation, sent.id);
      } catch (e) {
        await mailFailed(db, reservation, e);
        throw e;
      }
      return state(db, pilot.id, to, params.id, true);
    },
  },
];
