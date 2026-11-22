// "Ready to fly": the flight's checklist, by stage (UX-PLAN.md steps 1–2). Pure: the editor feeds it
// the computed warnings, the NOTAM briefing and the paperwork states, and shows one row per item.
//
//   plan   what the pilot decides: route, aircraft, navlog and altitudes, fuel, people and W&B
//   brief  what the app works out to brief them: times and daylight, aerodromes, weather, take-off
//          and landing, NOTAMs (read when the pilot says so)
//   file   what they have to produce: the flight plan, Form 731, the General Declaration when they
//          send it themselves, the operator's sheets when the operator asks for them
//
// A row is 'ok', 'warn', 'danger', or 'todo' (something still to do that is not wrong). The worst
// warning of a row is its text; its fix is the warning's fix.
import type { FilingState, NotamBriefing } from '../../../shared/briefing';
import type { DeclarationsState } from '../../../shared/declarations';
import type { FormsState } from '../../../shared/forms';
import { planningFix } from '../../exports/fix';
import type { CalcWarning, WarningArea } from './flightCalc';

export type Stage = 'plan' | 'brief' | 'file';
export const STAGES: readonly Stage[] = ['plan', 'brief', 'file'];
export const STAGE_LABEL: Record<Stage, string> = { plan: 'Plan', brief: 'Brief', file: 'File & forms' };

export const SECTION_STAGE: Record<string, Stage> = {
  route: 'plan',
  when: 'plan',
  aircraft: 'plan',
  manifest: 'plan',
  fuel: 'plan',
  metar: 'brief',
  notams: 'brief',
  aerodromes: 'brief',
  performance: 'brief',
  atc: 'brief',
  fpl: 'plan',
};

export type ItemState = 'ok' | 'warn' | 'danger' | 'todo';

export interface ReadyItem {
  id: string;
  stage: Stage;
  state: ItemState;
  label: string;
  /** What is wrong or left to do; null when ok (the label says it all). */
  text: string | null;
  /** The warning behind the text (its fix is offered), if any. */
  warning: CalcWarning | null;
  section: string;
  /** A page elsewhere that fixes it (the profile). */
  link?: { label: string; to: string };
}

export interface ReadinessInput {
  /** What the pilot's profile lacks for the forms and the flight plan ('name', 'phone'). */
  profileMissing: string[];
  routePoints: number;
  hasAircraft: boolean;
  warnings: CalcWarning[];
  /** null: not loaded (or no route). */
  notams: NotamBriefing | null;
  /** The relevant NOTAMs were marked read (for the current set of relevant ones). */
  notamsRead: boolean;
  filing: FilingState | null;
  forms: FormsState | null;
  declarations: DeclarationsState | null;
}

export const profileMissingOf = (p: { fullName: string; phone: string }): string[] =>
  [!p.fullName.trim() && 'name', !p.phone.trim() && 'phone'].filter((x): x is string => !!x);

/** The warnings as the checklist files them: what is fixed in the aircraft's record (TAS, burn rate,
 *  envelope) belongs to the Aircraft row. */
export const readinessWarnings = (warnings: CalcWarning[]): CalcWarning[] =>
  warnings.map((w) => (planningFix(w.text)?.kind === 'aircraft' ? { ...w, area: 'aircraft' as const } : w));

const RANK: Record<ItemState, number> = { ok: 0, todo: 1, warn: 2, danger: 3 };
const worse = (a: ItemState, b: ItemState) => (RANK[b] > RANK[a] ? b : a);

/** A row made from the warnings of some areas: the worst one sets its state and text. */
function fromWarnings(
  warnings: CalcWarning[],
  areas: WarningArea[],
  item: Omit<ReadyItem, 'state' | 'text' | 'warning'>,
): ReadyItem {
  const mine = warnings.filter((w) => areas.includes(w.area) && w.level !== 'info');
  const top = mine.find((w) => w.level === 'danger') ?? mine[0] ?? null;
  return {
    ...item,
    state: !top ? 'ok' : top.level === 'danger' ? 'danger' : 'warn',
    text: top ? (mine.length > 1 ? `${top.text} (+${mine.length - 1} more)` : top.text) : null,
    warning: top,
  };
}

const FILED_OPEN = new Set([
  'filed',
  'manual_correction',
  'departed',
  'arriving',
  'arrived',
  'closed',
  'terminated',
  'delivered',
]);

