// The person form shared by the passenger dialog, the pilot's details dialog and the profile: its
// state, its checks (one message per field) and the API input it becomes. Pure, for tests.
import { EMPTY_PERSON, type PassengerInput, type PersonDetails } from '../../shared';
import { isIsoDate, localToday } from '../../shared/date';
import type { FormIssue } from './formIssues';

export interface PersonForm {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  weightKg: number | null;
  idType: '' | 'ID' | 'PASSPORT';
  idNumber: string;
  nationality: string;
  relation: string;
  notes: string;
  /** Pilot only. */
  licenceNo?: string;
}

export type PersonField =
  'fullName' | 'phone' | 'dateOfBirth' | 'weightKg' | 'nationality' | 'idNumber' | 'licenceNo' | 'notes';

export const WEIGHT_MIN_KG = 1;
export const WEIGHT_MAX_KG = 300;

export function personForm(
  p: (PersonDetails & { notes?: string; licenceNo?: string }) | null,
  initialName = '',
): PersonForm {
  const b = p ?? EMPTY_PERSON;
  return {
    fullName: p ? b.fullName : initialName,
    phone: b.phone,
    dateOfBirth: b.dateOfBirth ?? '',
    weightKg: b.weightKg,
    idType: b.idType,
    idNumber: b.idNumber,
    nationality: b.nationality,
    relation: b.relation,
    notes: p?.notes ?? '',
    ...(p?.licenceNo != null ? { licenceNo: p.licenceNo } : {}),
  };
}

/** What is wrong with the form, field by field (empty when it can be saved). The pilot needs a phone. */
export function validatePerson(
  f: PersonForm,
  { pilot = false, today = localToday() }: { pilot?: boolean; today?: string } = {},
): FormIssue<PersonField>[] {
  const out: FormIssue<PersonField>[] = [];
  if (!f.fullName.trim()) out.push({ field: 'fullName', message: 'Enter the full name' });
  if (pilot && !f.phone.trim()) out.push({ field: 'phone', message: 'Enter your phone number' });
  if (f.dateOfBirth) {
    if (!isIsoDate(f.dateOfBirth)) out.push({ field: 'dateOfBirth', message: 'Not a valid date' });
    else if (f.dateOfBirth > today) out.push({ field: 'dateOfBirth', message: 'Date of birth is in the future' });
  }
  if (f.weightKg != null && (!isFinite(f.weightKg) || f.weightKg < WEIGHT_MIN_KG || f.weightKg > WEIGHT_MAX_KG)) {
    out.push({ field: 'weightKg', message: `Weight must be ${WEIGHT_MIN_KG}–${WEIGHT_MAX_KG} kg` });
  }
  return out;
}

/** Form → API input, normalised (call validatePerson first). */
export function personInput(f: PersonForm): PassengerInput {
  return {
    fullName: f.fullName.trim().replace(/\s+/g, ' '),
    phone: f.phone.trim(),
    dateOfBirth: f.dateOfBirth || null,
    weightKg: f.weightKg,
    idType: f.idType,
    idNumber: f.idNumber.trim(),
    nationality: f.nationality.trim().toUpperCase(),
    relation: f.relation.trim(),
    notes: f.notes.trim(),
  };
}

/** Form → API input; throws the first problem's message. */
export function passengerInputOf(f: PersonForm, opts?: { pilot?: boolean }): PassengerInput {
  const [first] = validatePerson(f, opts);
  if (first) throw new Error(first.message);
  return personInput(f);
}

/** Old name of personForm(). */
export const passengerForm = personForm;
