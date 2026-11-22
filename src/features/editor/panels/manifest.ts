// A manifest row's snapshot follows its person (passenger list / profile) field by field until that
// field is edited on the flight (FlightCrew.overrides); "Reset from the saved details" copies the
// person again and clears the overrides.
import {
  FALLBACK_SEATS,
  type FlightCrew,
  type Passenger,
  PERSON_KEYS,
  type PersonDetails,
  type PersonKey,
  seatLayout,
  type Station,
} from '../../../shared';

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

/** A passenger's or the pilot's details as a manifest snapshot holds them. */
export function personOf(p: PersonDetails): PersonDetails {
  return {
    fullName: p.fullName,
    phone: p.phone,
    dateOfBirth: p.dateOfBirth,
    weightKg: p.weightKg,
    idNumber: p.idNumber,
    idType: p.idType,
    nationality: p.nationality,
    relation: p.relation,
  };
}

const FALLBACK_LABELS: Record<string, string> = {
  'front-left': 'Front left',
  'front-right': 'Front right',
  'rear-left': 'Rear left',
  'rear-right': 'Rear right',
};

/** The seats offered on the manifest: the aircraft's (seatLayout), else those of a four-seater. */
export function manifestSeats(stations: Station[] | null): { id: string; label: string }[] {
  if (stations) return seatLayout(stations).map((s) => ({ id: s.id, label: s.label }));
  return FALLBACK_SEATS.map((id) => ({ id, label: FALLBACK_LABELS[id] ?? id }));
}

/** The crew with a passenger in the first free seat; unchanged when they are on board or every seat is taken. */
export function addPassengerToCrew(crew: FlightCrew[], seatIds: string[], p: Passenger): FlightCrew[] {
  if (crew.some((c) => c.passengerId === p.id)) return crew;
  const taken = new Set(crew.map((c) => c.seat));
  const seat = seatIds.find((s) => !taken.has(s));
  if (!seat) return crew;
  return [...crew, { role: 'PAX', passengerId: p.id, seat, snapshot: personOf(p) }];
}

/** Row `i` moved to `seat`, swapping with whoever sits there. */
export function changeSeat(crew: FlightCrew[], i: number, seat: string): FlightCrew[] {
  const other = crew.findIndex((c, j) => j !== i && c.seat === seat);
  const mine = crew[i].seat;
  return crew.map((c, j) => (j === i ? { ...c, seat } : j === other ? { ...c, seat: mine } : c));
}

/**
 * The crew after the people it links to changed: each snapshot follows its person from `before` to
 * `now` (keyed 'PIC' and by passenger id), except the fields edited on the flight; a passenger no
 * longer in `now` is unlinked (the snapshot stays). Unchanged rows are the same objects.
 */
export function syncCrew(
  crew: FlightCrew[],
  before: ReadonlyMap<string, PersonDetails> | null,
  now: ReadonlyMap<string, PersonDetails>,
): FlightCrew[] {
  return crew.map((c) => {
    const k = c.role === 'PIC' ? 'PIC' : c.passengerId;
    if (!k) return c;
    const after = now.get(k);
    if (!after) return c.role === 'PAX' ? { ...c, passengerId: null } : c;
    const was = before?.get(k);
    if (!was) return c;
    const snapshot = followPerson(c.snapshot, was, after, c.overrides);
    return snapshot === c.snapshot ? c : { ...c, snapshot };
  });
}