export function readiness(i: ReadinessInput): ReadyItem[] {
  const w = i.warnings;
  const items: ReadyItem[] = [];
  // A new pilot's profile first: it goes on the flight plan and the forms.
  if (i.profileMissing.length)
    items.push({
      id: 'profile',
      stage: 'plan',
      state: 'todo',
      label: 'Your profile',
      text: `Add your ${i.profileMissing.join(' and ')}: they go on the flight plan and the forms.`,
      warning: null,
      section: 'route',
      link: { label: 'Profile', to: '/profile' },
    });
  items.push(
    i.routePoints >= 2
      ? fromWarnings(w, ['navlog'], { id: 'route', stage: 'plan', label: 'Route and altitudes', section: 'route' })
      : {
          id: 'route',
          stage: 'plan',
          state: 'todo',
          label: 'Route and altitudes',
          text: 'Draw the route on the map.',
          warning: null,
          section: 'route',
        },
  );
  items.push(
    i.hasAircraft
      ? fromWarnings(w, ['aircraft'], { id: 'aircraft', stage: 'plan', label: 'Aircraft', section: 'aircraft' })
      : {
          id: 'aircraft',
          stage: 'plan',
          state: 'todo',
          label: 'Aircraft',
          text: 'Choose the aircraft.',
          warning: null,
          section: 'aircraft',
        },
  );
  items.push(fromWarnings(w, ['fuel'], { id: 'fuel', stage: 'plan', label: 'Fuel', section: 'fuel' }));
  items.push(
    fromWarnings(w, ['manifest', 'wb'], {
      id: 'wb',
      stage: 'plan',
      label: 'People and weight & balance',
      section: 'manifest',
    }),
  );
  items.push(fromWarnings(w, ['time'], { id: 'time', stage: 'brief', label: 'Times and daylight', section: 'when' }));
  items.push(
    fromWarnings(w, ['aerodrome'], { id: 'aerodromes', stage: 'brief', label: 'Aerodromes', section: 'aerodromes' }),
  );
  items.push(fromWarnings(w, ['weather'], { id: 'weather', stage: 'brief', label: 'Weather', section: 'metar' }));
  items.push(
    fromWarnings(w, ['performance'], {
      id: 'performance',
      stage: 'brief',
      label: 'Take-off and landing',
      section: 'performance',
    }),
  );
  const n = i.notams?.status === 'ok' ? i.notams.relevantCount : null;
  items.push({
    id: 'notams',
    stage: 'brief',
    label: 'NOTAMs',
    section: 'notams',
    warning: null,
    ...(n === null
      ? { state: 'todo', text: i.notams ? (i.notams.message ?? 'Not loaded.') : 'Not loaded yet.' }
      : n === 0
        ? { state: 'ok', text: null }
        : i.notamsRead
          ? { state: 'ok', text: `${n} relevant, read.` }
          : { state: 'todo', text: `${n} relevant to read.` }),
  });
  items.push(...paperwork(i));
  return items;
}

/** The forms of a flight, as the File & forms page shows them: which document each is (its tab). */
export const PAPERWORK_KIND: Record<string, 'fpl' | 'form731' | 'gendec' | 'wbperf'> = {
  filing: 'fpl',
  form731: 'form731',
  gendec: 'gendec',
  operator: 'wbperf',
};

export function paperwork(i: Pick<ReadinessInput, 'filing' | 'forms' | 'declarations'>): ReadyItem[] {
  const out: ReadyItem[] = [];
  const f = i.filing?.filing ?? null;
  out.push({
    id: 'filing',
    stage: 'file',
    label: 'Flight plan',
    section: 'filing',
    warning: null,
    ...(f && f.status === 'rejected'
      ? { state: 'danger', text: 'Rejected: file it again.' }
      : f && f.status === 'failed'
        ? { state: 'danger', text: 'The fax did not go through: file it again.' }
        : f && f.status === 'sending'
          ? { state: 'todo', text: 'Sending by fax.' }
          : f && f.status === 'cancelled'
            ? { state: 'todo', text: 'Cancelled.' }
            : f && FILED_OPEN.has(f.status)
              ? {
                  state: 'ok',
                  text:
                    f.status === 'manual_correction'
                      ? 'Filed (in manual correction).'
                      : f.status === 'delivered'
                        ? 'Delivered by fax.'
                        : 'Filed.',
                }
              : { state: 'todo', text: 'Not filed yet.' }),
  });
  const f731 = i.forms?.form731;
  if (f731) {
    const missing = f731.signatures.filter((s) => !s.signed).length;
    const sent = f731.submission && !f731.submission.changed;
    out.push({
      id: 'form731',
      stage: 'file',
      label: 'Form 731',
      section: 'documents',
      warning: null,
      ...(sent
        ? { state: 'ok', text: 'Sent.' }
        : f731.submission?.changed
          ? { state: 'warn', text: 'Changed since it was sent: send it again.' }
          : missing
            ? { state: 'todo', text: `${missing} signature${missing > 1 ? 's' : ''} missing, then send it.` }
            : { state: 'todo', text: 'Signed: send it.' }),
    });
  }
  const g = i.forms?.gendec;
  if (g?.pilotSends)
    out.push({
      id: 'gendec',
      stage: 'file',
      label: 'General Declaration',
      section: 'documents',
      warning: null,
      ...(g.submission && !g.submission.changed
        ? { state: 'ok', text: 'Sent.' }
        : g.submission?.changed
          ? { state: 'warn', text: 'Changed since it was sent: send it again.' }
          : { state: 'todo', text: 'No handler at one end: send it yourself.' }),
    });
  const op = i.declarations?.operator;
  if (op?.requiresWbPerf)
    out.push({
      id: 'operator',
      stage: 'file',
      label: `${op.name}: W&B and performance`,
      section: 'documents',
      warning: null,
      ...(i.declarations?.submission ? { state: 'ok', text: 'Sent.' } : { state: 'todo', text: 'Not sent yet.' }),
    });
  return out;
}

/** The state of a whole stage (its worst item) and how many of its items need attention. */
export function stageSummary(items: ReadyItem[], stage: Stage): { state: ItemState; open: number } {
  const mine = items.filter((x) => x.stage === stage);
  return {
    state: mine.reduce<ItemState>((s, x) => worse(s, x.state), 'ok'),
    open: mine.filter((x) => x.state !== 'ok').length,
  };
}
