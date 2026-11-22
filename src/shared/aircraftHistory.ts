// The aircraft edit log and version history in words (src/shared/sharing.ts): who, when, and each
// change as "<field>: old → new", or the server's summary for lists and tables. Shared because the
// server writes the same lines as revision summaries (GET /api/aircraft/:id/revisions).
import { fmtLocalDayTime } from './format.js';
import type { AircraftEditor, AircraftLogChange, AircraftLogEntry, AircraftLogValue } from './sharing.js';

/** Field names (and units) by path; anything else is named from its path. */
const FIELDS: Record<string, [string, string?]> = {
  registration: ['Registration'],
  makeModel: ['Make and model'],
  icaoType: ['ICAO type'],
  wake: ['Wake category'],
  serial: ['Serial number'],
  operator: ['Operator'],
  homeBase: ['Home base'],
  colours: ['Colours and markings'],
  cruiseTasKt: ['Cruise TAS', 'kt'],
  patternTasKt: ['Pattern TAS', 'kt'],
  climbTasKt: ['Climb TAS', 'kt'],
  notes: ['Notes'],
  'fuel.types': ['Approved fuels'],
  'fuel.totalL': ['Total fuel capacity', 'L'],
  'fuel.usableL': ['Usable fuel', 'L'],
  'fuel.unusableL': ['Unusable fuel', 'L'],
  'fuel.unusableIncludedInEmptyMass': ['Unusable fuel in the empty mass'],
  'fuel.tanks': ['Tanks'],
  'fuel.burnLph': ['Fuel burn', 'L/h'],
  'fuel.taxiAllowanceL': ['Taxi allowance', 'L'],
  'massBalance.datum': ['Datum'],
  'massBalance.emptyMassKg': ['Empty mass', 'kg'],
  'massBalance.emptyArmM': ['Empty CG arm', 'm'],
  'massBalance.emptyMomentKgM': ['Empty moment', 'kg·m'],
  'massBalance.weighingDate': ['Weighing date'],
  'massBalance.weighingSource': ['Weighing report'],
  'massBalance.includesOil': ['Empty mass includes oil'],
  'massBalance.mtowKg': ['MTOW', 'kg'],
  'massBalance.mlwKg': ['MLW', 'kg'],
  'massBalance.envelopes.normal.maxKg': ['Normal category max mass', 'kg'],
  'massBalance.envelopes.normal.notes': ['Normal category notes'],
  'massBalance.envelopes.utility.maxKg': ['Utility category max mass', 'kg'],
  'massBalance.envelopes.utility.notes': ['Utility category notes'],
  'performance.takeoff.source': ['Take-off table source'],
  'performance.takeoff.flaps': ['Take-off flaps'],
  'performance.takeoff.tempIncreasePer15C': ['Take-off increase per 15 °C'],
  'performance.takeoff.grassAddFractionOfTotal': ['Take-off grass addition'],
  'performance.landing.source': ['Landing table source'],
  'performance.landing.flaps': ['Landing flaps'],
  'performance.landing.massKg': ['Landing table mass', 'kg'],
  'performance.landing.approachIasKt': ['Approach IAS', 'kt'],
  'performance.landing.headwindDecreasePer5Kt': ['Landing decrease per 5 kt headwind'],
  'performance.landing.tempIncreasePer15C': ['Landing increase per 15 °C'],
  'performance.landing.grassAddFractionOfTotal': ['Landing grass addition'],
  'performance.factors.source': ['Performance factors source'],
  'performance.factors.safetyFactorTakeoff': ['Take-off safety factor'],
  'performance.factors.safetyFactorLanding': ['Landing safety factor'],
  'performance.factors.slopeFactorPer2Pct': ['Slope factor per 2%'],
  'performance.factors.maxCrosswindKt.takeoff': ['Max crosswind for take-off', 'kt'],
  'performance.factors.maxCrosswindKt.landing': ['Max crosswind for landing', 'kt'],
  'equipment.item10a': ['FPL item 10a'],
  'equipment.item10b': ['FPL item 10b'],
  'equipment.pbn': ['PBN'],
  'equipment.item18Extras': ['Item 18 extras'],
  'equipment.remarks': ['Item 19 remarks'],
  'equipment.jackets.present': ['Life jackets carried'],
  'equipment.dinghies.number': ['Dinghies'],
  'equipment.dinghies.capacity': ['Dinghy capacity'],
  'equipment.dinghies.covered': ['Dinghies covered'],
  'equipment.dinghies.colour': ['Dinghy colour'],
  title: ['Title'],
};
const GROUP_NAMES: Record<string, string> = {
  emergencyRadio: 'Emergency radio',
  survival: 'Survival equipment',
  jackets: 'Life jackets',
};

