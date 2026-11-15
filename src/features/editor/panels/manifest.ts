// Pure manifest helpers (unit-tested in tests/unit/screens/screens.test.ts).
import type { FlightCrew, PersonDetails } from '../../../shared';

/** The PIC's seat: front left when the aircraft has it, otherwise its first seat. */
export function picSeat(seatIds: string[]): string {
  return seatIds.includes('front-left') ? 'front-left' : seatIds[0] ?? 'front-left';
}

/**
 * Puts the PIC back on the manifest in the PIC seat (front left). Whoever sits there moves to the
 * first free seat. Returns null when every seat is taken (nobody can make room), and the crew
 * unchanged when it already has a PIC.
 */
export function addPicToCrew(crew: FlightCrew[], seatIds: string[], snapshot: PersonDetails): { crew: FlightCrew[]; moved: FlightCrew | null } | null {
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
