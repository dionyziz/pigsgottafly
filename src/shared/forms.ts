// What the filled forms say (Form 731 and the General Declaration), as plain data shared by the
// client (print sheets, signature panel) and the API (signing page, server-side PDF, e-mail to
// HCAA, the "form changed since signing" check). Pure: the aerodrome lookup is passed in.
import type { Aircraft, FlightCrew, IsoDate, Passenger, PersonDetails, Pilot, RoutePoint, Station } from './types.js';
import { seatLayout } from './constants.js';
import type { GenDecHandling } from '../calc/aerodromeStatus.js';

/** Minimal aerodrome record for the forms. */
export interface FormAerodrome { id: string; icao: string | null; name: string }
export type AerodromeLookup = (idOrIcao: string | null | undefined) => FormAerodrome | undefined;

/** 'YYYY-MM-DD' → ['DD', 'MM', 'YYYY'], or blanks. */
export function dateParts(d: IsoDate | '' | null | undefined): [string, string, string] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? [m[3], m[2], m[1]] : ['', '', ''];
}

/** 'YYYY-MM-DD' ('' when unset). */
export function formatDate(d: IsoDate | '' | null | undefined): string {
  const [dd, mm, yyyy] = dateParts(d);
  return dd ? `${yyyy}-${mm}-${dd}` : '';
}

/** A place on the forms: short code (ICAO where there is one) and full name. */
export interface Place {
  code: string;
  name: string;
  icao: string | null;
  /** The route point is an aerodrome. */
  aerodrome: boolean;
}

export function aerodromeCode(a: FormAerodrome): string {
  return a.icao || a.name.split('/').pop()!.trim();
}

export function placeOfWith(p: RoutePoint, lookup: AerodromeLookup): Place {
  const a = p.kind === 'aerodrome' ? lookup(p.refId) ?? lookup(p.name) : undefined;
  if (a) return { code: aerodromeCode(a), name: a.name, icao: a.icao, aerodrome: true };
  return { code: p.name, name: p.name, icao: null, aerodrome: false };
}

/** "DEKELIA / TATOI (LGTT)"; a non-ICAO place is just its name. */
export function placeLong(pl: Place): string {
  return pl.icao ? `${pl.name} (${pl.icao})` : pl.name;
}

/**
 * The places a form lists for a route: origin, every aerodrome on the way (taken as an en-route
 * stop) and destination. VFR reporting points and custom points in between are not places.
 * Consecutive repeats are dropped (a local flight LGTT → … → LGTT stays [LGTT, LGTT]).
 */
export function routePlacesWith(route: RoutePoint[], lookup: AerodromeLookup): Place[] {
  if (!route.length) return [];
  const out: Place[] = [];
  route.forEach((p, i) => {
    const first = i === 0;
    const last = i === route.length - 1;
    if (!first && !last && p.kind !== 'aerodrome') return;
    const pl = placeOfWith(p, lookup);
    if (!last && out.length && out[out.length - 1].code === pl.code) return;
    if (last && out.length > 1 && out[out.length - 1].code === pl.code) return;
    out.push(pl);
  });
  return out;
}

/** One person of the manifest, with details resolved for the forms. */
export interface FormPerson {
  /** Stable key of the person on this flight: 'PIC', the passenger id, or 'seat:<id>'. */
  key: string;
  role: 'PIC' | 'PAX';
  seat: string;
  seatLabel: string;
  details: PersonDetails;
}

/** The signing key of a manifest entry (a signature belongs to this person on this flight). */
export function crewKey(c: Pick<FlightCrew, 'role' | 'passengerId' | 'seat'>): string {
  return c.role === 'PIC' ? 'PIC' : c.passengerId ?? `seat:${c.seat}`;
}

const pick = (a: string, b: string | undefined) => (a && a.trim() ? a : b || '');

/**
 * Snapshot details first (they keep a sent form reproducible), each empty field filled from the
 * live record: the pilot for the PIC, the passenger list for a PAX.
 */
