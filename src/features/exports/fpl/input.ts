// FplInput from the app's records: flight, aircraft (hangar), pilot (profile), navlog and fuel plan.
import type { FuelPlan, NavlogResult } from '../../../calc';
import { endpointAerodrome } from '../../../data/atc';
import { refOfFlight } from '../../../data/ref';
import { type Aircraft, type Flight, isLocalFlight, localDuration, type Pilot, requestRemarks } from '../../../shared';
import type { AerodromeFinder } from '../../../shared/aerodrome';
import type { RefAerodrome } from '../../../shared/ref';
import type { Fix } from '../fix';
import type { FplAerodrome, FplInput, FplResult } from './fpl';

const BLANK_EQUIPMENT: Aircraft['equipment'] = {
  item10a: '',
  item10b: '',
  pbn: '',
  item18Extras: '',
  emergencyRadio: { uhf: false, vhf: false, elt: false },
  survival: { polar: false, desert: false, maritime: false, jungle: false },
  jackets: { present: false, light: false, fluorescein: false, uhf: false, vhf: false },
  dinghies: null,
  remarks: '',
};

const toFpl = (a: RefAerodrome): FplAerodrome => ({ icao: a.icao, name: a.name, lat: a.lat, lon: a.lon });

/** Alternate typed as an ICAO indicator or a reference aerodrome id; unknown ones keep the text. */
export function alternateOf(s: string, find: AerodromeFinder<RefAerodrome>): FplAerodrome | null {
  const t = (s || '').trim().toUpperCase();
  if (!t) return null;
  const a = find(t);
  if (a) return toFpl(a);
  return { icao: /^[A-Z]{4}$/.test(t) ? t : null, name: t, lat: NaN, lon: NaN };
}

/**
 * Total EET (item 16): the navlog's total ETE (Σ of the rounded leg times, as on the MD 4.2 sheet;
 * a local flight's duration), else the unrounded flight time rounded up.
 */
export function totalEetMin(navlog: NavlogResult | null): number | null {
  if (!navlog || (!navlog.legs.length && !navlog.local)) return null;
  if (isFinite(navlog.totals.ete) && navlog.totals.ete > 0) return navlog.totals.ete;
  return isFinite(navlog.flightMin) ? Math.ceil(navlog.flightMin - 1e-9) : null;
}

export interface FplSources {
  flight: Flight;
  aircraft: Aircraft | null;
  pilot: Pick<Pilot, 'fullName' | 'phone'>;
  navlog: NavlogResult | null;
  fuel: FuelPlan | null;
}

/** With the reference data of the cycle in effect on the flight's date. */
export function fplInputFrom(o: FplSources): FplInput {
  const rd = refOfFlight(o.flight.date);
  return fplInputWith(o, rd.ref.aerodromes, rd.aerodrome);
}

/** fplInputFrom with other reference data (the native core's GET /api/ref/bundle). */
export function fplInputWith(o: FplSources, aerodromes: RefAerodrome[], find: AerodromeFinder<RefAerodrome>): FplInput {
  const { flight, aircraft: ac, pilot, navlog, fuel } = o;
  const route = flight.route;
  const picSnap = flight.crew.find((c) => c.role === 'PIC')?.snapshot;
  const first = route[0];
  const last = route.length > 1 ? route[route.length - 1] : undefined;
  const dep = first ? endpointAerodrome(first, aerodromes) : null;
  const dest = last ? endpointAerodrome(last, aerodromes) : null;
  // an endpoint that is not an aerodrome still goes out (ZZZZ + DEP/ DEST/ with its position)
  const asPoint = (p: typeof first | undefined): FplAerodrome | null =>
    p ? { icao: null, name: p.name, lat: p.lat, lon: p.lon } : null;
  return {
    registration: ac?.registration ?? '',
    icaoType: ac?.icaoType ?? '',
    makeModel: ac?.makeModel ?? '',
    wake: ac?.wake ?? 'L',
    equipment: ac?.equipment ?? BLANK_EQUIPMENT,
    operator: ac?.operator ?? '',
    colours: ac?.colours ?? '',
    date: flight.date,
    eobt: flight.blockOff,
    departure: dep ? toFpl(dep) : asPoint(first),
    destination: dest ? toFpl(dest) : asPoint(last),
    alternates: (flight.options.alternates || [])
      .map((a) => alternateOf(a, find))
      .filter((x): x is FplAerodrome => !!x),
    route: route.map((p) => ({
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      kind: p.kind,
      icao: p.kind === 'aerodrome' ? (endpointAerodrome(p, aerodromes)?.icao ?? null) : null,
    })),
    local: isLocalFlight(route),
    cruiseTasKt: ac?.cruiseTasKt ?? NaN,
    // a local flight's EET is the pilot's duration even before the aircraft (and so the navlog) is known
    totalEetMin: totalEetMin(navlog) ?? localDuration(route, flight.options),
    enduranceMin: fuel && isFinite(fuel.enduranceMin) ? fuel.enduranceMin : null,
    personsOnBoard: flight.crew.length || null,
    // the profile is current; the manifest snapshot of the PIC fills what the profile lacks
    pic: { fullName: pilot.fullName || picSnap?.fullName || '', phone: pilot.phone || picSnap?.phone || '' },
    remarks: flight.options.remarks || '',
    requests: requestRemarks(route, flight.options, (p) => endpointAerodrome(p, aerodromes)?.icao ?? null),
  };
}

/** The FPL page's warnings: the aircraft first (none chosen, or no longer in the hangar), then the message's. */
export function fplWarnings(
  fpl: Pick<FplResult, 'warnings' | 'fixes'>,
  o: { aircraftId: string | null; aircraftFound: boolean; aircraftLoading?: boolean },
): { text: string; fix?: Fix }[] {
  const warnings: { text: string; fix?: Fix }[] = [];
  if (!o.aircraftId)
    warnings.push({ text: 'No aircraft chosen for this flight.', fix: { kind: 'flight', focus: 'aircraft' } });
  else if (!o.aircraftLoading && !o.aircraftFound)
    warnings.push({
      text: 'The flight’s aircraft is no longer in the hangar.',
      fix: { kind: 'flight', focus: 'aircraft' },
    });
  for (const w of fpl.warnings) warnings.push({ text: w, fix: fpl.fixes[w] });
  return warnings;
}
