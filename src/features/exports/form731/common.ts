// Helpers shared by the filled forms (Form 731 and the General Declaration). Pure: no DOM, no I/O.
import { aerodrome } from '../../../data/ref';
import type { Aircraft, FlightDoc, Passenger, Pilot, RoutePoint } from '../../../shared';
import { formPeopleOf, type FormPerson, type Place, placeOfWith, routePlacesWith } from '../../../shared/forms';

/** What every filled-form component needs. The export page loads these and passes them in. */
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
// here they are bound to the client's reference data.
export { dateParts, formatDate, type FormPerson, idText, type Place, placeLong } from '../../../shared/forms';

const lookup = (k: string | null | undefined) => aerodrome(k);

export function placeOf(p: RoutePoint): Place {
  return placeOfWith(p, lookup);
}

/** Origin, aerodromes on the way, destination (see routePlacesWith). */
export function routePlaces(route: RoutePoint[]): Place[] {
  return routePlacesWith(route, lookup);
}

/** "LGTT – LGMG – LGTT" */
export function routeText(route: RoutePoint[]): string {
  return routePlaces(route)
    .map((p) => p.code)
    .join(' – ');
}

/** Form 731 route: origin – destination only ("LGTT – LGMG"). */
export function routeEnds(route: RoutePoint[]): string {
  const p = routePlaces(route);
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
