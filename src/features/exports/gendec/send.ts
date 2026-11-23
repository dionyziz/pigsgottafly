// What the General Declaration's "Send to HCAA" panel shows and offers for a FormsState: who sends it
// (each end's handling with its reason, the flight's override), its status and when Send can be
// pressed. Pure, so the website's GenDecSendPanel and the iPhone app (PGF.genDecPanel) show the same.
import type { GenDecHandling } from '../../../calc/aerodromeStatus';
import { fmtLocalDayTime } from '../../../shared/format';
import type { FormsState } from '../../../shared/forms';

export interface GenDecSendState {
  status: string;
  tone: 'ok' | 'warn';
  /** Only when the PIC sends it (an end without a handler, or the flight's override). */
  send: { label: string; enabled: boolean; hint: string | null } | null;
  sent: string | null;
  note: string | null;
  /** Each end: "Departure LGTT: no handling (AIP AD 1.6.5.4)". */
  ends: { role: 'departure' | 'destination'; label: string; reason: string; handled: boolean }[];
  /** "Submitted by a handler": the decision in force. */
  handled: boolean;
  /** The flight overrides the automatic decision: what the automatic one is. */
  automatic: string | null;
}

export function genDecSendState(st: FormsState): GenDecSendState {
  const g = st.gendec;
  const sub = g.submission;
  const h = g.handling;
  return {
    status: !g.pilotSends ? 'Handled' : sub ? (sub.changed ? 'Changed since it was sent' : 'Sent') : 'Not sent',
    tone: g.pilotSends ? (sub && !sub.changed ? 'ok' : 'warn') : 'ok',
    send: g.pilotSends
      ? {
          label: sub ? 'Re-send to HCAA' : 'Send to HCAA',
          enabled: st.emailEnabled && (!sub || sub.changed) && g.content.placeCount >= 2,
          hint: !st.emailEnabled ? (st.emailReason ?? '') : null,
        }
      : null,
    sent: sub ? `Sent to ${sub.to} on ${fmtLocalDayTime(sub.sentAt)}` : null,
    note: g.pilotSends && !st.emailEnabled ? st.emailReason : null,
    ends: h.ends.map((e) => ({
      role: e.role,
      label: e.role === 'departure' ? 'Departure' : 'Destination',
      reason: e.reason,
      handled: e.handled,
    })),
    handled: !g.pilotSends,
    automatic: h.override !== null ? `Automatic: ${h.autoPilotSends ? 'you send it' : 'handled'}` : null,
  };
}

/**
 * The override to save when "Submitted by a handler" is set to `handled`: choosing what the automatic
 * decision says goes back to automatic (null), so a later AIP or NOTAM change still applies.
 */
export function genDecHandledOverride(h: Pick<GenDecHandling, 'autoPilotSends'>, handled: boolean): boolean | null {
  return handled === !h.autoPilotSends ? null : handled;
}
