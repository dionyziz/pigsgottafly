// Form 731 signatures and sending the forms to HCAA by e-mail (PLAN-v3 "Form 731: signatures and
// submission to HCAA", "Sending forms to HCAA by email"). Bodies: src/shared/forms.ts.
//   GET  /flights/:id/forms                        state of both forms (the PIC signs automatically)
//   POST /flights/:id/forms/731/links              a link per passenger who has none (tokens returned once)
//   POST /flights/:id/forms/731/links/:key/renew   a new link for that person (the old one stops working)
//   POST /flights/:id/forms/731/links/:key/revoke  that person's link stops working
//   POST /flights/:id/forms/731/send               PDF to 731@hcaa.gov.gr, cc/reply-to the pilot (409 until all signed)
//   POST /flights/:id/forms/731/email/:key         that passenger (a saved one with an e-mail address) gets the
//                                                  form as PDF (other people's ID and phone masked) and a new
//                                                  signing link, cc/reply-to the pilot; capped per recipient
//                                                  ('731-pax' in sendCaps.ts), no HCAA date window
//   POST /flights/:id/forms/gendec/send            PDF to gendec@hcaa.gov.gr, cc/reply-to the pilot
// Any signed-in pilot may send; the pilot is always cc'd. A version already sent is refused (409)
// unless the body is {"resend": true}; concurrent sends of one form are refused (409). Sends and
// signing links are capped per pilot and per flight in any 24 hours (api/_lib/sendCaps.ts, 429).
//   GET  /sign/:token                              the signing page's view (no sign-in): own row in full, others masked
//   POST /sign/:token                              signs the current version of the form
//   PUT  /sign/:token/details                      the signer corrects their own row (name, ID, phone): their saved
//                                                  passenger record and this flight's manifest; what changed is kept
//                                                  with the link and told to the pilot in the "signed" e-mail
// A signature is for one version of the form (SHA-256 of every field, form731SigningText): when
// anything on the form changes, earlier signatures no longer count and the panel shows who must sign
// again. Links give access to that one form only, are stored hashed, can be revoked and expire at the
// end of the day after the flight, at most 14 days after they were made. A link is bound to the person it was given to (personHash): a
// passenger without a saved record is keyed by seat, and whoever later takes that seat is a different
// person whom the old link must not reach.
// A flight shared with other pilots (access.ts flightFor): they see the forms' state (GET, as the
// owner's flight); only the owner hands out signing links and sends the forms (403 for the others);
// editors may set the GenDec override (it is part of the flight).
import crypto from 'node:crypto';

import { aerodromeNotamEffects, type GenDecHandling, genDecHandling } from '../../../src/calc/aerodromeStatus.js';
import type { NotamBriefing } from '../../../src/shared/briefing.js';
import { EMPTY_PERSON } from '../../../src/shared/constants.js';
import { fmtDate } from '../../../src/shared/date.js';
import {
  type AerodromeLookup,
  FORM731_TO,
  type Form731Content,
  form731Content,
  type Form731Person,
  form731SigningText,
  type FormsState,
  GENDEC_PIC_KEY,
  GENDEC_TO,
  type GenDecContent,
  genDecContent,
  genDecText,
  maskTail,
  type SignatureState,
  SIGNER_DETAIL_KEYS,
  SIGNER_DETAIL_LABELS,
  type SignerDetails,
  signerDetailsOf,
  type SigningView,
  type SubmissionState,
} from '../../../src/shared/forms.js';
import type { RefAerodrome } from '../../../src/shared/ref.js';
import type { RoutePoint } from '../../../src/shared/types.js';
import type { Aircraft, Flight, PersonKey, Pilot } from '../../../src/shared/types.js';
import { accessibleSql, AIRCRAFT_FROM, flightFor } from '../access.js';
import { hashToken } from '../auth.js';
import type { Db, Queryable, Row } from '../db.js';
import { flightContext, loadRef } from '../flightContext.js';
import { form731Pdf, genDecPdf, type PdfSignature } from '../formPdf.js';
import type { JsonBody, Route } from '../http.js';
import { appOrigin, badRequest, conflict, HttpError, newId, notFound } from '../http.js';
import { mailAvailability, MailError, sendMail, sendSystemMail } from '../mail.js';
import { rateLimit } from '../rateLimit.js';
import { personColumns, toAircraft, toFlight, toPassenger, toPilot } from '../rows.js';
import { checkLinkCap, mailFailed, mailSent, reserveMail } from '../sendCaps.js';

const DAY = 86400e3;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('base64url');

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
/**
 * Who a link (or a signature) belongs to. A saved passenger is their record (the key is the
 * passenger id, and editing their details keeps the link); the PIC is the pilot; a passenger without
 * a record (keyed 'seat:<id>') is their name and ID document as on the form.
 */
export function personHash(p: Pick<Form731Person, 'key' | 'name' | 'idPassport'>): string {
  return p.key.startsWith('seat:')
    ? sha(JSON.stringify(['seat', p.key, norm(p.name), norm(p.idPassport)]))
    : sha(JSON.stringify(['key', p.key]));
}
/** The person on the manifest a link row belongs to, if they are still on it. */
const holderOf = (L: Loaded, l: Row) =>
  L.c731.people.find(
    (x) => x.role === 'PAX' && x.key === l.person_key && l.person_hash != null && l.person_hash === personHash(x),
  );

