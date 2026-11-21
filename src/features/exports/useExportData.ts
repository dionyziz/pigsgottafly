// What every export reads besides the flight: the flight's aircraft and the pilot's passengers,
// from the shared entity cache (src/data/entities.ts), so an edit in the hangar, the passenger list
// or another tab shows up here without a reload.
import { useMemo } from 'react';

import { usePilot } from '../../app/session';
import { useEntity } from '../../data/entities';
import type { Aircraft, Flight, Passenger, Pilot } from '../../shared';
import { flightPilot } from '../../shared/sharing';

/**
 * The flight's aircraft (own or shared; on a flight shared with the pilot, the one its owner chose);
 * null when none is chosen or it is no longer accessible.
 */
export function useFlightAircraft(flight: Pick<Flight, 'aircraftId' | 'access'>): {
  aircraft: Aircraft | null;
  loading: boolean;
} {
  const list = useEntity('aircraft');
  const { aircraftId } = flight;
  if (!aircraftId) return { aircraft: null, loading: false };
  const shared = flight.access?.aircraft;
  const own = list.data?.find((a) => a.id === aircraftId);
  if (own || shared?.id === aircraftId) return { aircraft: own ?? shared ?? null, loading: false };
  return { aircraft: null, loading: list.loading };
}

/** The pilot's saved passengers (empty while they cannot be loaded). */
export function usePassengers(): { passengers: Passenger[]; loading: boolean } {
  const q = useEntity('passengers');
  return { passengers: q.data ?? [], loading: q.loading };
}

/** The pilot the flight is computed for: the session pilot, or on a shared flight its owner's details and settings. */
export function useFlightPilot(flight: Pick<Flight, 'access'>): Pilot {
  const pilot = usePilot();
  const { access } = flight;
  return useMemo(() => flightPilot(pilot, { access }), [pilot, access]);
}
