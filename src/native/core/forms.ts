// File & forms: what the Form 731, General Declaration and operator panels show and offer, from the
// API's states (GET /api/flights/:id/forms, /declarations), as the website's panels decide it.
import {
  addEmailPath,
  form731Actions,
  personActions,
  shownSignatures,
  signatureStatus,
  signatureSummary,
  signingShare,
} from '../../features/exports/form731/signatures';
import { genDecHandledOverride, genDecSendState } from '../../features/exports/gendec/send';
import { operatorSendState } from '../../features/exports/wbperf/send';
import { type DeclarationsState, wbPerfContentOf, wbPerfText } from '../../shared/declarations';
import { fmtLocalDayTime } from '../../shared/format';
import type { FormsState } from '../../shared/forms';
import { arg, type Json, nowOf, plain } from './shared';

/**
 * The Form 731 signatures panel. `links`: the signing links made in this session by person key (a
 * token is answered once, by the request that made it); `origin`: the site the links open on.
 */
export function form731Panel(
  input: Json<{ forms: FormsState; links?: Record<string, string> | null; origin?: string; now?: number }>,
) {
  const i = arg(input);
  const st = i.forms;
  const links = i.links ?? {};
  const origin = i.origin ?? 'https://pigsgottafly.com';
  return plain({
    needed: st.form731.needed !== false,
    allSigned: st.form731.allSigned,
    summary: signatureSummary(st),
    tone: st.form731.allSigned ? 'ok' : 'warn',
    signatures: shownSignatures(st),
    people: st.form731.signatures.map((s) => {
      const token = links[s.key];
      return {
        key: s.key,
        role: s.role,
        name: s.name || '(no name)',
        signed: s.signed,
        needsResign: s.needsResign,
        status: signatureStatus(s),
        email: s.email,
        emailed: s.emailedAt != null ? `e-mailed ${fmtLocalDayTime(s.emailedAt)}` : null,
        actions: personActions(s, !!token),
        addEmailPath: addEmailPath(s.key),
        link: token ? signingShare(st, s.name, token, origin) : null,
      };
    }),
    ...form731Actions(st, nowOf(i.now)),
    emailEnabled: st.emailEnabled,
  });
}

/**
 * The General Declaration's "Send to HCAA" panel. `handled` (optional): "Submitted by a handler" set
 * to that; `override` is then what POST /forms/gendec/handled takes.
 */
export function genDecPanel(input: Json<{ forms: FormsState; handled?: boolean | null }>) {
  const i = arg(input);
  const st = i.forms;
  return plain({
    ...genDecSendState(st),
    signature: st.gendec.picSignature,
    pilotSends: st.gendec.pilotSends,
    override: typeof i.handled === 'boolean' ? genDecHandledOverride(st.gendec.handling, i.handled) : null,
  });
}

/**
 * "Send to <operator>": null when the operator does not ask for the sheets. `hash`: the sheets shown
 * (SHA-256, base64url, of wbPerfContent's `text`), null while not known; `ready`: they are made.
 */
export function operatorPanel(
  input: Json<{ declarations: DeclarationsState | null; hash?: string | null; ready?: boolean }>,
) {
  const i = arg(input);
  return plain(operatorSendState(i.declarations ?? null, i.hash ?? null, i.ready !== false));
}

/** What the server hashes of sent sheets (POST /declarations/send normalizes them first). */
export function declarationText(input: Json<{ content: unknown }>) {
  return plain({ text: wbPerfText(wbPerfContentOf(arg(input).content)) });
}
