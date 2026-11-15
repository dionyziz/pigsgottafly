// Helpers shared by the filled forms (Form 731 and the General Declaration). Pure: no DOM, no I/O.
import { seatLayout } from '../../../shared';
import type { Aircraft, FlightCrew, FlightDoc, IsoDate, Passenger, PersonDetails, Pilot, RoutePoint } from '../../../shared';
import { aerodrome, aerodromeLabel } from '../../../data/ref';

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

/** 'YYYY-MM-DD' → ['DD', 'MM', 'YYYY'], or blanks. */
export function dateParts(d: IsoDate | '' | null | undefined): [string, string, string] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? [m[3], m[2], m[1]] : ['', '', ''];
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' ('' when unset). */
export function formatDate(d: IsoDate | '' | null | undefined): string {
  const [dd, mm, yyyy] = dateParts(d);
  return dd ? `${dd}/${mm}/${yyyy}` : '';
}

/** A place on the forms: short code (ICAO where there is one) and full name. */
export interface Place {
  code: string;
  name: string;
  icao: string | null;
  /** The route point is an aerodrome. */
  aerodrome: boolean;
}

export function placeOf(p: RoutePoint): Place {
  const a = p.kind === 'aerodrome' ? aerodrome(p.refId) ?? aerodrome(p.name) : undefined;
  if (a) return { code: aerodromeLabel(a), name: a.name, icao: a.icao, aerodrome: true };
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
export function routePlaces(route: RoutePoint[]): Place[] {
  if (!route.length) return [];
  const out: Place[] = [];
  route.forEach((p, i) => {
    const first = i === 0;
    const last = i === route.length - 1;
    if (!first && !last && p.kind !== 'aerodrome') return;
    const pl = placeOf(p);
    if (!last && out.length && out[out.length - 1].code === pl.code) return;
    if (last && out.length > 1 && out[out.length - 1].code === pl.code) return;
    out.push(pl);
  });
  return out;
}

/** "LGTT – LGMG – LGTT" */
export function routeText(route: RoutePoint[]): string {
  return routePlaces(route).map((p) => p.code).join(' – ');
}

/** One person of the manifest, with details resolved for the forms. */
export interface FormPerson {
  role: 'PIC' | 'PAX';
  seat: string;
  seatLabel: string;
  details: PersonDetails;
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

/**
 * The manifest for the forms: the PIC first, then the PAX in seat order (the aircraft's seat
 * layout; manifest order when there is no aircraft). A flight without a PIC row still lists the
 * pilot as PIC, since the pilot is always on board.
 */
export function formPeople({ flight, aircraft, pilot, passengers }: FormExportProps): FormPerson[] {
  const layout = aircraft ? seatLayout(aircraft.massBalance.stations) : [];
  const seatIndex = (id: string) => {
    const i = layout.findIndex((s) => s.id === id);
    return i < 0 ? layout.length : i;
  };
  const seatLabel = (id: string) => layout.find((s) => s.id === id)?.label ?? id;
  const crew = [...flight.crew];
  if (!crew.some((c) => c.role === 'PIC')) {
    crew.unshift({ role: 'PIC', passengerId: null, seat: layout[0]?.id ?? 'front-left', snapshot: { ...pilotDetails(pilot) } });
  }
  return crew
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.role === b.c.role ? seatIndex(a.c.seat) - seatIndex(b.c.seat) || a.i - b.i : a.c.role === 'PIC' ? -1 : 1))
    .map(({ c }) => ({ role: c.role, seat: c.seat, seatLabel: seatLabel(c.seat), details: resolveDetails(c, pilot, passengers) }));
}

function pilotDetails(p: Pilot): PersonDetails {
  return {
    fullName: p.fullName,
    phone: p.phone,
    dateOfBirth: p.dateOfBirth,
    weightKg: p.weightKg,
    idNumber: p.idNumber,
    idType: p.idType,
    nationality: p.nationality,
    relation: p.relation,
  };
}

/** "ID AB 123456" / "PASSPORT X1234567" / the bare number when the type is unknown. */
export function idText(d: Pick<PersonDetails, 'idType' | 'idNumber'>): string {
  const n = d.idNumber.trim();
  if (!n) return '';
  return d.idType ? `${d.idType} ${n}` : n;
}

/** Split a list into pages of `size` (at least one page, possibly empty). */
export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out.length ? out : [[]];
}
