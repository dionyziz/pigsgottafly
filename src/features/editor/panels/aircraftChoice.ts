// Choosing the flight's aircraft (AircraftSection; the native core's setAircraft): the manifest,
// the baggage, the compass card and the W&B category follow the new aircraft.
import { type Aircraft, type FlightCrew, type FlightDoc, seatLayout } from '../../../shared';

/**
 * The manifest moved onto another aircraft: people keep their seat when it exists there, the rest
 * take the first free seats (PIC first). People beyond the seat count keep their old seat id and
 * are flagged by validateCrew.
 */
function reseatCrew(crew: FlightCrew[], aircraft: Aircraft | null): FlightCrew[] {
  if (!aircraft) return crew;
  const seats = seatLayout(aircraft.massBalance.stations).map((s) => s.id);
  if (!seats.length) return crew;
  const taken = new Set<string>();
  const keep = crew.map((c) => (seats.includes(c.seat) && !taken.has(c.seat) ? (taken.add(c.seat), true) : false));
  const order = crew
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.role === 'PIC' ? -1 : 0) - (b.c.role === 'PIC' ? -1 : 0));
  const out = [...crew];
  for (const { c, i } of order) {
    if (keep[i]) continue;
    const free = seats.find((s) => !taken.has(s));
    if (!free) continue;
    taken.add(free);
    out[i] = { ...c, seat: free };
  }
  return out;
}

export function setAircraft(d: FlightDoc, aircraft: Aircraft | null): FlightDoc {
  const crew = reseatCrew(d.crew, aircraft);
  const bagIds = new Set((aircraft?.massBalance.stations ?? []).filter((s) => s.kind === 'baggage').map((s) => s.id));
  const baggageKg = aircraft
    ? Object.fromEntries(Object.entries(d.baggageKg).filter(([k]) => bagIds.has(k)))
    : d.baggageKg;
  const compassCard =
    aircraft && d.options.compassCard && aircraft.compassCards.some((c) => c.name === d.options.compassCard)
      ? d.options.compassCard
      : null;
  const category = aircraft?.massBalance.envelopes.utility ? d.options.category : 'normal';
  return { ...d, aircraftId: aircraft?.id ?? null, crew, baggageKg, options: { ...d.options, compassCard, category } };
}
