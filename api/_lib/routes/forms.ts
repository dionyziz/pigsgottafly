// Form 731 signatures and sending the forms to HCAA by e-mail (PLAN-v3 "Form 731: signatures and
// submission to HCAA", "Sending forms to HCAA by email"). Bodies: src/shared/forms.ts.
//   GET  /flights/:id/forms                        state of both forms (the PIC signs automatically)
//   POST /flights/:id/forms/731/links              a link per passenger who has none (tokens returned once)
//   POST /flights/:id/forms/731/links/:key/renew   a new link for that person (the old one stops working)
//   POST /flights/:id/forms/731/links/:key/revoke  that person's link stops working
//   POST /flights/:id/forms/731/send               PDF to 731@hcaa.gov.gr, cc/reply-to the pilot (409 until all signed)
//   POST /flights/:id/forms/gendec/send            PDF to gendec@hcaa.gov.gr, cc/reply-to the pilot
//   GET  /sign/:token                              the signing page's view (no sign-in): own row in full, others masked
//   POST /sign/:token                              signs the current version of the form
// A signature is for one version of the form (SHA-256 of every field, form731SigningText): when
// anything on the form changes, earlier signatures no longer count and the panel shows who must sign
// again. Links give access to that one form only, are stored hashed, can be revoked and expire at the
// end of the day after the flight.
import crypto from 'node:crypto';
import type { Route } from '../http.js';
import { conflict, HttpError, newId, notFound } from '../http.js';
import type { Queryable } from '../db.js';
import { toAircraft, toFlight, toPassenger, toPilot } from '../rows.js';
import { loadRef } from '../flightContext.js';
import { hashToken } from '../auth.js';
import { mailAvailability, MailError, sendMail } from '../mail.js';
import { form731Pdf, genDecPdf } from '../formPdf.js';
import type { Aircraft, Flight, Pilot } from '../../../src/shared/types.js';
import {
  FORM731_TO, GENDEC_TO, form731Content, form731SigningText, genDecContent, genDecText, maskTail,
  type AerodromeLookup, type Form731Content, type FormsState, type GenDecContent, type SignatureState, type SigningView, type SubmissionState,
} from '../../../src/shared/forms.js';

const DAY = 86400e3;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('base64url');

interface Loaded { flight: Flight; aircraft: Aircraft | null; pilot: Pilot; c731: Form731Content; gendec: GenDecContent; hash731: string; hashGendec: string }

async function loadForms(db: Queryable, pilot: Pilot, flightId: string): Promise<Loaded> {
  const [r] = await db.query('SELECT * FROM flights WHERE id = $1 AND pilot_id = $2', [flightId, pilot.id]);
  if (!r) throw notFound('no such flight');
  const crew = await db.query('SELECT * FROM flight_crew WHERE flight_id = $1 AND pilot_id = $2', [flightId, pilot.id]);
  const flight = toFlight(r, crew);
  const [a] = flight.aircraftId ? await db.query('SELECT * FROM aircraft WHERE id = $1 AND pilot_id = $2', [flight.aircraftId, pilot.id]) : [];
  const aircraft = a ? toAircraft(a) : null;
  const passengers = (await db.query('SELECT * FROM passengers WHERE pilot_id = $1', [pilot.id])).map(toPassenger);
  const ref = await loadRef(db);
  const byId = new Map(ref.aerodromes.map((x) => [x.id.toUpperCase(), x]));
  const byIcao = new Map(ref.aerodromes.filter((x) => x.icao).map((x) => [x.icao!.toUpperCase(), x]));
  const lookup: AerodromeLookup = (k) => (k ? byId.get(k.toUpperCase()) ?? byIcao.get(k.toUpperCase()) : undefined);
  const c731 = form731Content(flight, aircraft, pilot, passengers, lookup);
  const gendec = genDecContent(flight, aircraft, pilot, passengers, lookup);
  return { flight, aircraft, pilot, c731, gendec, hash731: sha(form731SigningText(c731)), hashGendec: sha(genDecText(gendec)) };
}

