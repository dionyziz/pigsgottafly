// The hangar's "Add aircraft": what a new aircraft can start from and the body POST /api/aircraft
// takes. The iPhone app's core wraps these (src/native/core/hangar.ts newAircraft), so the app offers
// the same choices and sends the same aircraft.
import type { HangarAircraft } from '../../shared/sharing';
import type { Aircraft, AircraftInput } from '../../shared/types';
import { sameTypeCopy, toInput } from './model';
import { buildFromTemplate, TYPE_TEMPLATES } from './templates';

export type AddSource = { kind: 'template'; id: string } | { kind: 'copy'; id: string } | { kind: 'blank' };

export interface AddOption {
  source: AddSource;
  title: string;
  description: string;
}

/** The "Start from" choices: the type templates, the same type as each aircraft in the hangar, blank. */
export function addOptions(hangar: Pick<Aircraft, 'id' | 'registration' | 'makeModel'>[]): AddOption[] {
  return [
    ...TYPE_TEMPLATES.map((t) => ({
      source: { kind: 'template' as const, id: t.id },
      title: `${t.label} type template`,
      description: t.description,
    })),
    ...hangar.map((a) => ({
      source: { kind: 'copy' as const, id: a.id },
      title: `Same type as ${a.registration}`,
      description: a.makeModel ?? '',
    })),
    { source: { kind: 'blank' as const }, title: 'Blank', description: '' },
  ];
}

/** "Add another of this type" starts from that aircraft; "Add aircraft" from the first template. */
export function defaultSource(copyOf?: Pick<Aircraft, 'id'> | null): AddSource {
  if (copyOf) return { kind: 'copy', id: copyOf.id };
  return TYPE_TEMPLATES.length ? { kind: 'template', id: TYPE_TEMPLATES[0].id } : { kind: 'blank' };
}

export function sameSource(a: AddSource, b: AddSource): boolean {
  return a.kind === b.kind && (a.kind === 'blank' || (a as { id: string }).id === (b as { id: string }).id);
}

export function normalRegistration(reg: string): string {
  return reg.trim().toUpperCase();
}

/** Registrations are unique among the pilot's own aircraft (a shared one may have the same). */
export function registrationTaken(hangar: (Aircraft | HangarAircraft)[], reg: string): boolean {
  const r = normalRegistration(reg);
  return hangar.some((a) => a.registration === r && ((a as HangarAircraft).access?.role ?? 'owner') === 'owner');
}

/** The message for a registration already in the hangar (also the server's 409). */
export function alreadyInHangar(reg: string): string {
  return `${normalRegistration(reg)} is already in your hangar.`;
}

/** The new aircraft from `source` with the registration, or why it cannot be added. */
export function newAircraftInput(
  hangar: (Aircraft | HangarAircraft)[],
  source: AddSource,
  registration: string,
): { input: AircraftInput; error: null } | { input: null; error: string } {
  const reg = normalRegistration(registration);
  if (!reg) return { input: null, error: 'Enter the registration.' };
  if (registrationTaken(hangar, reg)) return { input: null, error: alreadyInHangar(reg) };
  if (source.kind === 'copy') {
    const of = hangar.find((a) => a.id === source.id);
    if (!of) return { input: null, error: 'That aircraft is no longer in your hangar.' };
    return { input: sameTypeCopy(toInput(of), reg), error: null };
  }
  return {
    input: { ...buildFromTemplate(source.kind === 'template' ? source.id : null), registration: reg },
    error: null,
  };
}

/** A copy keeps the operator only when the pilot may assign it (owner or editor); else its name as
 *  text. `operator` is GET /api/operators/:id, null when it could not be read. */
export function keepsOperator(operator: { access: { role: string } } | null): boolean {
  return !!operator && operator.access.role !== 'view';
}

/** The toast after adding (the server makes it the default when the pilot had none). */
export function addedText(registration: string, becameDefault: boolean): string {
  return becameDefault ? `Added ${registration} as your default aircraft` : `Added ${registration}`;
}
