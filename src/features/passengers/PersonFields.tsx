// The one person editor: a passenger's details, or the pilot's (licence number instead of notes,
// phone required). Used by the passenger dialog, the pilot's details dialog and the profile page.
// Renders fields only; the caller owns the <form>. Problems show under their field.
import { DateField, Field, NumberField } from '../../ui';
import { type PersonField, type PersonForm, WEIGHT_MAX_KG, WEIGHT_MIN_KG } from './person';

export type SetPerson = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => void;

export function PersonFields({
  f,
  set,
  issues,
  pilot = false,
  minimal = false,
  autoFocus = false,
}: {
  f: PersonForm;
  set: SetPerson;
  /** The messages of a field. */
  issues: (field: PersonField) => string[];
  pilot?: boolean;
  /** Name and phone only (first use). */
  minimal?: boolean;
  /** Focus the name when shown. */
  autoFocus?: boolean;
}) {
  const text = (k: 'fullName' | 'phone' | 'email' | 'nationality' | 'idNumber' | 'licenceNo') => ({
    name: k,
    value: f[k] ?? '',
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });
  return (
    <>
      <div className="grid2">
        <Field label="Full name" req issues={issues('fullName')}>
          <input
            {...text('fullName')}
            required
            autoComplete={pilot ? 'name' : 'off'}
            data-autofocus={autoFocus || undefined}
            autoFocus={autoFocus}
            placeholder={pilot ? 'As on your licence' : 'As on their ID'}
          />
        </Field>
        <Field label="Phone" req={pilot} issues={issues('phone')}>
          <input {...text('phone')} type="tel" autoComplete={pilot ? 'tel' : 'off'} placeholder="+30 …" />
        </Field>
      </div>
      {!pilot && (
        <Field label="E-mail" req issues={issues('email')}>
          <input {...text('email')} type="email" required autoComplete="off" />
        </Field>
      )}
      {!minimal && (
        <>
          <div className="grid3">
            <Field label="Date of birth" issues={issues('dateOfBirth')}>
              <DateField name="dateOfBirth" value={f.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} />
            </Field>
            <Field label="Weight" issues={issues('weightKg')}>
              <NumberField
                name="weightKg"
                value={f.weightKg}
                onChange={(v) => set('weightKg', v)}
                min={WEIGHT_MIN_KG}
                max={WEIGHT_MAX_KG}
                unit="kg"
              />
            </Field>
            <Field label="Nationality" issues={issues('nationality')}>
              <input {...text('nationality')} placeholder="e.g., GREEK" />
            </Field>
          </div>
          <div className="grid2">
            <Field label="ID / passport number" issues={issues('idNumber')}>
              <input {...text('idNumber')} placeholder="e.g., AK 123456" />
            </Field>
            {pilot && (
              <Field label="Licence number" issues={issues('licenceNo')}>
                <input {...text('licenceNo')} placeholder="e.g., EL.FCL.6094" />
              </Field>
            )}
          </div>
          {!pilot && (
            <Field label="Notes" issues={issues('notes')}>
              <textarea name="notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          )}
        </>
      )}
    </>
  );
}
