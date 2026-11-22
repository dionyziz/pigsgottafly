// The manifest as the editor's Manifest section edits it (seats, PIC and passengers, snapshots that
// follow their person), the W&B chart's geometry and whom to offer the flight's sharing to.
import type { WbPoint } from '../../calc';
import {
  addPassengerToCrew,
  addPicToCrew,
  applyPerson,
  changeSeat,
  editCrewField,
  manifestSeats,
  personOf,
  resetCrew,
  syncCrew,
} from '../../features/editor/panels/manifest';
import { cgToMomentOutline, chartDomain, chartEnvelopes } from '../../features/exports/wb/model';
import { momentPolygonFromCg } from '../../features/hangar/model';
import {
  type EnvelopePoint,
  type FlightCrew,
  type MassBalance,
  type Passenger,
  type PersonDetails,
  type PersonKey,
  picSeat,
  type Station,
  validateCrew,
} from '../../shared';
import { manifestContacts, passengerShareSuggestions, type SharePerson } from '../../shared/sharing';
import { arg, type Json, plain } from './shared';

export type ManifestOp =
  | { op: 'seats' }
  | { op: 'addPassenger'; passenger: Passenger }
  | { op: 'addPic'; pilot: PersonDetails }
  | { op: 'changeSeat'; index: number; seat: string }
  | { op: 'remove'; index: number }
  | { op: 'editField'; index: number; key: PersonKey; value: PersonDetails[PersonKey] }
  | { op: 'apply'; index: number; person: PersonDetails }
  | { op: 'reset'; index: number; person: PersonDetails }
  | { op: 'sync'; before: Record<string, PersonDetails> | null; now: Record<string, PersonDetails> };

/**
 * One change of the manifest, as the Manifest section makes it. `stations` are the aircraft's mass and
 * balance stations (null without an aircraft: the four seats of a four-seater). Every answer has the
 * crew after the change, the seats, whether every seat is taken, the PIC's seat and the manifest's
 * problems (validateCrew, as computeFlight's crewErrors); `addPic` also says who moved to free the
 * PIC seat, and `ok: false` when every seat is taken.
 */
export function manifest(input: Json<{ crew?: FlightCrew[] | null; stations?: Station[] | null } & ManifestOp>) {
  const i = arg(input);
  const crew = i.crew ?? [];
  const stations = i.stations ?? null;
  const seats = manifestSeats(stations);
  const seatIds = seats.map((s) => s.id);
  const at = (k: number, fn: (c: FlightCrew) => FlightCrew) => crew.map((c, j) => (j === k ? fn(c) : c));
  let next = crew;
  let moved: FlightCrew | null = null;
  let ok = true;
  switch (i.op) {
    case 'seats':
      break;
    case 'addPassenger':
      next = addPassengerToCrew(crew, seatIds, i.passenger);
      ok = next !== crew;
      break;
    case 'addPic': {
      const r = addPicToCrew(crew, seatIds, personOf(i.pilot));
      if (r) ({ crew: next, moved } = r);
      ok = !!r;
      break;
    }
    case 'changeSeat':
      next = changeSeat(crew, i.index, i.seat);
      break;
    case 'remove':
      next = crew.filter((_, j) => j !== i.index);
      break;
    case 'editField':
      next = at(i.index, (c) => editCrewField(c, i.key, i.value));
      break;
    case 'apply':
      next = at(i.index, (c) => applyPerson(c, personOf(i.person)));
      break;
    case 'reset':
      next = at(i.index, (c) => resetCrew(c, personOf(i.person)));
      break;
    case 'sync':
      next = syncCrew(
        crew,
        i.before ? new Map(Object.entries(i.before).map(([k, p]) => [k, personOf(p)])) : null,
        new Map(Object.entries(i.now ?? {}).map(([k, p]) => [k, personOf(p)])),
      );
      break;
    default:
      throw new Error(`unknown manifest op ${String((i as { op?: unknown }).op)}`);
  }
  return plain({
    crew: next,
    ok,
    moved,
    seats,
    full: next.length >= seats.length,
    picSeat: picSeat(seatIds),
    errors: validateCrew(next, stations ? seatIds : null),
  });
}

/**
 * The W&B chart (moment vs mass) as the MD 4.3 sheet draws it: the aircraft's envelopes (normal, and
 * utility when it has one; a CG envelope as its moment outline) and axis ranges with ticks that hold
 * them and the points. `points` are WbPoints ({ massKg, momentKgM }), e.g. computeFlight's
 * wb.takeoff, wb.landing and wb.zeroFuel.
 */
export function wbChart(
  input: Json<{
    massBalance: Pick<MassBalance, 'envelopes'>;
    points?: Pick<WbPoint, 'massKg' | 'momentKgM'>[] | null;
  }>,
) {
  const i = arg(input);
  const envelopes = chartEnvelopes(i.massBalance);
  return plain({ envelopes, domain: chartDomain(envelopes, i.points ?? []) });
}

/** A CG envelope [arm m, mass kg] in moment space: as the hangar stores it (`moment`, rounded) and as the chart draws it (`outline`). */
export function cgToMoment(input: Json<{ polygon: EnvelopePoint[] }>) {
  const p = arg(input).polygon ?? [];
  return plain({ moment: momentPolygonFromCg(p), outline: cgToMomentOutline(p) });
}

/**
 * Whom the share dialog offers the flight to: the manifest's passengers with an e-mail on their
 * passenger record (`contacts`), and those of them the flight is not shared with yet (`suggestions`;
 * `people` is GET /api/flights/:id/shares' people).
 */
export function shareSuggestions(
  input: Json<{ crew: FlightCrew[]; passengers: Passenger[]; people?: Pick<SharePerson, 'email'>[] | null }>,
) {
  const i = arg(input);
  const contacts = manifestContacts(i.crew ?? [], i.passengers ?? []);
  return plain({ contacts, suggestions: passengerShareSuggestions(contacts, i.people ?? []) });
}
