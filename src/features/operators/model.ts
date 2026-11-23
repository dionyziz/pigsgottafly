// The operator pages' rules apart from React: the editable fields, what holds a save back, how the
// page, its people and the list read. The iPhone app's core wraps these (src/native/core/operators.ts),
// so its operator editor checks and shows the same.
import { EMPTY_OPERATOR, isEmail, type OperatorInput, type OperatorItem, type OperatorPerson } from '../../shared';
import { ROLE_LABEL, sharedBy } from '../hangar/shareModel';
import type { FormIssue } from '../passengers/formIssues';

export type OperatorField = 'name' | 'email' | 'declarationsEmail' | 'fplCopyEmail';

/** The editable part of an operator (the body of PUT /api/operators/:id). */
export const operatorInputOf = ({
  name,
  phone,
  email,
  address,
  aftn,
  notes,
  requiresWbPerf,
  declarationsEmail,
  requiresFplCopy,
  fplCopyEmail,
}: OperatorInput): OperatorInput => ({
  name,
  phone,
  email,
  address,
  aftn,
  notes,
  requiresWbPerf,
  declarationsEmail,
  requiresFplCopy,
  fplCopyEmail,
});

/** What holds the save back, field by field (empty: it can be saved). */
export function validateOperator(d: OperatorInput): FormIssue<OperatorField>[] {
  const out: FormIssue<OperatorField>[] = [];
  if (!d.name.trim()) out.push({ field: 'name', message: 'Enter the operator’s name' });
  if (d.email.trim() && !isEmail(d.email)) out.push({ field: 'email', message: 'Not an e-mail address' });
  if (d.requiresWbPerf)
    if (!d.declarationsEmail.trim()) out.push({ field: 'declarationsEmail', message: 'Enter the e-mail address' });
    else if (!isEmail(d.declarationsEmail)) out.push({ field: 'declarationsEmail', message: 'Not an e-mail address' });
  if (d.requiresFplCopy)
    if (!d.fplCopyEmail.trim()) out.push({ field: 'fplCopyEmail', message: 'Enter the e-mail address' });
    else if (!isEmail(d.fplCopyEmail)) out.push({ field: 'fplCopyEmail', message: 'Not an e-mail address' });
  return out;
}

/** What is saved: the name and the addresses trimmed. */
export const normalizedOperator = (d: OperatorInput): OperatorInput => ({
  ...d,
  name: d.name.trim(),
  email: d.email.trim(),
  declarationsEmail: d.declarationsEmail.trim(),
  fplCopyEmail: d.fplCopyEmail.trim(),
});

/** New operator: the name is all it asks; the body of POST /api/operators, or why not yet. */
export function newOperatorInput(name: string): { input: OperatorInput; error: null } | { input: null; error: string } {
  return name.trim()
    ? { input: { ...EMPTY_OPERATOR, name: name.trim() }, error: null }
    : { input: null, error: 'Enter the operator’s name.' };
}

/** The page's head and what it offers the pilot. */
export function operatorHead(op: Pick<OperatorItem, 'name' | 'access' | 'aircraft'>) {
  const by = op.access.owner.name || op.access.owner.email;
  return {
    subtitle: op.aircraft.length ? op.aircraft.map((a) => a.registration).join(', ') : 'No aircraft',
    chip: sharedBy(op.access),
    readOnly: op.access.role === 'view',
    canDelete: op.access.role === 'owner',
    viewOnly: op.access.role === 'view' ? `Shared by ${by}` : null,
    deleteTitle: `Delete ${op.name}?`,
    deleteMessage: 'Its details and documents are deleted.',
    deleted: `Deleted ${op.name}`,
    left: `You no longer have ${op.name}`,
  };
}

/** "People with access" on the page: the name (and the address under it), the role, and the
 *  aircraft that give someone access when it is not a direct share. */
export function operatorPeople(people: OperatorPerson[], myId: string) {
  return people.map((p) => ({
    key: p.pilotId,
    name: p.name || p.email,
    email: p.name ? p.email : '',
    self: p.pilotId === myId,
    role: p.role,
    direct: p.direct,
    label: `${ROLE_LABEL[p.role]}${!p.direct && p.via.length ? ` · through ${p.via.join(', ')}` : ''}`,
  }));
}

/** A row of the operators list. */
export function operatorRow(o: OperatorItem) {
  return {
    id: o.id,
    name: o.name,
    chip: sharedBy(o.access)?.text ?? null,
    through:
      o.access.role === 'view' && o.access.viaAircraft.length > 0 ? `Through ${o.access.viaAircraft.join(', ')}` : '',
    aircraft: o.aircraft.map((a) => a.registration).join(', '),
    contact: [o.phone, o.email].filter(Boolean).join(' · '),
    flags: [
      ...(o.requiresWbPerf
        ? [{ label: 'W&B + performance', title: `W&B and performance to ${o.declarationsEmail} before each flight` }]
        : []),
      ...(o.requiresFplCopy
        ? [{ label: 'Flight plan copy', title: `A copy of each filed flight plan to ${o.fplCopyEmail}` }]
        : []),
    ],
  };
}
