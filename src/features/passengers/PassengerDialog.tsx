// Add/edit a passenger in a dialog. Exported for reuse: the editor's manifest can create a passenger
// on the spot with <PassengerDialog passenger={null} initialName="…" onSaved={…} />.
// The pilot is a passenger too: <PilotDetailsDialog /> edits the pilot's own person details (plus the
// licence number) with the same form, saved to the profile (PUT /api/me).
// A new passenger is added with "Add passenger"; an existing one (and the pilot) saves on its own as
// it is edited (useAutosave; onSaved after each save), invalid fields hold the save back and say why
// under themselves, and Done closes once everything is saved.
import { useCallback, useRef, useState } from 'react';

import { useSession } from '../../app/session';
import { api, keepalivePut } from '../../data/api';
import type { Passenger, PassengerInput, Pilot } from '../../shared';
import { errorMessage } from '../../shared/format';
import { AutosaveFooter, Dialog, DialogFooter, useAutosave, useHighlightFields } from '../../ui';
import { type FormIssue, useFormIssues } from './formIssues';
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

/**
 * Autosave of an existing person: the live problems (shown under their fields), the save status and
 * Done (focuses the first problem, else waits for the save and closes).
 */
function usePersonAutosave(
  f: PersonForm,
  live: FormIssue<PersonField>[],
  save: (f: PersonForm) => Promise<void>,
  keepalive: (f: PersonForm) => void,
  issues: { check: (x: FormIssue<PersonField>[]) => boolean },
  onClose: () => void,
) {
  const autosave = useAutosave({ value: f, enabled: live.length === 0, save, keepalive });
  const blocked = autosave.dirty && live.length > 0;
  const of = (k: PersonField) => live.filter((i) => i.field === k).map((i) => i.message);
  const done = async () => {
    if (blocked) {
      issues.check(live);
      return;
    }
    if (await autosave.settle()) onClose();
  };
  return { autosave, blocked, of, done };
}

export function PassengerDialog(props: {
  /** Inputs to highlight and focus (names), from a missing-details link. */
  focus?: string[];
  /** Offers "Delete" for an existing passenger (the caller confirms and deletes). */
  onDelete?: (p: Passenger) => void;
  passenger: Passenger | null;
  initialName?: string;
  onClose: () => void;
  /** After adding (created) and after each save of an existing passenger. */
  onSaved: (p: Passenger, created: boolean) => void;
}) {
  return props.passenger ? (
    <EditPassengerDialog {...props} passenger={props.passenger} />
  ) : (
    <NewPassengerDialog {...props} />
  );
}

function NewPassengerDialog({
  initialName,
  onClose,
  onSaved,
  focus = [],
}: {
  focus?: string[];
  initialName?: string;
  onClose: () => void;
  onSaved: (p: Passenger, created: boolean) => void;
}) {
  const d = usePersonDialog(() => personForm(null, initialName), focus);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!d.issues.check(validatePerson(d.f))) return;
    const input: PassengerInput = personInput(d.f);
    d.setBusy(true);
    d.setError(null);
    try {
      onSaved(await api.passengers.create(input), true);
    } catch (err) {
      d.setError(errorMessage(err));
      d.setBusy(false);
    }
  };

  return (
    <Dialog
      title="New passenger"
      onClose={onClose}
      busy={d.busy}
      wide
      testId="passenger-dialog"
      footer={
        <DialogFooter
          onCancel={onClose}
          busy={d.busy}
          error={d.error}
          primary={{ label: 'Add passenger', onClick: () => void submit() }}
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

function EditPassengerDialog({
  passenger,
  onClose,
  onSaved,
  onDelete,
  focus = [],
}: {
  focus?: string[];
  onDelete?: (p: Passenger) => void;
  passenger: Passenger;
  onClose: () => void;
  onSaved: (p: Passenger, created: boolean) => void;
}) {
  const d = usePersonDialog(() => personForm(passenger), focus);
  const save = useCallback(
    async (f: PersonForm) => onSaved(await api.passengers.update(passenger.id, personInput(f)), false),
    [passenger.id, onSaved],
  );
  const a = usePersonAutosave(
    d.f,
    validatePerson(d.f),
    save,
    (f) => keepalivePut(`passengers/${encodeURIComponent(passenger.id)}`, personInput(f)),
    d.issues,
    onClose,
  );

  return (
    <Dialog
      title="Edit passenger"
      onClose={onClose}
      wide
      testId="passenger-dialog"
      footer={
        <AutosaveFooter
          autosave={a.autosave}
          blocked={a.blocked}
          onDone={() => void a.done()}
          danger={
            onDelete ? { label: 'Delete', onClick: () => onDelete(passenger), testId: 'passenger-delete' } : undefined
          }
        />
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void a.done();
        }}
        onBlur={() => a.autosave.flush()}
        ref={d.ref}
        noValidate
      >
        <PersonFields f={d.f} set={d.set} issues={a.of} autoFocus={!focus.length} />
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
  /** After each save. */
  onSaved?: (p: Pilot) => void;
  focus?: string[];
}) {
  const { pilot } = useSession();
  const d = usePersonDialog(() => personForm(pilot), focus);
  const update = (f: PersonForm) => {
    const { notes: _notes, email: _email, ...person } = personInput(f);
    return { ...person, licenceNo: (f.licenceNo ?? '').trim() };
  };
  const save = async (f: PersonForm) => {
    // api.me.update stores the pilot for every page and tab.
    const p = await api.me.update(update(f));
    onSaved?.(p);
  };
  const a = usePersonAutosave(
    d.f,
    validatePerson(d.f, { pilot: true }),
    save,
    (f) => keepalivePut('me', update(f)),
    d.issues,
    onClose,
  );

  return (
    <Dialog
      title="Your details"
      onClose={onClose}
      wide
      testId="pilot-dialog"
      footer={<AutosaveFooter autosave={a.autosave} blocked={a.blocked} onDone={() => void a.done()} />}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void a.done();
        }}
        onBlur={() => a.autosave.flush()}
        ref={d.ref}
        noValidate
      >
        <PersonFields f={d.f} set={d.set} issues={a.of} pilot autoFocus={!focus.length} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