/** The end of the day after the flight (UTC); a flight without a date: a week from now. */
function linkExpiry(date: string, now: number): number {
  const d = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(d) ? d + 2 * DAY : now + 7 * DAY;
}

/** The PIC signs the current version automatically ("signed when the form is prepared"). */
async function signPic(db: Queryable, L: Loaded): Promise<void> {
  const pic = L.c731.people.find((p) => p.role === 'PIC');
  if (!pic || !pic.name) return;
  await db.query(
    `INSERT INTO form_signatures (flight_id, pilot_id, person_key, signer_name, signed_at, text_hash) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (flight_id, person_key) DO UPDATE SET signer_name = EXCLUDED.signer_name, signed_at = EXCLUDED.signed_at, text_hash = EXCLUDED.text_hash
     WHERE form_signatures.pilot_id = EXCLUDED.pilot_id AND form_signatures.text_hash <> EXCLUDED.text_hash`,
    [L.flight.id, L.pilot.id, pic.key, pic.name, Date.now(), L.hash731]);
}

async function signatureRows(db: Queryable, pilotId: string, flightId: string) {
  return db.query('SELECT * FROM form_signatures WHERE flight_id = $1 AND pilot_id = $2', [flightId, pilotId]);
}

async function submission(db: Queryable, pilotId: string, flightId: string, form: '731' | 'gendec', hash: string): Promise<SubmissionState | null> {
  const [s] = await db.query('SELECT * FROM form_submissions WHERE flight_id = $1 AND pilot_id = $2 AND form = $3', [flightId, pilotId, form]);
  return s ? { sentAt: Number(s.sent_at), messageId: s.message_id, to: s.to_addr, changed: s.text_hash !== hash } : null;
}

const pilotSendsGenDec = (L: Loaded) => {
  const handled = new Set(L.pilot.settings.handledAerodromes ?? []);
  const ends = [L.gendec.departureIcao, L.gendec.arrivalIcao];
  return ends.some((x) => !x || !handled.has(x));
};

async function state(db: Queryable, L: Loaded, links?: Record<string, string>): Promise<FormsState> {
  await signPic(db, L);
  const sigs = await signatureRows(db, L.pilot.id, L.flight.id);
  const linkRows = await db.query('SELECT * FROM form_links WHERE flight_id = $1 AND pilot_id = $2 ORDER BY created DESC', [L.flight.id, L.pilot.id]);
  const signatures: SignatureState[] = L.c731.people.map((p) => {
    const s = sigs.find((x) => x.person_key === p.key);
    const l = linkRows.find((x) => x.person_key === p.key);
    const signed = !!s && s.text_hash === L.hash731;
    return {
      key: p.key, role: p.role, name: p.name, signed, signedAt: signed ? Number(s.signed_at) : null, needsResign: !!s && !signed,
      link: p.role === 'PAX' && l ? {
        created: Number(l.created), firstOpened: l.first_opened == null ? null : Number(l.first_opened), lastOpened: l.last_opened == null ? null : Number(l.last_opened),
        revoked: !!l.revoked, expires: Number(l.expires),
      } : null,
    };
  });
  const mail = mailAvailability();
  return {
    form731: { content: L.c731, signatures, allSigned: signatures.every((s) => s.signed), submission: await submission(db, L.pilot.id, L.flight.id, '731', L.hash731) },
    gendec: { content: L.gendec, submission: await submission(db, L.pilot.id, L.flight.id, 'gendec', L.hashGendec), pilotSends: pilotSendsGenDec(L) },
    emailEnabled: mail.enabled,
    emailReason: mail.reason,
    ...(links ? { links } : {}),
  };
}

