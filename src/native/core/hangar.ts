// The hangar as the website's aircraft page edits it: type templates, validation (the issues bar),
// the editors' helpers (FPL item 10, compass cards, stations and seats, fuel types, performance
// tables) and the version history in words.
import {
  addedText,
  addOptions,
  type AddSource,
  alreadyInHangar,
  defaultSource,
  keepsOperator,
  newAircraftInput,
  normalRegistration,
  registrationTaken,
} from '../../features/hangar/add';
import {
  addCombinedLimit,
  addCompassCard,
  addFuelType,
  addHeadwind,
  addLandingAltitude,
  addRunwayCondition,
  addSeat,
  addStallSpeeds,
  addStation,
  addTakeoffAltitude,
  addTakeoffMassRow,
  addUtilityEnvelope,
  ADS_CODES,
  badPbn,
  blankCardPoints,
  cardStatus,
  deviationOf,
  insidePolygon,
  issuesAt,
  ITEM10A_CODES,
  item18Dropped,
  join10a,
  join10b,
  makePrimaryFuel,
  missingEssentials,
  momentPolygonFromCg,
  otherFuelTypes,
  polygonArea,
  removeFuelType,
  removeHeadwind,
  removeLandingAltitude,
  removeSeat,
  removeStation,
  removeTakeoffAltitude,
  removeTakeoffMassRow,
  sameTypeCopy,
  selfIntersects,
  setArmRange,
  setRunwayConditions,
  setStationKind,
  split10a,
  split10b,
  SSR_CODES,
  validateAircraft as validateAircraftOf,
} from '../../features/hangar/model';
import { buildFromTemplate, TYPE_TEMPLATES } from '../../features/hangar/templates';
import {
  type AircraftInput,
  blankAircraft,
  CARD_EXPIRY_WARN_DAYS,
  type CompassCard,
  type FuelSpec,
  type FuelType,
  localToday,
  type MassBalance,
  type PerformanceFactors,
  type PerformanceTables,
  type Station,
  type StationKind,
} from '../../shared';
import { changeText, entryTitle, revisionSummary, versionChangeText } from '../../shared/aircraftHistory';
import type { AircraftLogChange, AircraftLogEntry, HangarAircraft } from '../../shared/sharing';
import { arg, type Json, nowOf, plain } from './shared';

// ---------------------------------------------------------------- a new pilot's first aircraft

/** The hangar's type templates ("Add aircraft" on the website), offered when the hangar is empty. */
export function aircraftTemplates(): { id: string; label: string; description: string }[] {
  return TYPE_TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description }));
}

/** The aircraft a template builds, with the registration: the body of POST /api/aircraft, as the
 *  website's Add aircraft dialog sends it. An unknown template id is a blank airframe. */
export function aircraftFromTemplate(input: Json<{ id: string | null; registration: string }>): AircraftInput {
  const i = arg(input);
  return plain({
    ...buildFromTemplate(i.id ?? null),
    registration: String(i.registration ?? '')
      .trim()
      .toUpperCase(),
  });
}

/**
 * The hangar's Add aircraft dialog [hangar/add.ts]. `hangar` is GET /api/aircraft; `source` the
 * chosen start (default: `copyOf`'s type, else the first template); `operator`, when the copy has an
 * operatorId, is GET /api/operators/:id (null when it could not be read): the copy keeps the operator
 * only when the pilot may assign it. Returns the choices, the body of POST /api/aircraft (or the
 * error that holds it back), the 409 message and the toast texts.
 */
export function newAircraft(
  input: Json<{
    hangar: HangarAircraft[];
    registration?: string;
    source?: AddSource | null;
    copyOf?: string | null;
    operator?: { access: { role: string } } | null;
  }>,
) {
  const i = arg(input);
  const hangar = i.hangar ?? [];
  const registration = normalRegistration(i.registration ?? '');
  const source = i.source ?? defaultSource(i.copyOf ? { id: i.copyOf } : null);
  const made = newAircraftInput(hangar, source, registration);
  const body = made.input;
  if (body?.operatorId && i.operator !== undefined && !keepsOperator(i.operator)) body.operatorId = null;
  return plain({
    options: addOptions(hangar),
    source,
    registration,
    taken: registrationTaken(hangar, registration),
    input: body,
    error: made.error,
    conflict: alreadyInHangar(registration),
    added: addedText(registration, false),
    addedDefault: addedText(registration, true),
  });
}

// ---------------------------------------------------------------- validation

/**
 * The aircraft page's issues ({ level, section, path, message }): errors refuse the save, warnings
 * do not. `today` (YYYY-MM-DD, default today in Greece) dates the compass cards; `path` also gives
 * the issues of that field (`at`, as issuesAt; `exact` for that field only).
 */
