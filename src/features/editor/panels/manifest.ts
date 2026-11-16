// Pure manifest helpers (unit-tested in tests/unit/screens/screens.test.ts and editorPanels.test.ts).
// Following: a manifest row's snapshot follows its person (passenger list / profile) field by field
// until that field is edited on the flight (FlightCrew.overrides); "Reset from the saved details"
// copies the person again and clears the overrides.
import { PERSON_KEYS, type FlightCrew, type PersonDetails, type PersonKey } from '../../../shared';

/**
 * The snapshot after the person's record changed from `before` to `after`: the fields that changed
 * there are copied, except those edited on this flight (`overrides`). Unchanged: the same object.
 */
export function followPerson(
  snapshot: PersonDetails,
  before: PersonDetails,
  after: PersonDetails,
  overrides: readonly PersonKey[] = [],
): PersonDetails {
  let out = snapshot;
  for (const k of PERSON_KEYS) {
    if (overrides.includes(k)) continue;
    if (before[k] !== after[k] && out[k] !== after[k]) out = { ...out, [k]: after[k] };
  }
  return out;
}

/** The row with the person's saved details (e.g. after editing them in a dialog), keeping the fields edited on this flight. */
export function applyPerson(c: FlightCrew, person: PersonDetails): FlightCrew {
  const keep = c.overrides ?? [];
  let snapshot = c.snapshot;
  for (const k of PERSON_KEYS) {
    if (!keep.includes(k) && snapshot[k] !== person[k]) snapshot = { ...snapshot, [k]: person[k] };
  }
  return snapshot === c.snapshot ? c : { ...c, snapshot };
}

/** A field edited on this flight: set, and marked so that it stops following the person. */
export function editCrewField<K extends PersonKey>(c: FlightCrew, k: K, v: PersonDetails[K]): FlightCrew {
  const overrides = c.overrides?.includes(k) ? c.overrides : [...(c.overrides ?? []), k];
  return { ...c, snapshot: { ...c.snapshot, [k]: v }, overrides };
}

/** Reset from the passenger list / profile: the person's details, no overrides. */
export function resetCrew(c: FlightCrew, person: PersonDetails): FlightCrew {
  const { overrides: _o, ...rest } = c;
  return { ...rest, snapshot: person };
}

/** The PIC's seat: front left when the aircraft has it, otherwise its first seat. */
export function picSeat(seatIds: string[]): string {
  return seatIds.includes('front-left') ? 'front-left' : (seatIds[0] ?? 'front-left');
}

/**
 * Puts the PIC back on the manifest in the PIC seat (front left). Whoever sits there moves to the
 * first free seat. Returns null when every seat is taken (nobody can make room), and the crew
 * unchanged when it already has a PIC.
 */
export function addPicToCrew(
  crew: FlightCrew[],
  seatIds: string[],
  snapshot: PersonDetails,
): { crew: FlightCrew[]; moved: FlightCrew | null } | null {
  if (crew.some((c) => c.role === 'PIC')) return { crew, moved: null };
  const seat = picSeat(seatIds);
  const taken = new Set(crew.map((c) => c.seat));
  const pic: FlightCrew = { role: 'PIC', passengerId: null, seat, snapshot };
  const occupant = crew.findIndex((c) => c.seat === seat);
  if (occupant < 0) return { crew: [pic, ...crew], moved: null };
  const free = seatIds.find((s) => s !== seat && !taken.has(s));
  if (!free) return null;
  const moved = { ...crew[occupant], seat: free };
  return { crew: [pic, ...crew.map((c, i) => (i === occupant ? moved : c))], moved };
}