interface Loaded {
  flight: Flight;
  aircraft: Aircraft | null;
  pilot: Pilot;
  c731: Form731Content;
  gendec: GenDecContent;
  hash731: string;
  hashGendec: string;
  /** This pilot may not send forms by e-mail (no e-mail address to cc; a string: why not, e.g. not the owner). */
  mailDenied: boolean | string;
  /** Saved passengers' e-mail addresses, by passenger id (= their person key). */
  emails: Map<string, string>;
}

async function loadForms(
  db: Queryable,
  pilot: Pilot,
  flightId: string,
  mailDenied: boolean | string = true,
): Promise<Loaded> {
  const [r] = await db.query('SELECT * FROM flights WHERE id = $1 AND pilot_id = $2', [flightId, pilot.id]);
  if (!r) throw notFound('no such flight');
  const crew = await db.query('SELECT * FROM flight_crew WHERE flight_id = $1 AND pilot_id = $2', [flightId, pilot.id]);
  const flight = toFlight(r, crew);
  // the flight's aircraft when the pilot owns it or it is shared with them (else none: unavailable)
  const [a] = flight.aircraftId
    ? await db.query(`${AIRCRAFT_FROM} WHERE a.id = $1 AND ${accessibleSql('a', '$2')}`, [flight.aircraftId, pilot.id])
    : [];
  const aircraft = a ? toAircraft(a) : null;
  const passengers = (await db.query('SELECT * FROM passengers WHERE pilot_id = $1', [pilot.id])).map(toPassenger);
  const emails = new Map(passengers.filter((p) => p.email).map((p) => [p.id, p.email]));
  const ref = await loadRef(db);
  const byId = new Map(ref.aerodromes.map((x) => [x.id.toUpperCase(), x]));
  const byIcao = new Map(ref.aerodromes.filter((x) => x.icao).map((x) => [x.icao!.toUpperCase(), x]));
  const lookup: AerodromeLookup = (k) => (k ? (byId.get(k.toUpperCase()) ?? byIcao.get(k.toUpperCase())) : undefined);
  const c731 = form731Content(flight, aircraft, pilot, passengers, lookup);
  const gendec = genDecContent(flight, aircraft, pilot, passengers, lookup);
  return {
    flight,
    aircraft,
    pilot,
    c731,
    gendec,
    hash731: sha(form731SigningText(c731)),
    hashGendec: sha(genDecText(gendec)),
    mailDenied,
    emails,
  };
}

export async function form731Hash(db: Queryable, pilot: Pilot, flightId: string): Promise<string> {
  return (await loadForms(db, pilot, flightId)).hash731;
}

/** A signing link works until the end of the day after the flight (UTC)… */
const LINK_DAYS_FROM_FLIGHT = 2;
/** …or, for a flight without a date, this many days from now… */
const LINK_DAYS_UNDATED = 7;
/** …and never more than this many days after the link was made. */
const LINK_MAX_DAYS = 14;

export function linkExpiry(date: string, now: number): number {
  const d = Date.parse(`${date}T00:00:00Z`);
  return Math.min(
    Number.isFinite(d) ? d + LINK_DAYS_FROM_FLIGHT * DAY : now + LINK_DAYS_UNDATED * DAY,
    now + LINK_MAX_DAYS * DAY,
  );
}

/**
 * Records `key`'s signature of the form version `hash` (one row per flight and person). A row of
 * another pilot is never touched. `keepSigned`: a signature of this same version stays as it is
 * (its time too); only a changed form is signed anew (the PIC's automatic signatures).
 */
