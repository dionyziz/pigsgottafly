// People and places as the website's forms take them: the passenger and profile forms' checks, typed
// positions and waypoint names, typed times, durations and dates.
import { cleanWaypointName } from '../../features/editor/map/snap';
import { type PersonForm, personForm, personInput, validatePerson } from '../../features/passengers/person';
import { formatDms, formatIcao, normaliseWaypointName, parseLatLon } from '../../features/waypoints/coords';
import { localToday, type PersonDetails } from '../../shared';
import {
  dateProblem,
  fmtDurationField,
  maskDate,
  nearestSlot,
  parseDate,
  parseDuration,
  parseTime,
  timeSlots,
} from '../../shared/typedInput';
import { arg, type Json, nowOf, plain } from './shared';

/**
 * The passenger form's (or with `pilot`, the profile's) problems, field by field ({ field, message };
 * [] when it can be saved), and `input`, the body of POST/PUT /api/passengers it saves (null while
 * there are problems). `form` is the form as typed (PersonForm); or `person`, a saved record, which
 * becomes the form the dialog opens with.
 */
export function personIssues(
  input: Json<{
    form?: PersonForm | null;
    person?: (PersonDetails & { notes?: string; licenceNo?: string; email?: string }) | null;
    pilot?: boolean;
    today?: string | null;
    now?: number;
  }>,
) {
  const i = arg(input);
  const form = i.form ?? personForm(i.person ?? null);
  const issues = validatePerson(form, { pilot: !!i.pilot, today: i.today || localToday(nowOf(i.now)) });
  return plain({ form, issues, input: issues.length ? null : personInput(form) });
}

/**
 * A position typed by the pilot (decimal degrees, with hemispheres, degrees and minutes, ICAO
 * compact), as the waypoints page reads it: `latLon` (null when the text is not a position) and its
 * DMS and ICAO forms; `name`, a waypoint name as saved.
 */
export function parseCoords(input: Json<{ text?: string | null; name?: string | null }>) {
  const i = arg(input);
  const latLon = i.text != null ? parseLatLon(i.text) : null;
  return {
    latLon,
    dms: latLon ? formatDms(latLon) : null,
    icao: latLon ? formatIcao(latLon) : null,
    name: i.name != null ? normaliseWaypointName(i.name) : null,
  };
}

/**
 * A typed value as the website's fields read it (src/shared/typedInput.ts), by `kind`: 'time'
 * (HH:MM, or null), 'duration' (minutes, or null; with `field`, the text a duration field shows),
 * 'date' (YYYY-MM-DD, '' when empty, or null; `problem` with `min`/`max`; `masked` as typed so far),
 * 'slot' (the 15-minute slot nearest a time) and 'routePoint' (a route point name as the map takes it,
 * '' when invalid).
 */
export function parseTyped(
  input: Json<{
    kind: 'time' | 'duration' | 'date' | 'slot' | 'routePoint';
    text: string;
    min?: string;
    max?: string;
    step?: number;
  }>,
) {
  const i = arg(input);
  const text = i.text ?? '';
  switch (i.kind) {
    case 'time':
      return { value: parseTime(text) };
    case 'duration': {
      const value = parseDuration(text);
      return { value, field: value == null ? null : fmtDurationField(value) };
    }
    case 'date':
      return {
        value: parseDate(text),
        problem: dateProblem(text, i.min, i.max),
        masked: maskDate(text),
      };
    case 'slot': {
      const slots = timeSlots(i.step ?? 15);
      const k = nearestSlot(slots, parseTime(text) ?? text);
      return { value: k < 0 ? null : slots[k] };
    }
    case 'routePoint':
      return { value: cleanWaypointName(text) };
    default:
      throw new Error(`unknown kind ${String((i as { kind?: unknown }).kind)}`);
  }
}