export function validateAircraft(
  input: Json<{
    aircraft: AircraftInput;
    today?: string | null;
    cardWarnDays?: number | null;
    path?: string | null;
    exact?: boolean;
    now?: number;
  }>,
) {
  const i = arg(input);
  const issues = validateAircraftOf(
    i.aircraft,
    i.today || localToday(nowOf(i.now)),
    i.cardWarnDays ?? CARD_EXPIRY_WARN_DAYS,
  );
  return plain({
    issues,
    errors: issues.filter((x) => x.level === 'error').length,
    missing: missingEssentials(i.aircraft),
    at: i.path != null ? issuesAt(issues, i.path, !!i.exact) : null,
  });
}

// ---------------------------------------------------------------- the editors' helpers

type Ops = {
  codes: object;
  split10a: { text: string };
  join10a: { codes: string[] };
  split10b: { text: string };
  join10b: { ssr: string; ads: string[] };
  badPbn: { text: string };
  item18Dropped: { aircraft: Pick<AircraftInput, 'equipment' | 'operator' | 'icaoType'> };
  cardStatus: { card: Pick<CompassCard, 'expires'>; today?: string; warnDays?: number; now?: number };
  deviation: { forDeg: number; steerDeg: number };
  blankCard: object;
  addCompassCard: { aircraft: AircraftInput; today?: string; now?: number };
  blank: object;
  sameTypeCopy: { aircraft: AircraftInput; registration: string };
  addStation: { massBalance: MassBalance; kind: StationKind };
  setStationKind: { massBalance: MassBalance; index: number; kind: StationKind };
  removeStation: { massBalance: MassBalance; index: number };
  addSeat: { massBalance: MassBalance; index: number; label?: string };
  removeSeat: { massBalance: MassBalance; index: number; seat: number };
  setArmRange: { station: Station; end: 0 | 1; value: number | null };
  addCombinedLimit: { massBalance: MassBalance };
  addUtilityEnvelope: { massBalance: MassBalance };
  momentPolygon: { polygon: [number, number][]; steps?: number };
  polygonCheck: { polygon: [number, number][]; point?: [number, number] };
  addFuelType: { fuel: FuelSpec; type: FuelType };
  removeFuelType: { fuel: FuelSpec; type: FuelType };
  makePrimaryFuel: { fuel: FuelSpec; type: FuelType };
  addRunwayCondition: { factors: PerformanceFactors; name?: string; factor?: number };
  setRunwayConditions: { factors: PerformanceFactors; entries: [string, number][] };
  addStallSpeeds: { performance: PerformanceTables };
  takeoffTable: {
    table: PerformanceTables['takeoff'];
    edit: 'addAltitude' | 'removeAltitude' | 'addMassRow' | 'removeMassRow' | 'addHeadwind' | 'removeHeadwind';
    index?: number;
    row?: number;
  };
  landingTable: { table: PerformanceTables['landing']; edit: 'addAltitude' | 'removeAltitude'; index?: number };
};

type Op = { [K in keyof Ops]: { op: K } & Ops[K] }[keyof Ops];

/**
 * The aircraft editors' helpers (src/features/hangar/model.ts), by `op`. Those that change a record
 * take it and answer the changed copy (the website changes its draft in place): `massBalance`,
 * `fuel`, `factors`, `performance`, `station`, `aircraft` or `table`, with what they made.
 */
