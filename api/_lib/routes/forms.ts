// Form 731 signatures and sending the forms to HCAA by e-mail (PLAN-v3 "Form 731: signatures and
// submission to HCAA", "Sending forms to HCAA by email"). Bodies: src/shared/forms.ts.
//   GET  /flights/:id/forms                        state of both forms (the PIC signs automatically)
//   POST /flights/:id/forms/731/links              a link per passenger who has none (tokens returned once)
//   POST /flights/:id/forms/731/links/:key/renew   a new link for that person (the old one stops working)
//   POST /flights/:id/forms/731/links/:key/revoke  that person's link stops working
//   POST /flights/:id/forms/731/send               PDF to 731@hcaa.gov.gr, cc/reply-to the pilot (409 until all signed)
//   POST /flights/:id/forms/gendec/send            PDF to gendec@hcaa.gov.gr, cc/reply-to the pilot
// Any signed-in pilot may send; the pilot is always cc'd. A version already sent is refused (409)
// unless the body is {"resend": true}; concurrent sends of one form are refused (409). Sends and
// signing links are capped per pilot and per flight in any 24 hours (api/_lib/sendCaps.ts, 429).
//   GET  /sign/:token                              the signing page's view (no sign-in): own row in full, others masked
//   POST /sign/:token                              signs the current version of the form
// A signature is for one version of the form (SHA-256 of every field, form731SigningText): when
// anything on the form changes, earlier signatures no longer count and the panel shows who must sign
// again. Links give access to that one form only, are stored hashed, can be revoked and expire at the
// end of the day after the flight, at most 14 days after they were made. A link is bound to the person it was given to (personHash): a
// passenger without a saved record is keyed by seat, and whoever later takes that seat is a different
// person whom the old link must not reach.
import crypto from 'node:crypto';

import { aerodromeNotamEffects, type GenDecHandling, genDecHandling } from '../../../src/calc/aerodromeStatus.js';
import type { NotamBriefing } from '../../../src/shared/briefing.js';
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
  type SigningView,
  type SubmissionState,
} from '../../../src/shared/forms.js';
import type { RefAerodrome } from '../../../src/shared/ref.js';
import type { RoutePoint } from '../../../src/shared/types.js';
import type { Aircraft, Flight, Pilot } from '../../../src/shared/types.js';
import { accessibleSql, AIRCRAFT_FROM } from '../access.js';
import { hashToken } from '../auth.js';
import type { Queryable } from '../db.js';
import { flightContext, loadRef } from '../flightContext.js';
import { form731Pdf, genDecPdf, type PdfSignature } from '../formPdf.js';
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, newId, notFound } from '../http.js';
import { mailAvailability, MailError, sendMail } from '../mail.js';
import { toAircraft, toFlight, toPassenger, toPilot } from '../rows.js';
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
const holderOf = (L: Loaded, l: Record<string, any>) =>
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
  /** This pilot may not send forms by e-mail (no e-mail address to cc). */
  mailDenied: boolean;
}

async function loadForms(db: Queryable, pilot: Pilot, flightId: string, mailDenied = true): Promise<Loaded> {
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
  };
}

/** The current version (hash) of a flight's Form 731. */
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
 * handling per the AIP (AD 2.3 item 9 / AD 1.6) at the departure at block-off and at the destination at
 * block-on, overlaid with the flight's last NOTAM briefing (flight_notams; none = AIP only). The flight's
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
  const signatures: SignatureState[] = L.c731.people.map((p) => {
    const s0 = sigs.find((x) => x.person_key === p.key);
    // a seat-keyed signature by whoever sat there before is not this person's
    const s = s0 && (!p.key.startsWith('seat:') || norm(s0.signer_name) === norm(p.name)) ? s0 : undefined;
    const l = linkRows.find((x) => x.person_key === p.key && holderOf(L, x) === p);
    const signed = !!s && s.text_hash === L.hash731;
    return {
      key: p.key,
      role: p.role,
      name: p.name,
      signed,
      signedAt: signed ? Number(s.signed_at) : null,
      needsResign: !!s && !signed,
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
/** Whether this pilot can send forms by e-mail: configured on the server, and the pilot has an e-mail to cc. */
function mailFor(L: Loaded): { enabled: boolean; reason: string | null } {
  return L.mailDenied ? { enabled: false, reason: MAIL_DENIED } : mailAvailability();
}
/** 403 for a pilot without an e-mail address, 503 when e-mail is not configured. */
function requireMail(L: Loaded): void {
  const mail = mailFor(L);
  if (!mail.enabled)
    throw new HttpError(L.mailDenied ? 403 : 503, mail.reason!, { error: mail.reason, emailEnabled: false });
}

const CLAIM_MS = 60e3; // longer than the mail provider's timeout (20 s)

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
    content: {
      ...L.c731,
      people: L.c731.people.map((p) =>
        p.key === me ? p : { ...p, idPassport: maskTail(p.idPassport), contact: maskTail(p.contact) },
      ),
    },
    me,
    signatures: L.c731.people.map((p) => {
      const s = sigs.find((x) => x.person_key === p.key && x.text_hash === L.hash731);
      return { key: p.key, name: p.name, signedAt: s ? Number(s.signed_at) : null };
    }),
    flightDate: L.flight.date,
    expired: false,
  };
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/flights/:id/forms',
    handler: async ({ db, pilot, params, formsMailDenied }) =>
      state(db, await loadForms(db, pilot, params.id, formsMailDenied)),
  },
  {
    method: 'POST',
    path: '/flights/:id/forms/731/links',
    async handler({ db, pilot, params, formsMailDenied }) {
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
    path: '/flights/:id/forms/gendec/send',
    async handler({ db, pilot, params, body, formsMailDenied }) {
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
      const b = await body();
      const v = b.handled;
      if (v !== null && typeof v !== 'boolean') throw badRequest('handled must be true, false or null');
      const r = await db.query(
        `UPDATE flights SET options = options || jsonb_build_object('genDecHandled', $3::jsonb), version = version + 1,
           updated = (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT
         WHERE id = $1 AND pilot_id = $2 RETURNING id`,
        [params.id, pilot.id, JSON.stringify(v)],
      );
      if (!r.length) throw notFound('no such flight');
      return state(db, await loadForms(db, pilot, params.id, formsMailDenied));
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
    async handler({ db, params }) {
      const { l, L, me } = await linkOf(db, params.token);
      const now = Date.now();
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
      return signingView(db, L, me);
    },
  },
];
