// The e-mail to someone an aircraft, an operator or a flight was just shared with, as Google Docs
// does: who shared what, the access they got and a link that opens it (the app's origin as the
// sharer's browser reached it). Someone invited to a flight without an account is told to sign in
// with Google or Apple using that address. Sent from the app, reply-to the sharer, logged in mail_log
// as 'share-aircraft', 'share-operator' or 'share-flight' and capped (sendCaps.ts). A share never fails because of its e-mail: a capped,
// failed or unconfigured send is logged (or skipped) and the share stands.
import type { ShareRole } from '../../src/shared/sharing.js';
import type { Pilot } from '../../src/shared/types.js';
import type { Queryable } from './db.js';
import { type ApiConfig, appOrigin, type Req } from './http.js';
import { mailAvailability, sendSystemMail } from './mail.js';
import { mailFailed, mailSent, reserveMail } from './sendCaps.js';

export interface ShareNotice {
  kind: 'aircraft' | 'operator' | 'flight';
  id: string;
  /** The registration, the operator's name or the flight's title. */
  name: string;
  /** For an aircraft: its make and model and ICAO type, when set; for a flight: its route, date and aircraft. */
  detail?: string;
  /** A flight shared with an address no account uses yet (an invite). */
  invite?: boolean;
  role: ShareRole;
  to: string;
}

const oneLine = (s: string, max = 120) =>
  s
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);

/** The subject and text of the notice (pure, for tests). */
export function shareMail(by: Pick<Pilot, 'fullName' | 'name' | 'email'>, n: ShareNotice, origin: string) {
  const who = oneLine(by.fullName || by.name || by.email || 'A pilot', 100);
  const what =
    n.kind === 'aircraft'
      ? `the aircraft ${oneLine(n.name)}`
      : n.kind === 'operator'
        ? `the operator ${oneLine(n.name)}`
        : `the flight ${oneLine(n.name)}`;
  const detail = n.detail ? ` (${oneLine(n.detail)})` : '';
  const path =
    n.kind === 'aircraft'
      ? `/hangar/${encodeURIComponent(n.id)}`
      : n.kind === 'operator'
        ? `/operators/${encodeURIComponent(n.id)}`
        : `/flights/${encodeURIComponent(n.id)}`;
  return {
    subject: `${who} shared ${what} with you`,
    text: [
      `${who}${by.email && by.email !== who ? ` (${by.email})` : ''} shared ${what}${detail} with you on Pig's Gotta Fly. You can ${n.role === 'edit' ? 'view and edit' : 'view'} it.`,
      ...(n.invite
        ? [
            '',
            `To open it, sign in with Google or Apple using this e-mail address (${oneLine(n.to, 320)}). Pig's Gotta Fly is free; signing in creates your account.`,
          ]
        : []),
      '',
      `${origin}${path}`,
    ].join('\n'),
  };
}

/** E-mails the notice; never throws (the outcome is in mail_log). */
export async function notifyShare(
  db: Queryable,
  ctx: { req: Req; config: ApiConfig; pilot: Pilot },
  n: ShareNotice,
): Promise<void> {
  if (!mailAvailability().enabled) return;
  const m = shareMail(ctx.pilot, n, appOrigin(ctx.req, ctx.config.secureCookie));
  let id: string | null = null;
  try {
    id = await reserveMail(db, {
      pilotId: ctx.pilot.id,
      flightId: null,
      form: `share-${n.kind}`,
      recipient: n.to,
      subject: m.subject,
    });
    const sent = await sendSystemMail({ to: [n.to], subject: m.subject, text: m.text, replyTo: ctx.pilot.email });
    await mailSent(db, id, sent.id);
  } catch (e) {
    // capped: the row already says so
    if (id) await mailFailed(db, id, e).catch(() => undefined);
    console.warn(`share notice (${n.kind}):`, String((e as Error)?.message || e));
  }
}
