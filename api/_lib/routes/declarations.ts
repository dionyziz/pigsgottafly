// The W&B and performance sheets e-mailed to the aircraft's operator (src/shared/declarations.ts):
//   GET  /flights/:id/declarations        → DeclarationsState
//   POST /flights/:id/declarations/send   { content, resend? } → DeclarationsState
// The operator is the one of the flight's aircraft (when the pilot can use the aircraft). Sent once
// per version like the HCAA forms (forms.ts sendFormOnce: 'wbperf' in form_submissions), from
// noreply@ to the operator's declarations e-mail, the pilot in cc and reply-to (mail.ts).
// The subject and body are built from the server's own records only (the aircraft's registration, the
// flight's date and route ends, the pilot's name and contact); the client's content only draws the PDF,
// normalized by wbPerfContentOf (bounded, links and e-mail addresses removed) and with its
// identifying fields replaced by the server's. Every send goes through the sending caps
// (sendCaps.ts: per pilot, per flight, per declarations address; 10 min between sends of a flight).
import crypto from 'node:crypto';
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, notFound } from '../http.js';
import type { Queryable } from '../db.js';
import { accessibleSql } from '../access.js';
import { mailAvailability, MailError, sendMail } from '../mail.js';
import { wbPerfPdf } from '../declarationPdf.js';
import { sendFormOnce } from './forms.js';
import {
  sheetText,
  wbPerfContentOf,
  wbPerfText,
  type DeclarationsState,
  type WbPerfContent,
} from '../../../src/shared/declarations.js';
import type { Pilot } from '../../../src/shared/types.js';

const MAIL_DENIED = 'Your account has no e-mail address to copy the declarations to.';
export const wbPerfHash = (c: WbPerfContent) => crypto.createHash('sha256').update(wbPerfText(c)).digest('base64url');

async function load(db: Queryable, pilot: Pilot, flightId: string) {
  const [f] = await db.query('SELECT id, date, aircraft_id, route FROM flights WHERE id = $1 AND pilot_id = $2', [
    flightId,
    pilot.id,
  ]);
  if (!f) throw notFound('no such flight');
  const [op] = f.aircraft_id
    ? await db.query(
        `SELECT o.id, o.name, o.requires_wb_perf, o.declarations_email, a.registration, a.make_model FROM aircraft a JOIN operators o ON o.id = a.operator_id
     WHERE a.id = $1 AND ${accessibleSql('a', '$2')}`,
        [f.aircraft_id, pilot.id],
      )
    : [];
  const route = (Array.isArray(f.route) ? f.route : typeof f.route === 'string' ? JSON.parse(f.route) : []) as {
    name?: string;
  }[];
  return {
    flight: { id: f.id as string, date: f.date as string },
    facts: {
      registration: token(op?.registration, 12).toUpperCase(),
      makeModel: sheetText(op?.make_model, 60),
      operator: sheetText(op?.name, 80),
      date: /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? (f.date as string) : '',
      origin: token(route[0]?.name, 24),
      destination: token(route.length > 1 ? route[route.length - 1]?.name : '', 24),
    },
    operator: op
      ? {
          id: op.id as string,
          name: op.name as string,
          requiresWbPerf: !!op.requires_wb_perf,
          declarationsEmail: (op.declarations_email ?? '') as string,
        }
      : null,
  };
}

