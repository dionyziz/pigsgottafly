// Flight-plan filing: the Filing panel's view and the checks before a plan, its delay or its
// cancellation is sent (src/features/exports/fpl/filing.ts, the module FilingPanel.tsx renders).
import {
  actionError,
  aftnAddress,
  cancelMessage,
  delayCheck,
  fileRequest,
  type FilingChoices,
  filingView as viewOf,
  fplHead,
  loadError,
} from '../../features/exports/fpl/filing';
import type { FilingState } from '../../shared/briefing';
import { arg, type Json, nowOf, plain } from './shared';

/**
 * The Filing panel for GET /api/flights/:id/filing's `state` and the pilot's `choices`: the status
 * and its tone, the backends, the addressees and copies, what each action allows. `message` is
 * fplMessage's AFTN text and `complete` whether it has every field: with them come `request` (the
 * body of POST /filing) and `head` (the plan's identification, aerodromes, EOBT and DOF, for the
 * confirmation). `typed`: an address being typed, answered as `typedAddress` (null: not one).
 */
export function filingView(
  input: Json<{
    state: FilingState | null;
    choices?: FilingChoices | null;
    message?: string | null;
    complete?: boolean | null;
    busy?: boolean | null;
    typed?: string | null;
  }>,
) {
  const i = arg(input);
  const v = viewOf(i.state ?? null, i.choices ?? {}, i.complete ?? true, !!i.busy);
  const message = i.message ?? null;
  return plain({
    ...v,
    request: message ? fileRequest(v, message) : null,
    head: message ? fplHead(message) : null,
    cancelMessage: cancelMessage(v.filing),
    typedAddress: i.typed != null ? aftnAddress(i.typed) : null,
  });
}

/** A delay of the filed plan to `eobt` (epoch ms): `{ problem, message }` (the DLA a fax carries). */
export function filingDelay(input: Json<{ state: FilingState | null; eobt: number; now?: number | null }>) {
  const i = arg(input);
  return plain(delayCheck(i.state?.filing ?? null, i.eobt, nowOf(i.now)));
}

/**
 * How a refused filing action reads: `{ text }` for `{ offline?, message? }` (the server's error);
 * with `load`, how a failed load of the filing state reads.
 */
export function filingError(input: Json<{ offline?: boolean | null; message?: string | null; load?: boolean | null }>) {
  const i = arg(input);
  return { text: i.load ? loadError(!!i.offline) : actionError({ offline: !!i.offline, message: i.message ?? null }) };
}
