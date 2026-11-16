// What every export reads besides the flight: the flight's aircraft and the pilot's passengers,
// from the shared entity cache (src/data/entities.ts), so an edit in the hangar, the passenger list
// or another tab shows up here without a reload.
import { useEntity } from '../../data/entities';
import type { Aircraft, Passenger } from '../../shared';

/** The flight's aircraft (own or shared); null when none is chosen or it is no longer accessible. */
export function useFlightAircraft(aircraftId: string | null): { aircraft: Aircraft | null; loading: boolean } {
  const list = useEntity('aircraft');
  if (!aircraftId) return { aircraft: null, loading: false };
  return { aircraft: list.data?.find((a) => a.id === aircraftId) ?? null, loading: list.loading };
}

/** The pilot's saved passengers (empty while they cannot be loaded). */
export function usePassengers(): { passengers: Passenger[]; loading: boolean } {
  const q = useEntity('passengers');
  return { passengers: q.data ?? [], loading: q.loading };
}
