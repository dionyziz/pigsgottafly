// The W&B and performance sheets e-mailed to the aircraft's operator (src/shared/declarations.ts):
//   GET  /flights/:id/declarations        → DeclarationsState
//   POST /flights/:id/declarations/send   { content, resend? } → DeclarationsState
// The operator is the one of the flight's aircraft (when the pilot can use the aircraft). Sent once
// per version like the HCAA forms (forms.ts sendFormOnce: 'wbperf' in form_submissions), from
// noreply@ to the operator's declarations e-mail, the pilot in cc and reply-to (mail.ts).
import crypto from 'node:crypto';
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, notFound } from '../http.js';
import type { Queryable } from '../db.js';
import { accessibleSql } from '../access.js';
import { mailAvailability, MailError, sendMail } from '../mail.js';
import { wbPerfPdf } from '../declarationPdf.js';
import { sendFormOnce } from './forms.js';
import { wbPerfContentOf, wbPerfText, type DeclarationsState, type WbPerfContent } from '../../../src/shared/declarations.js';
import type { Pilot } from '../../../src/shared/types.js';

const MAIL_DENIED = 'Your account has no e-mail address to copy the declarations to.';
export const wbPerfHash = (c: WbPerfContent) => crypto.createHash('sha256').update(wbPerfText(c)).digest('base64url');

async function load(db: Queryable, pilot: Pilot, flightId: string) {
  const [f] = await db.query('SELECT id, date, aircraft_id FROM flights WHERE id = $1 AND pilot_id = $2', [flightId, pilot.id]);
  if (!f) throw notFound('no such flight');
  const [op] = f.aircraft_id ? await db.query(
    `SELECT o.id, o.name, o.requires_wb_perf, o.declarations_email FROM aircraft a JOIN operators o ON o.id = a.operator_id
     WHERE a.id = $1 AND ${accessibleSql('a', '$2')}`, [f.aircraft_id, pilot.id]) : [];
  return {
    flight: f as { id: string; date: string },
    operator: op ? { id: op.id as string, name: op.name as string, requiresWbPerf: !!op.requires_wb_perf, declarationsEmail: (op.declarations_email ?? '') as string } : null,
  };
}

function mailState(denied: boolean) {
  return denied ? { enabled: false, reason: MAIL_DENIED } : mailAvailability();
}

async function state(db: Queryable, pilot: Pilot, flightId: string, denied: boolean): Promise<DeclarationsState> {
  const { operator } = await load(db, pilot, flightId);
  const [s] = await db.query(`SELECT * FROM form_submissions WHERE flight_id = $1 AND pilot_id = $2 AND form = 'wbperf'`, [flightId, pilot.id]);
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
    method: 'GET', path: '/flights/:id/declarations',
    handler: async ({ db, pilot, params, formsMailDenied }) => state(db, pilot, params.id, formsMailDenied),
  },
  {
    method: 'POST', path: '/flights/:id/declarations/send',
    async handler({ db, pilot, params, body, formsMailDenied }) {
      const { flight, operator } = await load(db, pilot, params.id);
      if (!operator) throw conflict('the flight’s aircraft has no operator');
      if (!operator.requiresWbPerf) throw conflict(`${operator.name} does not ask for the W&B and performance sheets`);
      if (!operator.declarationsEmail) throw conflict(`${operator.name} has no e-mail address for the declarations`);
      const mail = mailState(formsMailDenied);
      if (!mail.enabled) throw new HttpError(formsMailDenied ? 403 : 503, mail.reason!, { error: mail.reason, emailEnabled: false });
      const input = await body();
      let content: WbPerfContent;
      try { content = wbPerfContentOf(input.content); } catch (e) { throw badRequest(String((e as Error).message)); }
      if (!content.wb.rows.length && !content.perf.pages.length) throw badRequest('the sheets are empty');
      const hash = wbPerfHash(content);
      const to = operator.declarationsEmail;
      await sendFormOnce(db, { flightId: flight.id, pilotId: pilot.id, form: 'wbperf', hash, resend: input.resend === true }, async () => {
        const signer = pilot.fullName.trim() || content.pilot.trim();
        const pdf = wbPerfPdf(content, signer ? { key: 'PIC', name: signer, signedAt: Date.now() } : null);
        const route = content.route.split(' – ').join(' → ');
        const subject = ['W&B and performance', content.registration, route, content.date].filter(Boolean).join(' · ');
        const text = [
          `Weight and balance and take-off/landing performance for the flight of ${content.registration || 'the aircraft'} on ${content.date || 'the date shown'}, route ${content.route || '–'}, attached as PDF.`,
          '',
          `W&B: ${content.wb.verdictText || content.wb.verdict}. Performance: ${content.perf.verdictText || content.perf.verdict}.`,
          `Pilot in command: ${signer || '–'}${pilot.phone ? `, ${pilot.phone}` : ''}${pilot.email ? `, ${pilot.email}` : ''}.`,
          'Replies go to the pilot in command.',
        ].join('\n');
        const filename = `WB_Performance_${(content.registration || 'aircraft').replace(/[^A-Za-z0-9]/g, '')}_${flight.date || 'undated'}.pdf`;
        try {
          const r = await sendMail({ to: [to], pilotEmail: pilot.email || '', subject, text, attachments: [{ filename, content: pdf, contentType: 'application/pdf' }] });
          return { id: r.id, to };
        } catch (e) {
          if (!(e instanceof MailError)) console.warn('declarations mail:', String((e as Error)?.message || e));
          throw new HttpError(502, e instanceof MailError ? e.message : 'the e-mail could not be sent');
        }
      });
      return state(db, pilot, params.id, formsMailDenied);
    },
  },
];
