// What "Send to <operator>" shows and offers for a DeclarationsState: shown only when the aircraft's
// operator asks for the W&B and performance sheets; "changed since sent" compares the sheets shown
// (their hash, sha256Url of wbPerfText) and the operator's address with what was sent. Pure, so the
// website's OperatorSendPanel and the iPhone app (PGF.operatorPanel) show the same.
import type { DeclarationsState } from '../../../shared/declarations';
import { fmtLocalDayTime } from '../../../shared/format';

export interface OperatorSendState {
  title: string;
  status: string;
  tone: 'ok' | 'warn';
  changed: boolean;
  send: { label: string; enabled: boolean; hint: string | null; resend: boolean };
  /** Where the sheets go; null: the operator has no address yet (`addressPath` sets it). */
  address: string | null;
  addressPath: string;
  sent: string | null;
  note: string | null;
}

/**
 * `hash`: the sheets shown now (null while hashing); `ready`: the sheets are made (not while their
 * weather loads). Null when there is nothing to send to the operator.
 */
export function operatorSendState(
  st: DeclarationsState | null,
  hash: string | null,
  ready: boolean,
): OperatorSendState | null {
  const op = st?.operator;
  if (!st || !op?.requiresWbPerf) return null;
  const sub = st.submission;
  const changed =
    !!sub && ((hash != null && hash !== sub.hash) || sub.to.toLowerCase() !== op.declarationsEmail.toLowerCase());
  return {
    title: `Send to ${op.name}`,
    status: !sub ? 'Not sent' : changed ? 'Changed since it was sent' : 'Sent',
    tone: sub && !changed ? 'ok' : 'warn',
    changed,
    send: {
      label: sub ? 'Re-send' : `Send to ${op.name}`,
      enabled: ready && st.emailEnabled && !!op.declarationsEmail && (!sub || changed),
      hint: !st.emailEnabled ? (st.emailReason ?? '') : null,
      resend: !!sub,
    },
    address: op.declarationsEmail || null,
    addressPath: `/operators/${op.id}?focus=declarationsEmail`,
    sent: sub ? `Sent to ${sub.to} on ${fmtLocalDayTime(sub.sentAt)}` : null,
    note: st.emailEnabled ? null : st.emailReason,
  };
}
