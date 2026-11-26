// Shared by Form 731 and the General Declaration. Pure: no DOM, no I/O.
import { refOfFlight } from '../../../data/ref';
import type { Aircraft, FlightDoc, Passenger, Pilot, RoutePoint } from '../../../shared';
import {
  type AerodromeLookup,
  formPeopleOf,
  type FormPerson,
  type Place,
  routePlacesWith,
} from '../../../shared/forms';

export interface FormExportProps {
  flight: FlightDoc;
  /** The flight's aircraft, or null when none is chosen (or it was deleted from the hangar). */
  aircraft: Aircraft | null;
  /** The signed-in pilot (the PIC). */
  pilot: Pilot;
  /** Optional: the pilot's passenger list, used to fill details missing from old manifest snapshots. */
  passengers?: Passenger[];
}

// The form content rules live in src/shared/forms.ts (shared with the API: signing page, PDF);
// here they are bound to the client's reference data (the …With variants: to other reference data,
// as the native core binds them to GET /api/ref/bundle).
export { formatDate, type FormPerson, idText, type Place, placeLong } from '../../../shared/forms';

/** The aerodromes of the cycle in effect on the flight's date ('' = today). */
export const lookupOn = (date: string) => refOfFlight(date).aerodrome;

/** Origin, aerodromes on the way, destination (see routePlacesWith). */
export function routePlaces(route: RoutePoint[], date: string): Place[] {
  return routePlacesWith(route, lookupOn(date));
}

/** "LGTT – LGMG – LGTT" */
export function routeText(route: RoutePoint[], date: string): string {
  return routeTextWith(route, lookupOn(date));
}

export function routeTextWith(route: RoutePoint[], find: AerodromeLookup): string {
  return routePlacesWith(route, find)
    .map((p) => p.code)
    .join(' – ');
}

/** Form 731 route: origin – destination only ("LGTT – LGMG"). */
export function routeEndsWith(route: RoutePoint[], find: AerodromeLookup): string {
  const p = routePlacesWith(route, find);
  return p.length ? [p[0], p[p.length - 1]].map((x) => x.code).join(' – ') : '';
}

/** The manifest for the forms: the PIC first, then the PAX in seat order (see formPeopleOf). */
export function formPeople({ flight, aircraft, pilot, passengers }: FormExportProps): FormPerson[] {
  return formPeopleOf(flight.crew, aircraft ? aircraft.massBalance.stations : null, pilot, passengers);
}

/** Split a list into pages of `size` (at least one page, possibly empty). */
export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out.length ? out : [[]];
}