async function upsertSignature(
  db: Queryable,
  s: {
    flightId: string;
    pilotId: string;
    key: string;
    name: string;
    hash: string;
    at?: number;
    keepSigned?: boolean;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO form_signatures (flight_id, pilot_id, person_key, signer_name, signed_at, text_hash) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (flight_id, person_key) DO UPDATE SET signer_name = EXCLUDED.signer_name, signed_at = EXCLUDED.signed_at, text_hash = EXCLUDED.text_hash
     WHERE form_signatures.pilot_id = EXCLUDED.pilot_id${s.keepSigned ? ' AND form_signatures.text_hash <> EXCLUDED.text_hash' : ''}`,
    [s.flightId, s.pilotId, s.key, s.name, s.at ?? Date.now(), s.hash],
  );
}

/** The PIC signs the current version automatically ("signed when the form is prepared"). */
async function signPic(db: Queryable, L: Loaded): Promise<void> {
  const pic = L.c731.people.find((p) => p.role === 'PIC');
  if (!pic || !pic.name) return;
  await upsertSignature(db, {
    flightId: L.flight.id,
    pilotId: L.pilot.id,
    key: pic.key,
    name: pic.name,
    hash: L.hash731,
    keepSigned: true,
  });
}

/**
 * The PIC signs the General Declaration's current version automatically, like Form 731: the
 * signature (and its time) stays while the declaration is unchanged and is renewed when it changes.
 */
async function signGenDecPic(db: Queryable, L: Loaded): Promise<PdfSignature | null> {
  const name = L.gendec.picName.trim();
  if (!name) return null;
  await upsertSignature(db, {
    flightId: L.flight.id,
    pilotId: L.pilot.id,
    key: GENDEC_PIC_KEY,
    name,
    hash: L.hashGendec,
    keepSigned: true,
  });
  const [s] = await db.query(
    'SELECT * FROM form_signatures WHERE flight_id = $1 AND pilot_id = $2 AND person_key = $3',
    [L.flight.id, L.pilot.id, GENDEC_PIC_KEY],
  );
  return s && s.text_hash === L.hashGendec
    ? { key: GENDEC_PIC_KEY, name: s.signer_name, signedAt: Number(s.signed_at) }
    : null;
}

async function signatureRows(db: Queryable, pilotId: string, flightId: string) {
  return db.query('SELECT * FROM form_signatures WHERE flight_id = $1 AND pilot_id = $2', [flightId, pilotId]);
}

export async function submission(
  db: Queryable,
  pilotId: string,
  flightId: string,
  form: SentForm,
  hash: string,
): Promise<SubmissionState | null> {
  const [s] = await db.query('SELECT * FROM form_submissions WHERE flight_id = $1 AND pilot_id = $2 AND form = $3', [
    flightId,
    pilotId,
    form,
  ]);
  return s
    ? { sentAt: Number(s.sent_at), messageId: s.message_id, to: s.to_addr, changed: s.text_hash !== hash }
    : null;
}

/**
 * Whether a handler submits the General Declaration at both ends (src/calc/aerodromeStatus.ts genDecHandling):
 * handling per the AIP (AD 2.3 item 9 / AD 1.6) at the departure at block start and at the destination at
 * block stop, overlaid with the flight's last NOTAM briefing (flight_notams; none = AIP only). The flight's
 * options.genDecHandled overrides it. (The old profile setting handledAerodromes is no longer used.)
 */
async function genDecDecision(db: Queryable, L: Loaded): Promise<GenDecHandling> {
  const ctx = await flightContext(db, L.pilot.id, L.flight.id);
  const [n] = await db.query<{ doc: NotamBriefing }>(
    'SELECT doc FROM flight_notams WHERE flight_id = $1 AND pilot_id = $2',
    [L.flight.id, L.pilot.id],
  );
  const effects = aerodromeNotamEffects(n?.doc?.notams ?? []);
  const byId = new Map(ctx.ref.aerodromes.map((x) => [x.id.toUpperCase(), x]));
  const byIcao = new Map(ctx.ref.aerodromes.filter((x) => x.icao).map((x) => [x.icao!.toUpperCase(), x]));
  const adOf = (p: RoutePoint | undefined): RefAerodrome | null =>
    p && p.kind === 'aerodrome'
      ? (byId.get(String(p.refId ?? '').toUpperCase()) ?? byIcao.get(p.name.toUpperCase()) ?? null)
      : null;
  const route = L.flight.route;
  const dayMs = Date.parse(`${L.flight.date}T00:00:00Z`);
  const t = (ms: number) => (ctx.timed ? ms : NaN);
  const ends = [];
  if (route.length)
    ends.push({
      role: 'departure' as const,
      code: L.gendec.departureCode || route[0].name,
      aerodrome: adOf(route[0]),
      fromMs: t(ctx.blockOff),
      toMs: t(ctx.blockOff),
      dayMs,
    });
  if (route.length > 1) {
    ends.push({
      role: 'destination' as const,
      code: L.gendec.arrivalCode || route[route.length - 1].name,
      aerodrome: adOf(route[route.length - 1]),
      fromMs: t(ctx.blockOn),
      toMs: t(ctx.blockOn),
      dayMs,
    });
  }
  return genDecHandling(ends, L.flight.options.genDecHandled ?? null, { effects, sunTables: ctx.ref.sun });
}

async function state(db: Queryable, L: Loaded, links?: Record<string, string>): Promise<FormsState> {
  await signPic(db, L);
  const gdSig = await signGenDecPic(db, L);
  const sigs = await signatureRows(db, L.pilot.id, L.flight.id);
  const linkRows = await db.query(
    'SELECT * FROM form_links WHERE flight_id = $1 AND pilot_id = $2 ORDER BY created DESC',
    [L.flight.id, L.pilot.id],
  );
  const emailed = await db.query(
    `SELECT lower(recipient) AS recipient, max(at) AS at FROM mail_log
     WHERE pilot_id = $1 AND flight_id = $2 AND form = '731-pax' AND result = 'sent' GROUP BY lower(recipient)`,
    [L.pilot.id, L.flight.id],
  );
  const signatures: SignatureState[] = L.c731.people.map((p) => {
    const s0 = sigs.find((x) => x.person_key === p.key);
    // a seat-keyed signature by whoever sat there before is not this person's
    const s = s0 && (!p.key.startsWith('seat:') || norm(s0.signer_name) === norm(p.name)) ? s0 : undefined;
    const l = linkRows.find((x) => x.person_key === p.key && holderOf(L, x) === p);
    const signed = !!s && s.text_hash === L.hash731;
    const email = p.role === 'PAX' ? (L.emails.get(p.key) ?? '') : '';
    const sent = email && emailed.find((x) => x.recipient === email.toLowerCase());
    return {
      key: p.key,
      role: p.role,
      name: p.name,
      signed,
      signedAt: signed ? Number(s.signed_at) : null,
      needsResign: !!s && !signed,
      email,
      emailedAt: sent ? Number(sent.at) : null,
      link:
        p.role === 'PAX' && l
          ? {
              created: Number(l.created),
              firstOpened: l.first_opened == null ? null : Number(l.first_opened),
              lastOpened: l.last_opened == null ? null : Number(l.last_opened),
              revoked: !!l.revoked,
              expires: Number(l.expires),
            }
          : null,
    };
  });
  const mail = mailFor(L);
  const handling = await genDecDecision(db, L);
  return {
    form731: {
      content: L.c731,
      signatures,
      allSigned: signatures.every((s) => s.signed),
      submission: await submission(db, L.pilot.id, L.flight.id, '731', L.hash731),
    },
    gendec: {
      content: L.gendec,
      submission: await submission(db, L.pilot.id, L.flight.id, 'gendec', L.hashGendec),
      pilotSends: handling.pilotSends,
      handling,
      picSignature: gdSig ? { name: gdSig.name, signedAt: gdSig.signedAt } : null,
    },
    emailEnabled: mail.enabled,
    emailReason: mail.reason,
    ...(links ? { links } : {}),
  };
}

async function newLink(db: Queryable, L: Loaded, person: Form731Person): Promise<string> {
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  await db.query('UPDATE form_links SET revoked = TRUE WHERE flight_id = $1 AND pilot_id = $2 AND person_key = $3', [
    L.flight.id,
    L.pilot.id,
    person.key,
  ]);
  await db.query(
    'INSERT INTO form_links (id, pilot_id, flight_id, person_key, person_hash, token_hash, created, expires) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      await newId('fl'),
      L.pilot.id,
      L.flight.id,
      person.key,
      personHash(person),
      hashToken(token),
      now,
      linkExpiry(L.flight.date, now),
    ],
  );
  return token;
}

const fmtDay = fmtDate;

const MAIL_DENIED = 'Your account has no e-mail address to copy the forms to.';
const NOT_OWNER = 'Only the flight’s owner sends its forms.';
/** Whether this pilot can send forms by e-mail: configured on the server, and the pilot has an e-mail to cc. */
function mailFor(L: Loaded): { enabled: boolean; reason: string | null } {
  if (typeof L.mailDenied === 'string') return { enabled: false, reason: L.mailDenied };
  return L.mailDenied ? { enabled: false, reason: MAIL_DENIED } : mailAvailability();
}
function requireMail(L: Loaded): void {
  const mail = mailFor(L);
  if (!mail.enabled)
    throw new HttpError(L.mailDenied ? 403 : 503, mail.reason!, { error: mail.reason, emailEnabled: false });
}

const CLAIM_MS = 60e3; // longer than the W&B and performance print (25 s, sheetPdf.ts) and the mail provider's timeout (20 s)

/**
 * Sends a form once per version. Claims (flight, form) first so that concurrent requests cannot both
 * send, then refuses a version that was already sent unless the client asked for it again (resend).
 */
async function sendOnce(
  db: Queryable,
  L: Loaded,
  form: '731' | 'gendec',
  hash: string,
  resend: boolean,
  pdf: () => Promise<Buffer> | Buffer,
): Promise<void> {
  requireMail(L);
  requireHcaaWindow(L.flight.date);
  const m = formMail(L, form);
  await sendFormOnce(
    db,
    { flightId: L.flight.id, pilotId: L.pilot.id, form, hash, resend, to: m.to, subject: m.subject },
    async () => sendForm(L, m, await pdf()),
  );
}

/** HCAA forms only for flights from yesterday to HCAA_MAX_DAYS_AHEAD days ahead (UTC days). */
export const HCAA_MAX_DAYS_AHEAD = 14;
export function requireHcaaWindow(date: string, now = Date.now()): void {
  const d = Date.parse(`${date}T00:00:00Z`);
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d)) throw badRequest('the flight has no valid date');
  if (d < today - DAY)
    throw conflict('The flight is in the past: forms are sent to the HCAA only for flights from yesterday on.');
  if (d > today + HCAA_MAX_DAYS_AHEAD * DAY)
    throw conflict(`The flight is more than ${HCAA_MAX_DAYS_AHEAD} days ahead: send the forms closer to the date.`);
}

export type SentForm = '731' | 'gendec' | 'wbperf';

/**
 * Sending any form of a flight once per version (Form 731, the GenDec, the W&B and performance sheets
 * to the operator: routes/declarations.ts): claims (flight, form) first so that concurrent requests
 * cannot both send, refuses a version already sent unless `resend`, sends, records what was sent.
 */
export async function sendFormOnce(
  db: Queryable,
  f: { flightId: string; pilotId: string; form: SentForm; hash: string; resend: boolean; to: string; subject: string },
  send: () => Promise<{ id: string }>,
): Promise<void> {
  const now = Date.now();
  const until = now + CLAIM_MS;
  const claimed = await db.query(
    `INSERT INTO form_send_claims (flight_id, pilot_id, form, until) VALUES ($1,$2,$3,$4)
     ON CONFLICT (flight_id, form) DO UPDATE SET until = EXCLUDED.until
     WHERE form_send_claims.pilot_id = EXCLUDED.pilot_id AND form_send_claims.until < $5
     RETURNING flight_id`,
    [f.flightId, f.pilotId, f.form, until, now],
  );
  if (!claimed.length) throw conflict('this form is being sent right now');
  try {
    const prev = await submission(db, f.pilotId, f.flightId, f.form, f.hash);
    if (prev && !prev.changed && !f.resend) {
      throw conflict('this version of the form was already sent; send {"resend": true} to send it again');
    }
    // the sending caps (sendCaps.ts): 429 over them; a failed send does not count; all logged
    const reservation = await reserveMail(db, {
      pilotId: f.pilotId,
      flightId: f.flightId,
      form: f.form,
      recipient: f.to,
      subject: f.subject,
    });
    let sent;
    try {
      sent = await send();
    } catch (e) {
      await mailFailed(db, reservation, e);
      throw e;
    }
    await mailSent(db, reservation, sent.id);
    await db.query(
      `INSERT INTO form_submissions (flight_id, pilot_id, form, sent_at, message_id, to_addr, text_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (flight_id, form) DO UPDATE SET sent_at = EXCLUDED.sent_at, message_id = EXCLUDED.message_id, to_addr = EXCLUDED.to_addr, text_hash = EXCLUDED.text_hash
       WHERE form_submissions.pilot_id = EXCLUDED.pilot_id`,
      [f.flightId, f.pilotId, f.form, Date.now(), sent.id, f.to, f.hash],
    );
  } finally {
    await db.query('DELETE FROM form_send_claims WHERE flight_id = $1 AND pilot_id = $2 AND form = $3 AND until = $4', [
      f.flightId,
      f.pilotId,
      f.form,
      until,
    ]);
  }
}

interface FormMail {
  to: string;
  subject: string;
  text: string;
  filename: string;
}

function formMail(L: Loaded, form: '731' | 'gendec'): FormMail {
  const to = form === '731' ? FORM731_TO : GENDEC_TO;
  const route = L.c731.route.split(' – ').join(' → ');
  const what = form === '731' ? 'Form 731' : 'General Declaration';
  const subject = [what, L.c731.registration, route, fmtDay(L.flight.date)].filter(Boolean).join(' · ');
  const pic = L.c731.people.find((p) => p.role === 'PIC');
  const text = [
    `${what} for the flight of ${L.c731.registration || 'the aircraft'} on ${L.c731.date || 'the date shown'}, route ${L.c731.route || '–'}, attached as PDF.`,
    '',
    `Pilot in command: ${pic?.name || L.pilot.fullName}${pic?.contact ? `, ${pic.contact}` : ''}${L.pilot.email ? `, ${L.pilot.email}` : ''}.`,
    'Replies go to the pilot in command.',
  ].join('\n');
  const filename = `${form === '731' ? 'Form731' : 'GenDec'}_${(L.c731.registration || 'aircraft').replace(/[^A-Za-z0-9]/g, '')}_${L.flight.date || 'undated'}.pdf`;
  return { to, subject, text, filename };
}

async function sendForm(L: Loaded, m: FormMail, pdf: Buffer): Promise<{ id: string }> {
  try {
    return await sendMail({
      to: [m.to],
      pilotEmail: L.pilot.email || '',
      subject: m.subject,
      text: m.text,
      attachments: [{ filename: m.filename, content: pdf, contentType: 'application/pdf' }],
    });
  } catch (e) {
    const msg = e instanceof MailError ? e.message : 'the e-mail could not be sent';
    if (!(e instanceof MailError)) console.warn('forms mail:', String((e as Error)?.message || e));
    throw Object.assign(new HttpError(502, msg), { cause: e });
  }
}

/** The form as one person sees it: other people's ID and phone masked (the signing page does the same). */
function maskOthers(c: Form731Content, me: string): Form731Content {
  return {
    ...c,
    people: c.people.map((p) =>
      p.key === me ? p : { ...p, idPassport: maskTail(p.idPassport), contact: maskTail(p.contact) },
    ),
  };
}

// ---------------------------------------------------------------- signing page (no sign-in)

async function linkOf(db: Queryable, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound('This signing link is not valid.');
  const [l] = await db.query('SELECT * FROM form_links WHERE token_hash = $1', [hashToken(token)]);
  if (!l || l.revoked) throw notFound('This signing link is not valid.');
  if (Number(l.expires) < Date.now()) throw new HttpError(410, 'This signing link has expired.');
  const [p] = await db.query('SELECT * FROM pilots WHERE id = $1', [l.pilot_id]);
  if (!p) throw notFound('This signing link is not valid.');
  const L = await loadForms(db, toPilot(p), l.flight_id).catch((e) => {
    if (e instanceof HttpError && e.status === 404) throw notFound('This signing link is not valid.');
    throw e;
  });
  // the same key held by someone else (another person in that seat) is not the holder
  const me = holderOf(L, l);
  if (!me) throw new HttpError(410, 'You are no longer on this flight’s manifest.');
  return { l, L, me };
}

async function signingView(db: Queryable, L: Loaded, holder: Form731Person): Promise<SigningView> {
  const sigs = await signatureRows(db, L.pilot.id, L.flight.id);
  const me = holder.key;
  return {
    content: maskOthers(L.c731, me),
    me,
    signatures: L.c731.people.map((p) => {
      const s = sigs.find((x) => x.person_key === p.key && x.text_hash === L.hash731);
      return { key: p.key, name: p.name, signedAt: s ? Number(s.signed_at) : null };
    }),
    flightDate: L.flight.date,
    expired: false,
  };
}

// ---------------------------------------------------------------- the signer's own details

type DetailKey = keyof SignerDetails;
/** What a signer changed since their link last signed: each field's first value → latest value. */
interface DetailsChanged {
  fields: Partial<Record<DetailKey, { from: string; to: string }>>;
  /** Other passengers (the PIC re-signs automatically) whose signatures the change invalidated. */
  resign: string[];
}

/** The body of PUT /sign/:token/details, checked and normalized as a passenger record is (rows.ts personColumns). */
function signerInput(b: JsonBody, cur: SignerDetails): SignerDetails {
  const unknown = Object.keys(b).filter((k) => !(SIGNER_DETAIL_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw badRequest(`only ${SIGNER_DETAIL_KEYS.join(', ')} can be changed here`);
  const p = personColumns(b, { ...EMPTY_PERSON, ...cur });
  const out: SignerDetails = { fullName: p.fullName.replace(/\s+/g, ' '), idNumber: p.idNumber, phone: p.phone };
  if (!out.fullName) throw badRequest('fullName is required');
  return out;
}

/**
 * Saves the signer's corrections to the pilot's passenger record (a passenger without one has only the
 * manifest) and to this flight's manifest row, whose snapshot the forms read first; the corrected
 * fields follow the record again. The flight's version moves on, so an editor still open on the old
 * manifest reloads it instead of saving it back.
 */
async function saveSignerDetails(
  db: Db,
  L: Loaded,
  me: Form731Person,
  linkId: string,
  next: SignerDetails,
  changed: DetailKey[],
): Promise<void> {
  const seat = me.key.startsWith('seat:') ? me.key.slice(5) : null;
  await db.transaction(async (tx) => {
    if (!seat)
      await tx.query(
        'UPDATE passengers SET full_name = $3, id_number = $4, phone = $5, updated = $6 WHERE id = $1 AND pilot_id = $2',
        [me.key, L.pilot.id, next.fullName, next.idNumber, next.phone, Date.now()],
      );
    const rows = await tx.query(
      seat
        ? "SELECT position, snapshot, overrides FROM flight_crew WHERE flight_id = $1 AND pilot_id = $2 AND role = 'PAX' AND passenger_id IS NULL AND seat = $3"
        : 'SELECT position, snapshot, overrides FROM flight_crew WHERE flight_id = $1 AND pilot_id = $2 AND passenger_id = $3',
      [L.flight.id, L.pilot.id, seat ?? me.key],
    );
    for (const r of rows) {
      const snapshot = { ...(r.snapshot ?? {}) };
      for (const k of changed) snapshot[k] = next[k];
      const overrides = ((r.overrides ?? []) as PersonKey[]).filter((k) => seat || !changed.includes(k as DetailKey));
      await tx.query(
        'UPDATE flight_crew SET snapshot = $4::jsonb, overrides = $5::jsonb WHERE flight_id = $1 AND pilot_id = $2 AND position = $3',
        [L.flight.id, L.pilot.id, r.position, JSON.stringify(snapshot), JSON.stringify(overrides)],
      );
    }
    await tx.query(
      `UPDATE flights SET version = version + 1, updated = (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT
       WHERE id = $1 AND pilot_id = $2`,
      [L.flight.id, L.pilot.id],
    );
    // a passenger without a record is their name and ID number (personHash): their link follows the correction
    if (seat)
      await tx.query('UPDATE form_links SET person_hash = $2 WHERE id = $1', [
        linkId,
        personHash({ key: me.key, name: next.fullName, idPassport: next.idNumber }),
      ]);
  });
}

/** This edit added to what the link holds already: first value → latest value; a field back where it began is dropped. */
function accumulate(
  prev: DetailsChanged | null,
  cur: SignerDetails,
  next: SignerDetails,
  changed: DetailKey[],
  resign: string[],
): DetailsChanged | null {
  const fields = { ...(prev?.fields ?? {}) };
  for (const k of changed) {
    const from = fields[k]?.from ?? cur[k];
    if (from === next[k]) delete fields[k];
    else fields[k] = { from, to: next[k] };
  }
  if (!Object.keys(fields).length) return null;
  return { fields, resign: [...new Set([...(prev?.resign ?? []), ...resign])] };
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/flights/:id/forms',
    async handler({ db, pilot, params, formsMailDenied }) {
      const g = await flightFor(db, pilot, params.id);
      const denied = g.role === 'owner' ? formsMailDenied : NOT_OWNER;
      return state(db, await loadForms(db, g.owner, params.id, denied));
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/forms/731/links',
    async handler({ db, pilot, params, formsMailDenied }) {
      await flightFor(db, pilot, params.id, 'owner');
      const L = await loadForms(db, pilot, params.id, formsMailDenied);
      const existing = await db.query(
        'SELECT person_key, person_hash FROM form_links WHERE flight_id = $1 AND pilot_id = $2 AND NOT revoked AND expires > $3',
        [L.flight.id, pilot.id, Date.now()],
      );
      // a link given to whoever held this key before does not count (newLink revokes it)
      const have = new Set(existing.filter((r) => holderOf(L, r)).map((r) => r.person_key as string));
      const links: Record<string, string> = {};
      const need = L.c731.people.filter((p) => p.role === 'PAX' && !have.has(p.key));
      await checkLinkCap(db, pilot.id, L.flight.id, need.length);
      for (const p of need) links[p.key] = await newLink(db, L, p);
      return state(db, L, links);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/forms/731/links/:key/renew',
    async handler({ db, pilot, params, formsMailDenied }) {
      await flightFor(db, pilot, params.id, 'owner');
      const L = await loadForms(db, pilot, params.id, formsMailDenied);
      const person = L.c731.people.find((p) => p.key === params.key && p.role === 'PAX');
      if (!person) throw notFound('no such passenger on this flight');
      await checkLinkCap(db, pilot.id, L.flight.id, 1);
      return state(db, L, { [params.key]: await newLink(db, L, person) });
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/forms/731/links/:key/revoke',
    async handler({ db, pilot, params, formsMailDenied }) {
      await flightFor(db, pilot, params.id, 'owner');
      const L = await loadForms(db, pilot, params.id, formsMailDenied);
      await db.query(
        'UPDATE form_links SET revoked = TRUE WHERE flight_id = $1 AND pilot_id = $2 AND person_key = $3',
        [L.flight.id, pilot.id, params.key],
      );
      return state(db, L);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/forms/731/send',
    async handler({ db, pilot, params, body, formsMailDenied }) {
      await flightFor(db, pilot, params.id, 'owner');
      const L = await loadForms(db, pilot, params.id, formsMailDenied);
      const st = await state(db, L);
      const missing = st.form731.signatures.filter((s) => !s.signed).map((s) => s.name || s.key);
      if (missing.length) throw conflict(`not everyone has signed: ${missing.join(', ')}`);
      const sigs = (await signatureRows(db, pilot.id, L.flight.id))
        .filter((s) => s.person_key !== GENDEC_PIC_KEY && s.text_hash === L.hash731)
        .map((s) => ({ key: s.person_key as string, name: s.signer_name as string, signedAt: Number(s.signed_at) }));
      await sendOnce(db, L, '731', L.hash731, (await body()).resend === true, () => form731Pdf(L.c731, sigs));
      return state(db, L);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/forms/731/email/:key',
    async handler({ db, pilot, params, req, config, formsMailDenied }) {
      await flightFor(db, pilot, params.id, 'owner');
      const L = await loadForms(db, pilot, params.id, formsMailDenied);
      const person = L.c731.people.find((p) => p.key === params.key && p.role === 'PAX');
      if (!person) throw notFound('no such passenger on this flight');
      const to = L.emails.get(person.key);
      if (!to) throw conflict(`${person.name || 'This passenger'} has no e-mail address`);
      requireMail(L);
      await checkLinkCap(db, pilot.id, L.flight.id, 1);
      const m = formMail(L, '731');
      const subject = m.subject;
      const reservation = await reserveMail(db, {
        pilotId: pilot.id,
        flightId: L.flight.id,
        form: '731-pax',
        recipient: to,
        subject,
      });
      try {
        const link = `${appOrigin(req, config.secureCookie)}/sign/${await newLink(db, L, person)}`;
        const sigs = (await signatureRows(db, pilot.id, L.flight.id))
          .filter((s) => s.person_key !== GENDEC_PIC_KEY && s.text_hash === L.hash731)
          .map((s) => ({ key: s.person_key as string, name: s.signer_name as string, signedAt: Number(s.signed_at) }));
        const pdf = form731Pdf(maskOthers(L.c731, person.key), sigs);
        const pic = L.c731.people.find((p) => p.role === 'PIC');
        const text = [
          `Form 731 (persons boarding) for the flight of ${L.c731.registration || 'the aircraft'} on ${L.c731.date || 'the date shown'}, route ${L.c731.route || '–'}, attached as PDF.`,
          '',
          `Please check your details and sign it here:`,
          link,
          '',
          `Pilot in command: ${pic?.name || L.pilot.fullName}${pic?.contact ? `, ${pic.contact}` : ''}${L.pilot.email ? `, ${L.pilot.email}` : ''}.`,
        ].join('\n');
        const sent = await sendForm(L, { to, subject, text, filename: m.filename }, pdf);
        await mailSent(db, reservation, sent.id);
      } catch (e) {
        await mailFailed(db, reservation, e);
        throw e;
      }
      return state(db, L);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/forms/gendec/send',
    async handler({ db, pilot, params, body, formsMailDenied }) {
      await flightFor(db, pilot, params.id, 'owner');
      const L = await loadForms(db, pilot, params.id, formsMailDenied);
      if (L.gendec.placeCount < 2) throw conflict('the route needs a departure and a destination');
      await sendOnce(db, L, 'gendec', L.hashGendec, (await body()).resend === true, async () =>
        genDecPdf(L.gendec, await signGenDecPic(db, L)),
      );
      return state(db, L);
    },
  },
  {
    // The flight's override of who sends the General Declaration: {handled: true} a handler submits it,
    // false the PIC sends it, null automatic (AIP + NOTAMs). Stored in the flight's options.genDecHandled.
    method: 'POST',
    path: '/flights/:id/forms/gendec/handled',
    async handler({ db, pilot, params, body, formsMailDenied }) {
      const g = await flightFor(db, pilot, params.id, 'edit');
      const b = await body();
      const v = b.handled;
      if (v !== null && typeof v !== 'boolean') throw badRequest('handled must be true, false or null');
      const r = await db.query(
        `UPDATE flights SET options = options || jsonb_build_object('genDecHandled', $3::jsonb), version = version + 1,
           updated = (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT
         WHERE id = $1 AND pilot_id = $2 RETURNING id`,
        [params.id, g.owner.id, JSON.stringify(v)],
      );
      if (!r.length) throw notFound('no such flight');
      return state(db, await loadForms(db, g.owner, params.id, g.role === 'owner' ? formsMailDenied : NOT_OWNER));
    },
  },
  {
    method: 'GET',
    path: '/sign/:token',
    auth: false,
    async handler({ db, params }) {
      const { l, L, me } = await linkOf(db, params.token);
      const now = Date.now();
      await db.query(
        'UPDATE form_links SET first_opened = COALESCE(first_opened, $2), last_opened = $2 WHERE id = $1',
        [l.id, now],
      );
      return signingView(db, L, me);
    },
  },
  {
    method: 'POST',
    path: '/sign/:token',
    auth: false,
    async handler({ db, params, req, config }) {
      const { l, L, me } = await linkOf(db, params.token);
      const now = Date.now();
      const before = await signingView(db, L, me);
      await upsertSignature(db, {
        flightId: L.flight.id,
        pilotId: L.pilot.id,
        key: me.key,
        name: me.name,
        hash: L.hash731,
        at: now,
      });
      await db.query(
        'UPDATE form_links SET first_opened = COALESCE(first_opened, $2), last_opened = $2 WHERE id = $1',
        [l.id, now],
      );
      const after = await signingView(db, L, me);
      // only a new signature of this version: opening the link again or re-signing sends nothing
      if (!before.signatures.find((s) => s.key === me.key)?.signedAt) {
        const changes = (l.details_changed ?? null) as DetailsChanged | null;
        await notifySigned(L, me, after, appOrigin(req, config.secureCookie), changes);
        if (changes) await db.query('UPDATE form_links SET details_changed = NULL WHERE id = $1', [l.id]);
      }
      return after;
    },
  },
  {
    method: 'PUT',
    path: '/sign/:token/details',
    auth: false,
    async handler({ db, params, body }) {
      const { l, L, me } = await linkOf(db, params.token);
      await rateLimit(db, 'signDetails', { subject: `link:${l.id}` });
      const cur = signerDetailsOf(me);
      const next = signerInput(await body(), cur);
      const changed = SIGNER_DETAIL_KEYS.filter((k) => next[k] !== cur[k]);
      if (!changed.length) return signingView(db, L, me);
      const validBefore = (await signatureRows(db, L.pilot.id, L.flight.id))
        .filter((s) => s.text_hash === L.hash731 && s.person_key !== me.key)
        .map((s) => s.person_key as string);
      await saveSignerDetails(db, L, me, l.id, next, changed);
      const after = await linkOf(db, params.token);
      await signPic(db, after.L);
      const validAfter = new Set(
        (await signatureRows(db, L.pilot.id, L.flight.id))
          .filter((s) => s.text_hash === after.L.hash731)
          .map((s) => s.person_key as string),
      );
      const resign = validBefore.filter(
        (k) => !validAfter.has(k) && after.L.c731.people.some((p) => p.key === k && p.role === 'PAX'),
      );
      const changes = accumulate(after.l.details_changed ?? null, cur, next, changed, resign);
      await db.query('UPDATE form_links SET details_changed = $2::jsonb WHERE id = $1', [
        l.id,
        changes && JSON.stringify(changes),
      ]);
      return signingView(db, after.L, after.me);
    },
  },
];

/**
 * Tells the pilot a passenger signed Form 731 (best effort: the signature stands even if the mail fails),
 * with the details they corrected before signing, unmasked (they are the pilot's own records), and who
 * has to sign again because of it.
 */
async function notifySigned(
  L: Loaded,
  signer: Form731Person,
  view: SigningView,
  origin: string,
  changes: DetailsChanged | null,
): Promise<void> {
  const to = String(L.pilot.email || '').trim();
  if (!to || !mailAvailability().enabled) return;
  const signed = view.signatures.filter((s) => s.signedAt != null).length;
  const total = view.signatures.length;
  const flight = [L.flight.title.trim(), fmtDate(L.flight.date)].filter(Boolean).join(', ');
  const fields = SIGNER_DETAIL_KEYS.flatMap((k) => {
    const c = changes?.fields[k];
    return c ? [{ k, ...c }] : [];
  });
  const resign = (changes?.resign ?? [])
    .filter((k) => !view.signatures.find((s) => s.key === k)?.signedAt)
    .map((k) => L.c731.people.find((p) => p.key === k)?.name)
    .filter((n): n is string => !!n);
  const shown = (v: string) => v || '(none)';
  const text = [
    `${signer.name} signed Form 731 for your flight ${flight}.`,
    signed === total
      ? `Everyone has signed (${signed} of ${total}): it is ready to send to HCAA.`
      : `${signed} of ${total} signed.`,
    ...(fields.length
      ? [
          '',
          `${signer.name} changed their details:`,
          ...fields.map((f) => `  ${SIGNER_DETAIL_LABELS[f.k]}: ${shown(f.from)} → ${shown(f.to)}`),
        ]
      : []),
    ...(resign.length ? ['', `These signatures need to be given again: ${resign.join(', ')}.`] : []),
    '',
    `${origin}/flights/${L.flight.id}/export/form731`,
  ].join('\n');
  const subject = `Form 731 signed by ${signer.name}${fields.length ? ' (details changed)' : ''}`;
  await sendSystemMail({ to: [to], subject, text }).catch((e) =>
    console.warn('731 signed mail:', String((e as Error)?.message || e)),
  );
}
