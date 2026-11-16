// Transactional e-mail for the forms sent to HCAA, through Resend's HTTP API (no SDK):
//   RESEND_API_KEY   enables sending (unset: "e-mail not configured" and the send buttons say so)
//   FORMS_FROM       sender, default "Pig's Gotta Fly <noreply@pigsgottafly.com>" (the domain needs
//                    SPF/DKIM set up at Resend)
// Every message is sent on behalf of a pilot, who is always cc'd and is the reply-to address, except
// the app's own notices to its admins (sendSystemMail).
// Tests replace the transport with setMailTransport(); nothing is sent for real in tests.
export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}
export interface Mail {
  to: string[];
  /** The pilot the message is sent for: always cc'd, and the reply-to address. */
  pilotEmail: string;
  cc?: string[];
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}
/** What the transport receives: the pilot is already in cc and is the reply-to. */
export type SentMail = Omit<Mail, 'pilotEmail'> & { from: string; replyTo?: string };
export type MailTransport = (m: SentMail) => Promise<{ id: string }>;

let override: MailTransport | null = null;
/** Tests: route every message to fn (null restores the environment's transport). */
export function setMailTransport(fn: MailTransport | null): void {
  override = fn;
}

export const DEFAULT_FROM = "Pig's Gotta Fly <noreply@pigsgottafly.com>";

export function mailAvailability(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; reason: string | null } {
  if (override || env.RESEND_API_KEY) return { enabled: true, reason: null };
  return { enabled: false, reason: 'E-mail is not configured on this server (RESEND_API_KEY is not set).' };
}

export class MailError extends Error {}

const resend: MailTransport = async (m) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new MailError('e-mail is not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: m.from,
      to: m.to,
      cc: m.cc?.length ? m.cc : undefined,
      reply_to: m.replyTo || undefined,
      subject: m.subject,
      text: m.text,
      attachments: (m.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
        content_type: a.contentType,
      })),
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!res.ok || !body?.id) throw new MailError(`e-mail provider: ${body?.message || `HTTP ${res.status}`}`);
  return { id: body.id };
};

export async function sendMail(m: Mail): Promise<{ id: string }> {
  const from = process.env.FORMS_FROM || DEFAULT_FROM;
  const { pilotEmail, ...rest } = m;
  const pilot = String(pilotEmail || '').trim();
  if (!pilot) throw new MailError('no pilot e-mail to cc');
  const lower = (x: string) => x.trim().toLowerCase();
  const cc = [...(rest.cc ?? []).filter((x) => lower(x) !== lower(pilot)), pilot];
  return (override ?? resend)({ ...rest, cc, replyTo: pilot, from });
}

/**
 * A message from the app itself, not sent on behalf of a pilot (e.g. the new-signup notice to the
 * admins): no cc, no reply-to, same sender and provider as the forms.
 */
export async function sendSystemMail(m: { to: string[]; subject: string; text: string }): Promise<{ id: string }> {
  if (!m.to.length) throw new MailError('no recipient');
  return (override ?? resend)({
    to: m.to,
    subject: m.subject,
    text: m.text,
    from: process.env.FORMS_FROM || DEFAULT_FROM,
  });
}
