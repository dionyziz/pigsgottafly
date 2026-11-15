// Form 731 (HCAA "Official statement of persons boarding private aircraft"): what goes in each field.
import type { FormFix, PersonField } from './FormWarnings';
import { chunk, formatDate, formPeople, idText, placeLong, routePlaces, routeEnds, type FormExportProps } from './common';

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
  /** How to fix each warning (keyed by its text). */
  fixes: Record<string, FormFix>;
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
  const fixes: Record<string, FormFix> = {};
  const warn = (text: string, fix: FormFix | null) => { warnings.push(text); if (fix) fixes[text] = fix; };
  if (!places.length) warn('The route is empty: no airport or route on the form.', { kind: 'flight' });
  else if (!places[0].aerodrome) warn(`The departure point ${places[0].code} is not an aerodrome.`, { kind: 'flight' });
  if (!flight.date) warn('The flight has no date.', { kind: 'flight', focus: 'date' });
  if (!aircraft) warn('No aircraft is selected: the registration is blank.', { kind: 'flight', focus: 'aircraft' });
  for (const r of rows) {
    const who = r.role === 'PIC' ? 'PIC' : r.name || `Passenger ${r.no}`;
    const missing: [boolean, string, PersonField][] = [[!r.name, 'name', 'fullName'], [!r.idPassport, 'ID/passport number', 'idNumber'], [!r.contact, 'phone', 'phone']];
    const miss = missing.filter((m) => m[0]).map((m) => m[1]);
    const fields = missing.filter((m) => m[0]).map((m) => m[2]);
    // People saved in the passenger list (key = passenger id) or the PIC can be edited; a seat-only entry is fixed on the flight.
    if (miss.length) warn(`${who}: no ${miss.join(', ')}.`, r.key.startsWith('seat:') ? { kind: 'flight', focus: 'manifest' } : { kind: 'person', key: r.key, fields });
  }

  return {
    airport: places[0] ? placeLong(places[0]) : '',
    date: formatDate(flight.date),
    registration: aircraft?.registration ?? '',
    route: routeEnds(flight.route),
    sheets: chunk(rows, ROWS_PER_SHEET),
    picName: rows.find((r) => r.role === 'PIC')?.name ?? '',
    warnings,
    fixes,
  };
}