async function newLink(db: Queryable, L: Loaded, key: string): Promise<string> {
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  await db.query('UPDATE form_links SET revoked = TRUE WHERE flight_id = $1 AND pilot_id = $2 AND person_key = $3', [L.flight.id, L.pilot.id, key]);
  await db.query('INSERT INTO form_links (id, pilot_id, flight_id, person_key, token_hash, created, expires) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [await newId('fl'), L.pilot.id, L.flight.id, key, hashToken(token), now, linkExpiry(L.flight.date, now)]);
  return token;
}

const fmtDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
};

async function mailForm(L: Loaded, form: '731' | 'gendec', pdf: Buffer): Promise<{ id: string; to: string }> {
  const mail = mailAvailability();
  if (!mail.enabled) throw new HttpError(503, mail.reason!, { error: mail.reason, emailEnabled: false });
  const to = form === '731' ? FORM731_TO : GENDEC_TO;
  const route = L.c731.route.split(' – ').join(' → ');
  const what = form === '731' ? 'Form 731' : 'General Declaration';
  const subject = [what, L.c731.registration, route, fmtDay(L.flight.date)].filter(Boolean).join(' · ');
  const cc = L.pilot.email ? [L.pilot.email] : [];
  const pic = L.c731.people.find((p) => p.role === 'PIC');
  const text = [
    `${what} for the flight of ${L.c731.registration || 'the aircraft'} on ${L.c731.date || 'the date shown'}, route ${L.c731.route || '–'}, attached as PDF.`,
    '',
    `Pilot in command: ${pic?.name || L.pilot.fullName}${pic?.contact ? `, ${pic.contact}` : ''}${L.pilot.email ? `, ${L.pilot.email}` : ''}.`,
    'Replies go to the pilot in command.',
  ].join('\n');
  const filename = `${form === '731' ? 'Form731' : 'GenDec'}_${(L.c731.registration || 'aircraft').replace(/[^A-Za-z0-9]/g, '')}_${L.flight.date || 'undated'}.pdf`;
  try {
    const r = await sendMail({ to: [to], cc, replyTo: L.pilot.email || undefined, subject, text, attachments: [{ filename, content: pdf, contentType: 'application/pdf' }] });
    return { id: r.id, to };
  } catch (e) {
    const msg = e instanceof MailError ? e.message : 'the e-mail could not be sent';
    if (!(e instanceof MailError)) console.warn('forms mail:', String((e as Error)?.message || e));
    throw new HttpError(502, msg);
  }
}

async function recordSent(db: Queryable, L: Loaded, form: '731' | 'gendec', id: string, to: string, hash: string) {
  await db.query(
    `INSERT INTO form_submissions (flight_id, pilot_id, form, sent_at, message_id, to_addr, text_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (flight_id, form) DO UPDATE SET sent_at = EXCLUDED.sent_at, message_id = EXCLUDED.message_id, to_addr = EXCLUDED.to_addr, text_hash = EXCLUDED.text_hash
     WHERE form_submissions.pilot_id = EXCLUDED.pilot_id`,
    [L.flight.id, L.pilot.id, form, Date.now(), id, to, hash]);
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
  if (!L.c731.people.some((x) => x.key === l.person_key && x.role === 'PAX')) throw new HttpError(410, 'You are no longer on this flight’s manifest.');
  return { l, L };
}