function resolveDetails(c: FlightCrew, pilot: Pilot, passengers: Passenger[] | undefined): PersonDetails {
  const live: Partial<PersonDetails> | undefined = c.role === 'PIC' ? pilot : passengers?.find((p) => p.id === c.passengerId);
  const s = c.snapshot;
  if (!live) return { ...s };
  return {
    fullName: pick(s.fullName, live.fullName),
    phone: pick(s.phone, live.phone),
    dateOfBirth: s.dateOfBirth ?? live.dateOfBirth ?? null,
    weightKg: s.weightKg ?? live.weightKg ?? null,
    idNumber: pick(s.idNumber, live.idNumber),
    idType: s.idType || live.idType || '',
    nationality: pick(s.nationality, live.nationality),
    relation: pick(s.relation, live.relation),
  };
}

export function pilotDetails(p: Pilot): PersonDetails {
  return {
    fullName: p.fullName, phone: p.phone, dateOfBirth: p.dateOfBirth, weightKg: p.weightKg,
    idNumber: p.idNumber, idType: p.idType, nationality: p.nationality, relation: p.relation,
  };
}

/**
 * The manifest for the forms: the PIC first, then the PAX in seat order (the aircraft's seat
 * layout; manifest order when there is no aircraft). A flight without a PIC row still lists the
 * pilot as PIC, since the pilot is always on board.
 */
export function formPeopleOf(crewIn: FlightCrew[], stations: Station[] | null, pilot: Pilot, passengers?: Passenger[]): FormPerson[] {
  const layout = stations ? seatLayout(stations) : [];
  const seatIndex = (id: string) => {
    const i = layout.findIndex((s) => s.id === id);
    return i < 0 ? layout.length : i;
  };
  const seatLabel = (id: string) => layout.find((s) => s.id === id)?.label ?? id;
  const crew = [...crewIn];
  if (!crew.some((c) => c.role === 'PIC')) {
    crew.unshift({ role: 'PIC', passengerId: null, seat: layout[0]?.id ?? 'front-left', snapshot: { ...pilotDetails(pilot) } });
  }
  return crew
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.role === b.c.role ? seatIndex(a.c.seat) - seatIndex(b.c.seat) || a.i - b.i : a.c.role === 'PIC' ? -1 : 1))
    .map(({ c }) => ({ key: crewKey(c), role: c.role, seat: c.seat, seatLabel: seatLabel(c.seat), details: resolveDetails(c, pilot, passengers) }));
}

/** The ID card or passport number as written on the forms (no document type). */
export function idText(d: Pick<PersonDetails, 'idNumber'>): string {
  return d.idNumber.trim();
}

// ---------------------------------------------------------------------------------------------
// Form 731

export interface Form731Person {
  key: string;
  role: 'PIC' | 'PAX';
  name: string;
  relation: string;
  idPassport: string;
  contact: string;
}

/** Everything printed on Form 731 (the signatures aside). */
export interface Form731Content {
  /** "DEKELIA / TATOI (LGTT)": the departure aerodrome, where the form is submitted. */
  airport: string;
  /** DD/MM/YYYY */
  date: string;
  registration: string;
  /** "LGTT – LGMG – LGTT" */
  route: string;
  people: Form731Person[];
}

export interface FormFlightInput {
  date: IsoDate | '';
  route: RoutePoint[];
  crew: FlightCrew[];
}

export function form731Content(flight: FormFlightInput, aircraft: Pick<Aircraft, 'registration' | 'massBalance'> | null, pilot: Pilot, passengers: Passenger[] | undefined, lookup: AerodromeLookup): Form731Content {
  const places = routePlacesWith(flight.route, lookup);
  const people = formPeopleOf(flight.crew, aircraft ? aircraft.massBalance.stations : null, pilot, passengers);
  return {
    airport: places[0] ? placeLong(places[0]) : '',
    date: formatDate(flight.date),
    registration: aircraft?.registration ?? '',
    route: places.length ? [places[0], places[places.length - 1]].map((p) => p.code).join(' – ') : '',
    people: people.map((p) => ({
      key: p.key,
      role: p.role,
      name: p.details.fullName.trim(),
      relation: p.role,
      idPassport: idText(p.details),
      contact: p.details.phone.trim(),
    })),
  };
}

/**
 * The text a signature is given for: every field of the form, in a fixed order. Any change
 * (date, registration, route, a person, their details) changes it and so clears the signatures.
 */