/** 'item18Extras' → 'item 18 extras'. */
const words = (key: string) =>
  key
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .toLowerCase();

export function fieldName(path: string): [string, string?] {
  if (FIELDS[path]) return FIELDS[path];
  const parts = path.split('.');
  const group = GROUP_NAMES[parts[parts.length - 2]];
  const last = words(parts[parts.length - 1]);
  if (group) return [`${group}: ${last.toUpperCase()}`];
  const s = parts.length > 1 ? `${words(parts[parts.length - 2])} ${last}` : last;
  return [s.charAt(0).toUpperCase() + s.slice(1)];
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function fmtValue(v: AircraftLogValue | undefined, unit?: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return unit ? `${v} ${unit}` : String(v);
}

/** One change in words. */
export function changeText(c: AircraftLogChange): string {
  if (c.summary) return capital(c.summary);
  const [name, unit] = fieldName(c.path);
  if (!('from' in c) && !('to' in c)) return `${name} changed`;
  return `${name}: ${fmtValue(c.from, unit)} → ${fmtValue(c.to, unit)}`;
}

/** 'you', the pilot's name, or 'a former pilot' (a deleted account). */
export function editorName(e: AircraftEditor, myId: string): string {
  if (!e.pilotId) return 'a former pilot';
  return e.pilotId === myId ? 'you' : e.name || 'a pilot';
}

const quoted = (s: string | undefined) => `“${s ?? ''}”`;
const access = (role: string | undefined) => (role === 'edit' ? 'can edit' : 'can view');

/** What an entry did, as a line headed by who did it; the edit's fields are listed under it. */
export function entryTitle(e: AircraftLogEntry, myId: string): string {
  const who = capital(editorName(e.by, myId));
  const person = e.personId && e.personId === myId ? 'you' : e.person || 'a former pilot';
  switch (e.kind) {
    case 'create':
      return `${who} added the aircraft`;
    case 'edit':
      return `${who} changed ${e.changes.length === 1 ? '1 field' : `${e.changes.length} fields`}`;
    case 'document-add':
      return `${who} added the document ${quoted(e.file)}`;
    case 'document-remove':
      return `${who} removed the document ${quoted(e.file)}`;
    case 'document-rename':
      return `${who} renamed the document ${quoted(e.changes[0]?.from as string)} to ${quoted(e.file)}`;
    case 'photo-set':
      return `${who} changed the photo`;
    case 'photo-remove':
      return `${who} removed the photo`;
    case 'share-add':
      return `${who} shared it with ${person} (${access(e.role)})`;
    case 'share-role':
      return `${who} gave ${person} ${e.role === 'edit' ? 'edit' : 'view'} access`;
    case 'share-remove':
      return e.personId && e.personId === e.by.pilotId
        ? `${who} removed it from ${e.by.pilotId === myId ? 'your' : 'their'} hangar`
        : `${who} removed ${person}`;
    case 'restore': {
      const r = e.restored;
      const when = fmtLocalDayTime(r?.at, { fallback: 'an earlier time' });
      return `${who} restored the version of ${when}${r ? ` by ${editorName(r.by, myId)}` : ''}`;
    }
    case 'baseline':
      return 'The aircraft as it was when version history began';
  }
}

/** A revision's line for someone other than its author (the API's summary): the title, then its changes. */
export function revisionSummary(e: AircraftLogEntry): string {
  const title = entryTitle(e, '');
  const changes = e.kind === 'edit' || e.kind === 'restore' ? e.changes.map(changeText) : [];
  return changes.length ? `${title}: ${changes.join('; ')}` : title;
}

/** One difference of a version from the current aircraft (`from` now, `to` the version). */
export function versionChangeText(c: AircraftLogChange): string {
  if (c.summary) return capital(c.summary);
  const [name, unit] = fieldName(c.path);
  if (!('from' in c) && !('to' in c)) return `${name} differs`;
  return `${name}: ${fmtValue(c.to, unit)} (now ${fmtValue(c.from, unit)})`;
}