/** A name as it may appear in a subject: letters, digits, spaces and - . / ( ) only. */
function token(v: unknown, max: number): string {
  return sheetText(v, max * 2)
    .replace(/[^\p{L}\p{N} ./()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function mailState(denied: boolean) {
  return denied ? { enabled: false, reason: MAIL_DENIED } : mailAvailability();
}

async function state(db: Queryable, pilot: Pilot, flightId: string, denied: boolean): Promise<DeclarationsState> {
  const { operator } = await load(db, pilot, flightId);
  const [s] = await db.query(
    `SELECT * FROM form_submissions WHERE flight_id = $1 AND pilot_id = $2 AND form = 'wbperf'`,
    [flightId, pilot.id],
  );
  const mail = mailState(denied);
  return {
    operator,
    submission: s ? { sentAt: Number(s.sent_at), to: s.to_addr, hash: s.text_hash, messageId: s.message_id } : null,
    emailEnabled: mail.enabled,
    emailReason: mail.reason,
  };
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/flights/:id/declarations',
    handler: async ({ db, pilot, params, formsMailDenied }) => state(db, pilot, params.id, formsMailDenied),
  },
  {
    method: 'POST',
    path: '/flights/:id/declarations/send',
    async handler({ db, pilot, params, body, formsMailDenied }) {
      const { flight, facts, operator } = await load(db, pilot, params.id);
      if (!operator) throw conflict('the flight’s aircraft has no operator');
      if (!operator.requiresWbPerf) throw conflict(`${operator.name} does not ask for the W&B and performance sheets`);
      if (!operator.declarationsEmail) throw conflict(`${operator.name} has no e-mail address for the declarations`);
      const mail = mailState(formsMailDenied);
      if (!mail.enabled)
        throw new HttpError(formsMailDenied ? 403 : 503, mail.reason!, { error: mail.reason, emailEnabled: false });
      const input = await body();
      let sent: WbPerfContent;
      try {
        sent = wbPerfContentOf(input.content);
      } catch (e) {
        throw badRequest(String((e as Error).message));
      }
      if (!sent.wb.rows.length && !sent.perf.pages.length) throw badRequest('the sheets are empty');
      // "changed since sent" compares with what the client shows (hashed the same way there)
      const hash = wbPerfHash(sent);
      const signer = token(pilot.fullName, 80);
      const routeText = [facts.origin, facts.destination].filter(Boolean).join(' – ');
      // the PDF's identifying fields are the server's
      const content: WbPerfContent = {
        ...sent,
        registration: facts.registration,
        makeModel: facts.makeModel,
        operator: facts.operator,
        date: facts.date,
        pilot: signer,
        route: routeText,
      };
      const to = operator.declarationsEmail;
      const subject = [
        'W&B and performance',
        facts.registration,
        facts.date,
        facts.origin && facts.destination ? `${facts.origin}–${facts.destination}` : facts.origin,
      ]
        .filter(Boolean)
        .join(' · ');
      await sendFormOnce(
        db,
        { flightId: flight.id, pilotId: pilot.id, form: 'wbperf', hash, resend: input.resend === true, to, subject },
        async () => {
          const pdf = wbPerfPdf(content, signer ? { key: 'PIC', name: signer, signedAt: Date.now() } : null);
          const phone = token(pilot.phone, 40);
          const text = [
            `Weight and balance and take-off/landing performance for the flight of ${facts.registration || 'the aircraft'} on ${facts.date || 'the date shown'}${routeText ? `, ${routeText}` : ''}, attached as PDF.`,
            '',
            `Pilot in command: ${signer || '–'}${phone ? `, ${phone}` : ''}${pilot.email ? `, ${pilot.email}` : ''}.`,
            'Replies go to the pilot in command.',
          ].join('\n');
          const filename = `WB_Performance_${(facts.registration || 'aircraft').replace(/[^A-Za-z0-9]/g, '')}_${facts.date || 'undated'}.pdf`;
          try {
            return await sendMail({
              to: [to],
              pilotEmail: pilot.email || '',
              subject,
              text,
              attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
            });
          } catch (e) {
            if (!(e instanceof MailError)) console.warn('declarations mail:', String((e as Error)?.message || e));
            throw Object.assign(
              new HttpError(502, e instanceof MailError ? e.message : 'the e-mail could not be sent'),
              { cause: e },
            );
          }
        },
      );
      return state(db, pilot, params.id, formsMailDenied);
    },
  },
];