async function signingView(db: Queryable, l: Record<string, any>, L: Loaded): Promise<SigningView> {
  const sigs = await signatureRows(db, L.pilot.id, L.flight.id);
  const me = l.person_key as string;
  return {
    content: {
      ...L.c731,
      people: L.c731.people.map((p) => (p.key === me ? p : { ...p, idPassport: maskTail(p.idPassport), contact: maskTail(p.contact) })),
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
    method: 'GET', path: '/flights/:id/forms',
    handler: async ({ db, pilot, params }) => state(db, await loadForms(db, pilot, params.id)),
  },
  {
    method: 'POST', path: '/flights/:id/forms/731/links',
    async handler({ db, pilot, params }) {
      const L = await loadForms(db, pilot, params.id);
      const existing = await db.query('SELECT person_key FROM form_links WHERE flight_id = $1 AND pilot_id = $2 AND NOT revoked AND expires > $3', [L.flight.id, pilot.id, Date.now()]);
      const have = new Set(existing.map((r) => r.person_key as string));
      const links: Record<string, string> = {};
      for (const p of L.c731.people) if (p.role === 'PAX' && !have.has(p.key)) links[p.key] = await newLink(db, L, p.key);
      return state(db, L, links);
    },
  },
  {
    method: 'POST', path: '/flights/:id/forms/731/links/:key/renew',
    async handler({ db, pilot, params }) {
      const L = await loadForms(db, pilot, params.id);
      if (!L.c731.people.some((p) => p.key === params.key && p.role === 'PAX')) throw notFound('no such passenger on this flight');
      return state(db, L, { [params.key]: await newLink(db, L, params.key) });
    },
  },
  {
    method: 'POST', path: '/flights/:id/forms/731/links/:key/revoke',
    async handler({ db, pilot, params }) {
      const L = await loadForms(db, pilot, params.id);
      await db.query('UPDATE form_links SET revoked = TRUE WHERE flight_id = $1 AND pilot_id = $2 AND person_key = $3', [L.flight.id, pilot.id, params.key]);
      return state(db, L);
    },
  },
  {
    method: 'POST', path: '/flights/:id/forms/731/send',
    async handler({ db, pilot, params }) {
      const L = await loadForms(db, pilot, params.id);
      const st = await state(db, L);
      const missing = st.form731.signatures.filter((s) => !s.signed).map((s) => s.name || s.key);
      if (missing.length) throw conflict(`not everyone has signed: ${missing.join(', ')}`);
      const sigs = (await signatureRows(db, pilot.id, L.flight.id)).filter((s) => s.text_hash === L.hash731)
        .map((s) => ({ key: s.person_key as string, name: s.signer_name as string, signedAt: Number(s.signed_at) }));
      const sent = await mailForm(L, '731', form731Pdf(L.c731, sigs));
      await recordSent(db, L, '731', sent.id, sent.to, L.hash731);
      return state(db, L);
    },
  },
  {
    method: 'POST', path: '/flights/:id/forms/gendec/send',
    async handler({ db, pilot, params }) {
      const L = await loadForms(db, pilot, params.id);
      if (L.gendec.placeCount < 2) throw conflict('the route needs a departure and a destination');
      const sent = await mailForm(L, 'gendec', genDecPdf(L.gendec));
      await recordSent(db, L, 'gendec', sent.id, sent.to, L.hashGendec);
      return state(db, L);
    },
  },
  {
    method: 'GET', path: '/sign/:token', auth: false,
    async handler({ db, params }) {
      const { l, L } = await linkOf(db, params.token);
      const now = Date.now();
      await db.query('UPDATE form_links SET first_opened = COALESCE(first_opened, $2), last_opened = $2 WHERE id = $1', [l.id, now]);
      return signingView(db, l, L);
    },
  },
  {
    method: 'POST', path: '/sign/:token', auth: false,
    async handler({ db, params }) {
      const { l, L } = await linkOf(db, params.token);
      const me = L.c731.people.find((p) => p.key === l.person_key)!;
      const now = Date.now();
      await db.query(
        `INSERT INTO form_signatures (flight_id, pilot_id, person_key, signer_name, signed_at, text_hash) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (flight_id, person_key) DO UPDATE SET signer_name = EXCLUDED.signer_name, signed_at = EXCLUDED.signed_at, text_hash = EXCLUDED.text_hash
         WHERE form_signatures.pilot_id = EXCLUDED.pilot_id`,
        [L.flight.id, L.pilot.id, me.key, me.name, now, L.hash731]);
      await db.query('UPDATE form_links SET first_opened = COALESCE(first_opened, $2), last_opened = $2 WHERE id = $1', [l.id, now]);
      return signingView(db, l, L);
    },
  },
];
