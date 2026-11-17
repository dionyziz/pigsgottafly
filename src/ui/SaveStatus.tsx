// The status of an autosave (useAutosave) beside a page title or in a dialog footer: "Saving…",
// "Saved", or "Not saved" (invalid fields or a failed save; the form says why). <AutosaveFooter> is
// the footer of a dialog that edits an existing record: Delete, the status, Done.
import { errorMessage } from '../shared/format';
import { type DialogAction, DialogFooter } from './Dialog';
import type { Autosave, AutosaveStatus } from './useAutosave';

export function SaveStatus({ status, blocked }: { status: AutosaveStatus; blocked: boolean }) {
  const [text, cls] =
    blocked || status === 'failed'
      ? ['Not saved', 'danger-text']
      : status === 'pending' || status === 'saving'
        ? ['Saving…', 'muted']
        : status === 'saved'
          ? ['Saved', 'muted']
          : ['', ''];
  return (
    <span
      className={'save-status ' + cls}
      data-testid="save-status"
      data-status={blocked ? 'blocked' : status}
      aria-live="polite"
    >
      {text}
    </span>
  );
}

export function AutosaveFooter({
  autosave,
  blocked,
  onDone,
  danger,
}: {
  autosave: Autosave;
  blocked: boolean;
  /** Done: save what is pending and close. */
  onDone: () => void;
  danger?: DialogAction;
}) {
  return (
    <DialogFooter
      danger={danger}
      status={<SaveStatus status={autosave.status} blocked={blocked} />}
      error={autosave.status === 'failed' ? `Not saved: ${errorMessage(autosave.error)}` : null}
      primary={{ label: 'Done', onClick: onDone, testId: 'dialog-done' }}
    />
  );
}