export function form731SigningText(c: Form731Content): string {
  return JSON.stringify([c.airport, c.date, c.registration, c.route, c.people.map((p) => [p.key, p.role, p.name, p.relation, p.idPassport, p.contact])]);
}

/** "D. Zindros": the signer's first initial and last name. */
export function signatureName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0].charAt(0).toUpperCase()}. ${parts[parts.length - 1]}`;
}

/** Masks all but the last 2 characters of an ID or phone number: '•••••56'. */
export function maskTail(s: string, keep = 2): string {
  const t = s.trim();
  if (!t) return '';
  if (t.length <= keep) return '•'.repeat(t.length);
  return '•'.repeat(Math.min(8, t.length - keep)) + t.slice(-keep);
}

// ---------------------------------------------------------------------------------------------
// General Declaration

/** Ruled rows of the flight routing table (origin, the arrow, destination, then blank rows). */
export const GENDEC_ROUTING_ROWS = 9;

export interface GenDecContent {
  operator: string;
  /** Marks of nationality and registration as one word ("SXASG"). */
  registration: string;
  /** "PVT": a private flight has no flight number. */
  flightNo: string;
  /** 'YYYY-MM-DD' ('' when unset). */
  date: string;
  /** Departure and destination codes (ICAO where there is one): "LGTT". */
  departure: string;
  arrival: string;
  /**
   * The routing table: the origin with the crew (the PIC, in capitals), then the destination.
   * Only the two ends are listed: intermediate points and stops are not.
   */
  routing: { place: string; crew: string }[];
  departureCode: string;
  arrivalCode: string;
  /** ICAO codes of the departure and destination (null when not an ICAO aerodrome). */
  departureIcao: string | null;
  arrivalIcao: string | null;
  embarking: number;
  throughDeparture: number;
  disembarking: number;
  throughArrival: number;
  picName: string;
  placeCount: number;
}

export function genDecContent(flight: FormFlightInput, aircraft: Pick<Aircraft, 'registration' | 'massBalance' | 'operator'> | null, pilot: Pilot, passengers: Passenger[] | undefined, lookup: AerodromeLookup): GenDecContent {
  const places = routePlacesWith(flight.route, lookup);
  const people = formPeopleOf(flight.crew, aircraft ? aircraft.massBalance.stations : null, pilot, passengers);
  const pax = people.filter((p) => p.role === 'PAX').length;
  const picName = people.find((p) => p.role === 'PIC')?.details.fullName.trim() ?? '';
  const first = places[0];
  const last = places.length > 1 ? places[places.length - 1] : undefined;
  const crew = (picName || pilot.fullName.trim()).toUpperCase();
  const routing = first ? [{ place: first.code, crew }, ...(last ? [{ place: last.code, crew: '' }] : [])] : [];
  return {
    operator: aircraft ? aircraft.operator.trim() || picName : '',
    registration: (aircraft?.registration ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    flightNo: 'PVT',
    date: formatDate(flight.date),
    departure: first?.code ?? '',
    arrival: last?.code ?? '',
    routing,
    departureCode: first?.code ?? '',
    arrivalCode: last?.code ?? '',
    departureIcao: first?.icao ?? null,
    arrivalIcao: last?.icao ?? null,
    embarking: pax,
    throughDeparture: 0,
    disembarking: pax,
    throughArrival: 0,
    picName: picName || pilot.fullName.trim(),
    placeCount: places.length,
  };
}

/**
 * The Declaration of Health of the General Declaration (ICAO Annex 9 Appendix 1, MD 4.7), line by
 * line as on the form. Shared by the print sheet and the PDF e-mailed to HCAA so both carry the
 * official text. The last line of each block continues on the first dotted line ('stop',
 * 'details of most recent disinsecting').
 */
export const GENDEC_HEALTH_LINES = [
  'Name and seat number or function of persons on board with illnesses other than',
  'airsickness or the effects of accidents, who may be suffering from a communicable',
  'disease (a fever \u2014 temperature 38\u00b0C/100\u00b0F or greater \u2014 associated with one or',
  'more of the following signs or symptoms, e.g. appearing obviously unwell;',
  'persistent coughing; impaired breathing; persistent diarrhoea; persistent vomiting;',
  'skin rash; bruising or bleeding without previous injury; or confusion of recent',
  'onset, increases the likelihood that the person is suffering a communicable disease)',
  'as well as such cases of illness disembarked during a previous',
] as const;
export const GENDEC_HEALTH_CONT = 'stop';
export const GENDEC_DISINSECT_LINES = [
  'Details of each disinsecting or sanitary treatment (place, date, time, method)',
  'during the flight. If no disinsecting has been carried out during the flight, give',
] as const;
export const GENDEC_DISINSECT_CONT = 'details of most recent disinsecting';

/**
 * The form_signatures key of the PIC's signature on the General Declaration (kept apart from the
 * Form 731 keys: 'PIC', passenger ids, 'seat:<id>').
 */
export const GENDEC_PIC_KEY = 'gendec:PIC';

/** The text the GenDec was sent with (re-send is offered when it changes). */
export function genDecText(c: GenDecContent): string {
  return JSON.stringify(c);
}

// ---------------------------------------------------------------------------------------------
// API bodies (api/_lib/routes/forms.ts)
//   GET  /flights/:id/forms                         → FormsState
//   POST /flights/:id/forms/731/links               → FormsState (+ links: one new link per PAX without one)
//   POST /flights/:id/forms/731/links/:key/renew    → FormsState (+ links: that person's new link; the old one stops working)
//   POST /flights/:id/forms/731/links/:key/revoke   → FormsState
//   POST /flights/:id/forms/731/send                → FormsState (e-mail to HCAA; 409 until everyone has signed)
//   POST /flights/:id/forms/gendec/send             → FormsState
//   POST /flights/:id/forms/gendec/handled         → FormsState; body {handled: true | false | null}: the flight's
//                                                     override of who sends the GenDec (null = automatic)
//   Both sends: body {} or {resend: true}. 409 when this version was already sent (unless resend) or a send
//   of the same form is in progress; 403 for a pilot without an e-mail address (emailEnabled false, emailReason says so).
//   GET  /sign/:token                               → SigningView (no sign-in)
//   POST /sign/:token                               → SigningView (signs)

export interface SignatureState {
  key: string;
  role: 'PIC' | 'PAX';
  name: string;
  /** The current form is signed by this person (a signature on an older version is not). */
  signed: boolean;
  /** When the current signature was given (epoch ms). */
  signedAt: number | null;
  /** Signed an earlier version of the form: has to sign again. */
  needsResign: boolean;
  /** Link state (PAX only). */
  link: { created: number; firstOpened: number | null; lastOpened: number | null; revoked: boolean; expires: number } | null;
}

export interface SubmissionState {
  sentAt: number;
  messageId: string;
  to: string;
  /** The form changed since it was sent: offer a re-send. */
  changed: boolean;
}

export interface FormsState {
  form731: {
    content: Form731Content;
    signatures: SignatureState[];
    allSigned: boolean;
    submission: SubmissionState | null;
  };
  gendec: {
    content: GenDecContent;
    submission: SubmissionState | null;
    /** The departure or destination has no handler (AIP + NOTAMs, or the flight's override): the PIC sends it. */
    pilotSends: boolean;
    /** Handling at each end with the reason, and the flight's override (src/calc/aerodromeStatus.ts). */
    handling: GenDecHandling;
    /**
     * The PIC's signature on the current version of the declaration ("Authorized Agent or
     * Pilot-in-Command"), given automatically like on Form 731; null without a PIC name.
     */
    picSignature: { name: string; signedAt: number } | null;
  };
  /** E-mail sending is configured on this server. */
  emailEnabled: boolean;
  emailReason: string | null;
  /** New links made by this request (the token is only ever returned here), by person key. */
  links?: Record<string, string>;
}

export interface SigningView {
  content: Form731Content;
  /** The signer's key; their row is shown in full, other people's ID and contact are masked. */
  me: string;
  signatures: { key: string; name: string; signedAt: number | null }[];
  flightDate: string;
  expired: boolean;
}

export const FORM731_TO = '731@hcaa.gov.gr';
export const GENDEC_TO = 'gendec@hcaa.gov.gr';
