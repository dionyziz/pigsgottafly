// Form 731 (HCAA "Official statement of persons boarding private aircraft"): what goes in each field.
import { chunk, formatDate, formPeople, idText, placeLong, routePlaces, routeText, type FormExportProps } from './common';

/** Rows printed on one Form 731 sheet. */
export const ROWS_PER_SHEET = 6;

export interface Form731Row {
  /** 1-based row number, continuing across sheets. */
  no: number;
  /** The person's signing key (FormPerson.key). */
  key: string;
  role: 'PIC' | 'PAX';
  name: string;
  relation: string;
  idPassport: string;
  contact: string;
}

export interface Form731Model {
  /** "DEKELIA / TATOI (LGTT)": the departure aerodrome, where the form is submitted. */
  airport: string;
  /** DD/MM/YYYY */
  date: string;
  registration: string;
  /** "LGTT – LGMG – LGTT" */
  route: string;
  /** One entry per sheet (six rows each; at least one sheet). */
  sheets: Form731Row[][];
  /** PIC full name, printed above "(Fullname-signature)". */
  picName: string;
  /** Missing data, shown on screen only. */
  warnings: string[];
}

export function form731Model(props: FormExportProps): Form731Model {
  const { flight, aircraft } = props;
  const places = routePlaces(flight.route);
  const people = formPeople(props);
  const rows: Form731Row[] = people.map((p, i) => ({
    no: i + 1,
    key: p.key,
    role: p.role,
    name: p.details.fullName.trim(),
    // Form 731 relation: the person's role on board (PIC / PAX), not a stored field.
    relation: p.role,
    idPassport: idText(p.details),
    contact: p.details.phone.trim(),
  }));

  const warnings: string[] = [];
  if (!places.length) warnings.push('The route is empty: no airport or route on the form.');
  else if (!places[0].aerodrome) warnings.push(`The departure point ${places[0].code} is not an aerodrome.`);
  if (!flight.date) warnings.push('The flight has no date.');
  if (!aircraft) warnings.push('No aircraft is selected: the registration is blank.');
  for (const r of rows) {
    const who = r.role === 'PIC' ? 'PIC' : r.name || `Passenger ${r.no}`;
    const miss = [!r.name && 'name', !r.idPassport && 'ID/passport number', !r.contact && 'phone'].filter(Boolean);
    if (miss.length) warnings.push(`${who}: no ${miss.join(', ')}.`);
  }

  return {
    airport: places[0] ? placeLong(places[0]) : '',
    date: formatDate(flight.date),
    registration: aircraft?.registration ?? '',
    route: routeText(flight.route),
    sheets: chunk(rows, ROWS_PER_SHEET),
    picName: rows.find((r) => r.role === 'PIC')?.name ?? '',
    warnings,
  };
}
