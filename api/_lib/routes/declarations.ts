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
// A pilot the flight is shared with sees the state (as the owner's flight); only the owner sends.
// The PDF is the website's own print of the sheets (config.sheetPdf: sheetPdf.ts, headless Chromium);
// when that fails, the server's PDF writer draws it (declarationPdf.ts), so the operator still gets
// the sheets, and the failure is recorded in app_errors (monitor.ts).
import crypto from 'node:crypto';

import {
  type DeclarationsState,
  sheetText,
  type WbPerfContent,
  wbPerfContentOf,
  wbPerfText,
} from '../../../src/shared/declarations.js';
import { routePlacesWith } from '../../../src/shared/forms.js';
import { flightAiracDay } from '../../../src/shared/ref.js';
import type { Pilot, RoutePoint } from '../../../src/shared/types.js';
import { accessibleSql, flightFor } from '../access.js';
import type { Queryable } from '../db.js';
import { wbPerfPdf } from '../declarationPdf.js';
import { loadRef } from '../flightContext.js';
import type { ApiConfig, Route } from '../http.js';
import { badRequest, conflict, HttpError, notFound } from '../http.js';
import { mailAvailability, MailError, sendMail } from '../mail.js';
import { recordError } from '../monitor.js';
import type { SheetSignature } from '../sheetPdf.js';
import { sendFormOnce } from './forms.js';

const MAIL_DENIED = 'Your account has no e-mail address to copy the declarations to.';
const NOT_OWNER = 'Only the flight’s owner sends its declarations.';
export const wbPerfHash = (c: WbPerfContent) => crypto.createHash('sha256').update(wbPerfText(c)).digest('base64url');

/**
 * The PDF of the sheets: the website's print (config.sheetPdf), else, when there is none or it
 * fails, the server's own writer; a failure is recorded (app_errors) and the send goes on.
 */
async function sheetsPdf(
  db: Queryable,
  config: Pick<ApiConfig, 'sheetPdf' | 'adminEmails'>,
  content: WbPerfContent,
  sig: SheetSignature | null,
  pilotId: string,
): Promise<Buffer> {
  if (config.sheetPdf) {
    try {
      return await config.sheetPdf(content, sig);
    } catch (e) {
      await recordError(
        db,
        {
          kind: 'server',
          message: `W&B and performance PDF: the print failed, the server's own PDF was sent instead: ${(e as Error)?.message ?? e}`,
          stack: (e as Error)?.stack ?? null,
          route: '/flights/:id/declarations/send',
          method: 'POST',
          pilotId,
          group: 'sheet-pdf',
        },
        { adminEmails: config.adminEmails },
      );
    }
  }
  return wbPerfPdf(content, sig && { key: 'PIC', ...sig });
}

/** The route as the sheets print it (the export page's routeText): origin, aerodromes on the way,
 *  destination, by code. */
async function sheetRoute(db: Queryable, route: RoutePoint[], date: string): Promise<string> {
  const ref = await loadRef(db, flightAiracDay(date));
  const byId = new Map(ref.aerodromes.map((x) => [x.id.toUpperCase(), x]));
  const byIcao = new Map(ref.aerodromes.filter((x) => x.icao).map((x) => [x.icao!.toUpperCase(), x]));
  return routePlacesWith(route, (k) => (k ? (byId.get(k.toUpperCase()) ?? byIcao.get(k.toUpperCase())) : undefined))
    .map((p) => token(p.code, 24))
    .filter(Boolean)
    .join(' – ');
}

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
    flight: { id: f.id as string, date: f.date as string, route: route as RoutePoint[] },
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

function mailState(denied: boolean | string) {
  if (typeof denied === 'string') return { enabled: false, reason: denied };
  return denied ? { enabled: false, reason: MAIL_DENIED } : mailAvailability();
}

async function state(
  db: Queryable,
  pilot: Pilot,
  flightId: string,
  denied: boolean | string,
): Promise<DeclarationsState> {
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
    async handler({ db, pilot, params, formsMailDenied }) {
      const g = await flightFor(db, pilot, params.id);
      return state(db, g.owner, params.id, g.role === 'owner' ? formsMailDenied : NOT_OWNER);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/declarations/send',
    async handler({ db, pilot, params, body, formsMailDenied, config }) {
      await flightFor(db, pilot, params.id, 'owner');
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
      // the sheets print the pilot and the route as the export page does (WbExport.tsx)
      const pic = sheetText(pilot.fullName, 80);
      const sheetRouteText = (await sheetRoute(db, flight.route, flight.date).catch(() => '')) || routeText;
      // the PDF's identifying fields are the server's
      const content: WbPerfContent = {
        ...sent,
        registration: facts.registration,
        makeModel: facts.makeModel,
        operator: facts.operator,
        date: facts.date,
        pilot: pic,
        route: sheetRouteText,
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
          // signed when sent
          const pdf = await sheetsPdf(db, config, content, pic ? { name: pic, signedAt: Date.now() } : null, pilot.id);
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