export function aircraftHelpers(input: Json<Op>) {
  const i = arg(input);
  const today = (t: string | undefined, now: number | undefined) => t || localToday(nowOf(now));
  switch (i.op) {
    case 'codes':
      return plain({ item10a: ITEM10A_CODES, ssr: SSR_CODES, ads: ADS_CODES });
    case 'split10a':
      return { codes: split10a(i.text ?? '') };
    case 'join10a':
      return { text: join10a(i.codes ?? []) };
    case 'split10b':
      return split10b(i.text ?? '');
    case 'join10b':
      return { text: join10b(i.ssr ?? '', i.ads ?? []) };
    case 'badPbn':
      return { bad: badPbn(i.text ?? '') };
    case 'item18Dropped':
      return { dropped: item18Dropped(i.aircraft) };
    case 'cardStatus':
      return cardStatus(i.card, today(i.today, i.now), i.warnDays ?? CARD_EXPIRY_WARN_DAYS);
    case 'deviation':
      return { deviationDeg: deviationOf(i.forDeg, i.steerDeg) };
    case 'blankCard':
      return { points: blankCardPoints() };
    case 'addCompassCard': {
      const aircraft = plain(i.aircraft);
      const card = addCompassCard(aircraft, today(i.today, i.now));
      return plain({ aircraft, card });
    }
    case 'blank':
      return plain(blankAircraft());
    case 'sameTypeCopy':
      return plain(sameTypeCopy(i.aircraft, i.registration));
    case 'addStation': {
      const massBalance = plain(i.massBalance);
      const station = addStation(massBalance, i.kind);
      return plain({ massBalance, station });
    }
    case 'setStationKind':
      return changed('massBalance', i.massBalance, (mb) => setStationKind(mb, i.index, i.kind));
    case 'removeStation':
      return changed('massBalance', i.massBalance, (mb) => removeStation(mb, i.index));
    case 'addSeat':
      return changed('massBalance', i.massBalance, (mb) => addSeat(mb, i.index, i.label));
    case 'removeSeat':
      return changed('massBalance', i.massBalance, (mb) => removeSeat(mb, i.index, i.seat));
    case 'setArmRange':
      return changed('station', i.station, (s) => setArmRange(s, i.end, i.value));
    case 'addCombinedLimit':
      return changed('massBalance', i.massBalance, (mb) => addCombinedLimit(mb));
    case 'addUtilityEnvelope':
      return changed('massBalance', i.massBalance, (mb) => addUtilityEnvelope(mb));
    case 'momentPolygon':
      return { polygon: momentPolygonFromCg(i.polygon ?? [], i.steps) };
    case 'polygonCheck':
      return {
        selfIntersects: selfIntersects(i.polygon ?? []),
        area: polygonArea(i.polygon ?? []),
        inside: i.point ? insidePolygon(i.point, i.polygon ?? []) : null,
      };
    case 'addFuelType':
      return withOthers(changed('fuel', i.fuel, (f) => addFuelType(f, i.type)));
    case 'removeFuelType':
      return withOthers(changed('fuel', i.fuel, (f) => removeFuelType(f, i.type)));
    case 'makePrimaryFuel':
      return withOthers(changed('fuel', i.fuel, (f) => makePrimaryFuel(f, i.type)));
    case 'addRunwayCondition': {
      const factors = plain(i.factors);
      const name = addRunwayCondition(factors, i.name, i.factor);
      return plain({ factors, name });
    }
    case 'setRunwayConditions':
      return changed('factors', i.factors, (f) => setRunwayConditions(f, i.entries ?? []));
    case 'addStallSpeeds':
      return changed('performance', i.performance, (p) => addStallSpeeds(p));
    case 'takeoffTable': {
      const t = i.table;
      const n = i.index ?? 0;
      const table =
        i.edit === 'addAltitude'
          ? addTakeoffAltitude(t)
          : i.edit === 'removeAltitude'
            ? removeTakeoffAltitude(t, n)
            : i.edit === 'addMassRow'
              ? addTakeoffMassRow(t)
              : i.edit === 'removeMassRow'
                ? removeTakeoffMassRow(t, n)
                : i.edit === 'addHeadwind'
                  ? addHeadwind(t, i.row ?? 0)
                  : removeHeadwind(t, i.row ?? 0, n);
      return plain({ table });
    }
    case 'landingTable':
      return plain({
        table: i.edit === 'addAltitude' ? addLandingAltitude(i.table) : removeLandingAltitude(i.table, i.index ?? 0),
      });
    default:
      throw new Error(`unknown aircraft helper ${String((i as { op?: unknown }).op)}`);
  }
}

/** A copy of `value` changed by `fn`, answered as { [key]: copy }. */
function changed<K extends string, T>(key: K, value: T, fn: (v: T) => unknown): Record<K, T> {
  const copy = plain(value);
  fn(copy);
  return { [key]: copy } as Record<K, T>;
}

/** The fuel types the aircraft does not list yet, offered by "Add fuel type". */
const withOthers = (r: { fuel: FuelSpec }) => ({ ...r, others: otherFuelTypes(r.fuel) });

// ---------------------------------------------------------------- version history

/**
 * The aircraft's history in words (src/shared/aircraftHistory.ts): for each entry of GET
 * /api/aircraft/:id/log or /revisions, its `title` (headed by who did it; `myId` is the session
 * pilot's id, shown as "you"), its `changes` and the one-line `summary`; for the differences of a
 * version from the current aircraft (`versionChanges`), each one's line.
 */
export function historyText(
  input: Json<{
    entries?: AircraftLogEntry[] | null;
    myId?: string | null;
    versionChanges?: AircraftLogChange[] | null;
  }>,
) {
  const i = arg(input);
  const myId = i.myId ?? '';
  return plain({
    entries: (i.entries ?? []).map((e) => ({
      title: entryTitle(e, myId),
      changes: (e.changes ?? []).map(changeText),
      summary: revisionSummary(e),
    })),
    versionChanges: (i.versionChanges ?? []).map(versionChangeText),
  });
}
