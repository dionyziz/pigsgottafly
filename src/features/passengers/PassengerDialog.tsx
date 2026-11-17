// Add/edit a passenger in a dialog. Exported for reuse: the editor's manifest can create a passenger
// on the spot with <PassengerDialog passenger={null} initialName="…" onSaved={…} />.
// The pilot is a passenger too: <PilotDetailsDialog /> edits the pilot's own person details (plus the
// licence number) with the same form, saved to the profile (PUT /api/me).
import { useRef, useState } from 'react';

import { useSession } from '../../app/session';
import { api } from '../../data/api';
import type { Passenger, PassengerInput, Pilot } from '../../shared';
import { errorMessage } from '../../shared/format';
import { Dialog, DialogFooter, useHighlightFields } from '../../ui';
import { useFormIssues } from './formIssues';
import { type PersonField, type PersonForm, personForm, personInput, validatePerson } from './person';
import { PersonFields, type SetPerson } from './PersonFields';

/** The dialog's form state, its field problems and the fields a link asked to highlight. */
function usePersonDialog(initial: () => PersonForm, focus: readonly string[]) {
  const ref = useRef<HTMLFormElement>(null);
  const [f, setF] = useState<PersonForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = useFormIssues<PersonField>(ref);
  useHighlightFields(ref, focus);
  const set: SetPerson = (k, v) => {
    setF((x) => ({ ...x, [k]: v }));
    issues.clear(k as PersonField);
  };
  return { ref, f, set, busy, setBusy, error, setError, issues };
}

export function PassengerDialog({
  passenger,
  initialName,
  onClose,
  onSaved,
  onDelete,
  focus = [],
}: {
  /** Inputs to highlight and focus (names), from a missing-details link. */
  focus?: string[];
  /** Offers "Delete" for an existing passenger (the caller confirms and deletes). */
  onDelete?: (p: Passenger) => void;
  passenger: Passenger | null;
  initialName?: string;
  onClose: () => void;
  onSaved: (p: Passenger, created: boolean) => void;
}) {
  const d = usePersonDialog(() => personForm(passenger, initialName), focus);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!d.issues.check(validatePerson(d.f))) return;
    const input: PassengerInput = personInput(d.f);
    d.setBusy(true);
    d.setError(null);
    try {
      const p = passenger ? await api.passengers.update(passenger.id, input) : await api.passengers.create(input);
      onSaved(p, !passenger);
    } catch (err) {
      d.setError(errorMessage(err));
      d.setBusy(false);
    }
  };

  return (
    <Dialog
      title={passenger ? 'Edit passenger' : 'New passenger'}
      onClose={onClose}
      busy={d.busy}
      wide
      testId="passenger-dialog"
      footer={
        <DialogFooter
          onCancel={onClose}
          busy={d.busy}
          error={d.error}
          primary={{ label: passenger ? 'Save' : 'Add passenger', onClick: () => void submit() }}
          danger={
            passenger && onDelete
              ? { label: 'Delete', onClick: () => onDelete(passenger), testId: 'passenger-delete' }
              : undefined
          }
        />
      }
    >
      <form className="stack" onSubmit={submit} ref={d.ref} noValidate>
        <PersonFields f={d.f} set={d.set} issues={d.issues.of} autoFocus={!focus.length} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** The pilot's own person details (as on the forms and for W&B), edited like a passenger's. */
export function PilotDetailsDialog({
  onClose,
  onSaved,
  focus = [],
}: {
  onClose: () => void;
  onSaved?: (p: Pilot) => void;
  focus?: string[];
}) {
  const { pilot } = useSession();
  const d = usePersonDialog(() => personForm(pilot), focus);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!d.issues.check(validatePerson(d.f, { pilot: true }))) return;
    const { notes: _notes, email: _email, ...person } = personInput(d.f);
    d.setBusy(true);
    d.setError(null);
    try {
      // api.me.update stores the pilot for every page and tab.
      const p = await api.me.update({ ...person, licenceNo: (d.f.licenceNo ?? '').trim() });
      onSaved?.(p);
    } catch (err) {
      d.setError(errorMessage(err));
      d.setBusy(false);
    }
  };

  return (
    <Dialog
      title="Your details"
      onClose={onClose}
      busy={d.busy}
      wide
      testId="pilot-dialog"
      footer={
        <DialogFooter
          onCancel={onClose}
          busy={d.busy}
          error={d.error}
          primary={{ label: 'Save', onClick: () => void submit() }}
        />
      }
    >
      <form className="stack" onSubmit={submit} ref={d.ref} noValidate>
        <PersonFields f={d.f} set={d.set} issues={d.issues.of} pilot autoFocus={!focus.length} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
