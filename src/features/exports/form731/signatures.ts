// What the Form 731 signatures panel shows and offers for a FormsState (GET /api/flights/:id/forms):
// each person's status and actions, the summary, and when "Send to HCAA" can be pressed. Pure, so the
// website's SignaturesPanel and the iPhone app (PGF.form731Panel) show the same.
import { fmtLocalClock, fmtLocalDayTime } from '../../../shared/format';
import type { FormsState, SignatureState } from '../../../shared/forms';

// times shown to the pilot are local (Greek) time
const hm = (ms: number) => fmtLocalClock(ms);
const dayHm = (ms: number) => fmtLocalDayTime(ms);
const firstName = (s: string) => s.trim().split(/\s+/)[0] || s;

/** A signature on the current version of the form: the signer's name and when (epoch ms). */
export interface ShownSignature {
  name: string;
  signedAt: number;
}

export function shownSignatures(st: FormsState | null): Record<string, ShownSignature> {
  const out: Record<string, ShownSignature> = {};
  for (const s of st?.form731.signatures ?? [])
    if (s.signed && s.signedAt) out[s.key] = { name: s.name, signedAt: s.signedAt };
  return out;
}

/** "2 of 3 signed · Maria opened 10:42, not signed" */
export function signatureSummary(st: FormsState): string {
  const sigs = st.form731.signatures;
  const n = sigs.filter((s) => s.signed).length;
  const parts = [`${n} of ${sigs.length} signed`];
  for (const s of sigs) {
    if (s.signed) continue;
    const who = firstName(s.name || 'Passenger');
    if (s.needsResign) parts.push(`${who} must sign again`);
    else if (s.link?.lastOpened) parts.push(`${who} opened ${hm(s.link.lastOpened)}, not signed`);
    else if (s.link && !s.link.revoked) parts.push(`${who} has not opened the link`);
    else if (s.role === 'PAX') parts.push(`${who}: no link yet`);
  }
  return parts.join(' · ');
}

/** One person's line: signed, or where their link stands. */
export function signatureStatus(s: SignatureState): string {
  const l = s.link;
  return s.signed
    ? `signed ${dayHm(s.signedAt!)}`
    : s.needsResign
      ? 'the form changed after signing: must sign again'
      : l && !l.revoked
        ? l.lastOpened
          ? `link opened ${dayHm(l.lastOpened)}, not signed`
          : `link created ${dayHm(l.created)}, not opened`
        : s.role === 'PAX'
          ? 'no link'
          : 'not signed (set your full name in the profile)';
}

export interface PersonActions {
  /** A new link (the old one stops working). */
  renew: boolean;
  revoke: boolean;
  /** E-mail them the form and a new link (a saved passenger with an address). */
  email: boolean;
  /** A saved passenger without an address: add one (a seat-only person has no record to add it to). */
  addEmail: boolean;
}

/** `shownLink`: a new link of theirs is on screen (made by this session; tokens are shown once). */
export function personActions(s: SignatureState, shownLink: boolean): PersonActions {
  const pax = s.role === 'PAX';
  const l = s.link;
  return {
    renew: pax && !!l && (!l.revoked || !shownLink),
    revoke: pax && !!l && !l.revoked,
    email: pax && !!s.email,
    addEmail: pax && !s.email && !s.key.startsWith('seat:'),
  };
}

/** The website's page where a passenger's e-mail address is added. */
export const addEmailPath = (key: string) => `/passengers?edit=${encodeURIComponent(key)}&fields=email`;

export interface Form731Actions {
  /** "Request signatures": a link for every passenger who has none that works. */
  request: { shown: boolean; enabled: boolean };
  /** "E-mail all": the passengers with an address who have not signed. */
  emailAll: { shown: boolean; enabled: boolean; keys: string[]; hint: string | null };
  send: { label: string; enabled: boolean; hint: string | null };
  /** "Sent to 731@hcaa.gov.gr on 2026-11-22 10:40 · changed since" */
  sent: string | null;
  /** Why the forms cannot be e-mailed from here (no address to copy, not the owner). */
  note: string | null;
}

export function form731Actions(st: FormsState, now = Date.now()): Form731Actions {
  const f = st.form731;
  const sub = f.submission;
  const pax = f.signatures.filter((s) => s.role === 'PAX');
  const needLinks = pax.some((s) => !s.signed && (!s.link || s.link.revoked || s.link.expires < now));
  const toEmail = pax.filter((s) => s.email && !s.signed);
  const reason = !st.emailEnabled ? (st.emailReason ?? '') : null;
  return {
    request: { shown: pax.length > 0, enabled: needLinks },
    emailAll: {
      shown: pax.some((s) => s.email),
      enabled: toEmail.length > 0 && st.emailEnabled,
      keys: toEmail.map((s) => s.key),
      hint: reason,
    },
    send: {
      label: sub ? 'Re-send to HCAA' : 'Send to HCAA',
      enabled: f.allSigned && st.emailEnabled && (!sub || sub.changed),
      hint: reason ?? (!f.allSigned ? 'Everyone has to sign first' : null),
    },
    sent: sub ? `Sent to ${sub.to} on ${dayHm(sub.sentAt)}${sub.changed ? ' · changed since' : ''}` : null,
    note: st.emailEnabled ? null : st.emailReason,
  };
}

/** The signing page of a link, and what goes with it when shared. */
export function signingShare(
  st: FormsState,
  name: string,
  token: string,
  origin: string,
): { url: string; text: string } {
  const date = st.form731.content.date;
  return {
    url: `${origin}/sign/${token}`,
    text: `Please sign Form 731 (persons boarding) for our flight${date ? ` on ${date}` : ''}, ${name}:`,
  };
}
