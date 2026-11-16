// Where an export warning is fixed, and the link that takes the pilot there (pure: no React).
//
//   flight     the flight editor, /flights/:id?focus=<EditorFocus> (the panel section opens, the input
//              is scrolled to, focused and highlighted: src/app/focusParam.ts)
//   aircraft   the aircraft in the hangar, /hangar/:id?focus=<field> (data-focus on its Field)
//   profile    the pilot's profile, /profile?focus=<input name>
//   person     the passenger dialog, /passengers?edit=<id|me>&fields=<names>
//
// Models whose warnings are generated here (FPL, Form 731, GenDec) attach a Fix to each warning.
// Warnings that come as text from src/calc (navlog, fuel, W&B, performance) are mapped by
// planningFix().

/** Editor inputs that can be focused (data-focus keys; the panel section of each: EDITOR_FOCUS_SECTION). */
export type EditorFocus =
  | 'date'
  | 'blockOff'
  | 'taxiOut'
  | 'taxiIn'
  | 'aircraft'
  | 'compassCard'
  | 'manifest'
  | 'baggage'
  | 'fob'
  | 'performance'
  | 'alternates'
  | 'remarks'
  | 'requests';

/** The editor panel section (Section id) that holds each focus key. */
export const EDITOR_FOCUS_SECTION: Record<EditorFocus, string> = {
  date: 'when',
  blockOff: 'when',
  taxiOut: 'when',
  taxiIn: 'when',
  aircraft: 'aircraft',
  compassCard: 'aircraft',
  manifest: 'manifest',
  baggage: 'manifest',
  fob: 'fuel',
  performance: 'performance',
  alternates: 'fpl',
  remarks: 'fpl',
  requests: 'fpl',
};

/** Fields of the hangar aircraft page that can be focused (data-focus on the Field, or a section id). */
export type AircraftFocus =
  | 'registration'
  | 'icaoType'
  | 'wake'
  | 'colours'
  | 'operator'
  | 'item10a'
  | 'item10b'
  | 'pbn'
  | 'item18Extras'
  | 'remarks'
  | 'cruiseTasKt'
  | 'patternTasKt'
  | 'burnLph'
  | 'fuel'
  | 'emptyMassKg'
  | 'mb'
  | 'performance'
  | 'compass';

export type PersonField = 'fullName' | 'idNumber' | 'phone';

export type Fix =
  | { kind: 'flight'; focus?: EditorFocus }
  /** id: the aircraft (the caller's aircraft when omitted). */
  | { kind: 'aircraft'; id?: string; focus?: AircraftFocus }
  | { kind: 'profile'; focus?: 'fullName' | 'phone' | 'homeAerodrome' | 'taxiOutMin' | 'taxiInMin' | 'reserveMin' }
  /** key: 'PIC' (the pilot) or a passenger id. */
  | { kind: 'person'; key: string; fields?: PersonField[] };

export interface FixContext {
  flightId?: string;
  aircraftId?: string | null;
}

const FIELD_LABEL: Record<PersonField, string> = { fullName: 'name', idNumber: 'ID number', phone: 'phone' };

/** The link of a fix, or null when it cannot be resolved (no flight id, no aircraft). */
export function fixLink(f: Fix, ctx: FixContext): { to: string; label: string } | null {
  switch (f.kind) {
    case 'flight':
      if (!ctx.flightId) return null;
      return { to: `/flights/${ctx.flightId}${f.focus ? `?focus=${f.focus}` : ''}`, label: 'Fix in the flight' };
    case 'aircraft': {
      const id = f.id || ctx.aircraftId;
      if (!id) return null;
      return { to: `/hangar/${id}${f.focus ? `?focus=${f.focus}` : ''}`, label: 'Fix in the hangar' };
    }
    case 'profile':
      return { to: `/profile${f.focus ? `?focus=${f.focus}` : ''}`, label: 'Fix in your profile' };
    case 'person': {
      const me = f.key === 'PIC';
      const fields = f.fields ?? [];
      const what = fields.map((x) => FIELD_LABEL[x]).join(' and ');
      const q = `edit=${encodeURIComponent(me ? 'me' : f.key)}${fields.length ? `&fields=${fields.join(',')}` : ''}`;
      return {
        to: `/passengers?${q}`,
        label: what ? `Add ${me ? 'your' : 'their'} ${what}` : me ? 'Edit your details' : 'Edit passenger',
      };
    }
  }
}

/**
 * The fix of a planning warning given as text by src/calc (navlog, fuel plan, W&B, performance)
 * or by the export models built on them. Prefixes such as "W&B: " or "Take-off LGTT: " are
 * ignored. null = nothing the pilot can change (weather, aerodrome data).
 */
export function planningFix(text: string): Fix | null {
  const prefix = /^(W&B|Performance|Departure|Destination|Take-off|Landing|Touch-and-go|Stop)\b[^:]*:\s*/i;
  const t = text.replace(prefix, '').replace(prefix, '');
  const flight = (focus?: EditorFocus): Fix => ({ kind: 'flight', focus });
  const aircraft = (focus?: AircraftFocus): Fix => ({ kind: 'aircraft', focus });
  if (/block-off time not set|after sunset/i.test(t)) return flight('blockOff');
  if (/taxi-out time not set/i.test(t)) return flight('taxiOut');
  if (/taxi-in time not set/i.test(t)) return flight('taxiIn');
  if (/flight date not set|has no date|no date/i.test(t)) return flight('date');
  if (/no aircraft (selected|chosen)|aircraft chosen for this flight/i.test(t)) return flight('aircraft');
  if (/burn rate not set|burn rate/i.test(t)) return aircraft('burnLph');
  if (/TAS not set|cruising speed/i.test(t)) return aircraft('cruiseTasKt');
  if (/compass card/i.test(t)) return aircraft('compass');
  if (/empty mass is not set/i.test(t)) return aircraft('emptyMassKg');
  if (/no fuel station|unknown station|arm .* is outside/i.test(t)) return aircraft('mb');
  if (/performance tables|outside the AFM table/i.test(t)) return aircraft('performance');
  if (/reserve not set in the profile/i.test(t)) return { kind: 'profile', focus: 'reserveMin' };
  if (/usable fuel capacity not set/i.test(t)) return aircraft('fuel');
  if (/baggage/i.test(t)) return flight('baggage');
  if (/fuel on board|fuel at landing|not enough fuel|endurance|usable fuel|reserve/i.test(t)) return flight('fob');
  if (/manifest|weight of|mass of|seat .* does not exist|masses are not from the loading sheet|weight missing/i.test(t))
    return flight('manifest');
  if (
    /surface|runway .* not chosen|crosswind|tailwind|over (MTOW|the maximum)|exceeds|MTOW|MLW|take-off distance|landing distance|TODA|LDA/i.test(
      t,
    )
  )
    return flight('performance');
  if (/no route|not an aerodrome|no destination|altitude unknown|route/i.test(t)) return flight();
  return null;
}
