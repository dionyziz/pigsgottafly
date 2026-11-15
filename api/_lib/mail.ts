// Transactional e-mail for the forms sent to HCAA, through Resend's HTTP API (no SDK):
//   RESEND_API_KEY   enables sending (unset: "e-mail not configured" and the send buttons say so)
//   FORMS_FROM       sender, default "Pig's Gotta Fly <forms@pigsgottafly.com>" (the domain needs
//                    SPF/DKIM set up at Resend)
// Tests replace the transport with setMailTransport(); nothing is sent for real in tests.
export interface MailAttachment { filename: string; content: Buffer; contentType: string }
export interface Mail {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}
export type MailTransport = (m: Mail & { from: string }) => Promise<{ id: string }>;

let override: MailTransport | null = null;
/** Tests: route every message to fn (null restores the environment's transport). */
export function setMailTransport(fn: MailTransport | null): void { override = fn; }

export const DEFAULT_FROM = "Pig's Gotta Fly <forms@pigsgottafly.com>";

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
      from: m.from, to: m.to, cc: m.cc?.length ? m.cc : undefined, reply_to: m.replyTo || undefined, subject: m.subject, text: m.text,
      attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })),
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!res.ok || !body?.id) throw new MailError(`e-mail provider: ${body?.message || `HTTP ${res.status}`}`);
  return { id: body.id };
};

export async function sendMail(m: Mail): Promise<{ id: string }> {
  const from = process.env.FORMS_FROM || DEFAULT_FROM;
  return (override ?? resend)({ ...m, from });
}
