// General Declaration (ICAO Annex 9 Appendix 1, club form MD 4.7): what goes in each field.
import type { FormFix } from '../form731/FormWarnings';
import { dateParts, formPeople, placeLong, routePlaces, type FormExportProps } from '../form731/common';

/** Rows of the flight routing table on the form. */
export const ROUTING_ROWS = 9;

export interface GenDecModel {
  operator: string;
  registration: string;
  /** Left blank: a private flight has no flight number (the registration is the call sign). */
  flightNo: string;
  /** [DD, MM, YYYY] */
  date: [string, string, string];
  departure: string;
  arrival: string;
  /** Routing table rows: place code (origin, en-route stops, destination) and crew name. */
  routing: { place: string; crew: string }[];
  departureCode: string;
  arrivalCode: string;
  /** Passengers on this stage (PAX only; the crew is not counted). */
  embarking: number;
  throughDeparture: number;
  disembarking: number;
  throughArrival: number;
  picName: string;
  warnings: string[];
  /** How to fix each warning (keyed by its text). */
  fixes: Record<string, FormFix>;
}

export function genDecModel(props: FormExportProps): GenDecModel {
  const { flight, aircraft, pilot } = props;
  const places = routePlaces(flight.route);
  const people = formPeople(props);
  const crew = people.filter((p) => p.role === 'PIC').map((p) => (p.details.fullName.trim() ? `${p.details.fullName.trim()} (PIC)` : ''));
  const pax = people.filter((p) => p.role === 'PAX').length;
  const picName = people.find((p) => p.role === 'PIC')?.details.fullName.trim() ?? '';

  const warnings: string[] = [];
  const fixes: Record<string, FormFix> = {};
  const warn = (text: string, fix: FormFix | null) => { warnings.push(text); if (fix) fixes[text] = fix; };
  if (!aircraft) warn('No aircraft is selected: operator and registration are blank.', { kind: 'flight' });
  else if (!aircraft.operator.trim()) warn(`${aircraft.registration} has no operator in the hangar: the PIC is printed as operator.`, { kind: 'aircraft', id: aircraft.id });
  if (!flight.date) warn('The flight has no date.', { kind: 'flight' });
  if (places.length < 2) warn('The route needs a departure and a destination.', { kind: 'flight' });
  if (places.length > ROUTING_ROWS) warn(`The route has ${places.length} places; the form has room for ${ROUTING_ROWS}.`, null);
  if (!picName) warn('Your full name is not set.', { kind: 'person', key: 'PIC', fields: ['fullName'] });

  const n = ROUTING_ROWS;
  const routing = Array.from({ length: n }, (_, i) => ({ place: places[i]?.code ?? '', crew: crew[i] ?? '' }));
  if (places.length > n) routing[n - 1].place = places[places.length - 1].code;

  const first = places[0];
  const last = places.length > 1 ? places[places.length - 1] : undefined;
  return {
    operator: aircraft ? aircraft.operator.trim() || picName : '',
    registration: aircraft?.registration ?? '',
    flightNo: '',
    date: dateParts(flight.date),
    departure: first ? placeLong(first) : '',
    arrival: last ? placeLong(last) : '',
    routing,
    departureCode: first?.code ?? '',
    arrivalCode: last?.code ?? '',
    embarking: pax,
    throughDeparture: 0,
    disembarking: pax,
    throughArrival: 0,
    picName: picName || pilot.fullName.trim(),
    warnings,
    fixes,
  };
}
