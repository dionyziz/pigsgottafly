// Modal dialog, its standard footer, and a confirmation dialog.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Modal dialog. Escape or a click on the backdrop closes it (unless `busy`). */
export function Dialog({ title, onClose, children, footer, busy, wide, testId }: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  wide?: boolean;
  testId?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, busy]);
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('.dlg-body input, .dlg-body select, .dlg-body textarea, button');
    first?.focus();
  }, []);
  return (
    <div className="dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={'dlg card' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id} ref={box} data-testid={testId}>
        <div className="dlg-head"><h2 id={id}>{title}</h2></div>
        {children != null && children !== false && <div className="dlg-body">{children}</div>}
        {footer && <div className="dlg-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface DialogAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  autoFocus?: boolean;
}

/**
 * The footer of a form dialog: the danger action (Delete) on the left, the error message, then
 * Cancel and the primary action on the right. Put it in <Dialog footer={…}>.
 */
export function DialogFooter({ error, onCancel, cancelLabel = 'Cancel', primary, danger, busy }: {
  error?: ReactNode;
  onCancel: () => void;
  cancelLabel?: string;
  primary?: DialogAction & { danger?: boolean };
  danger?: DialogAction;
  busy?: boolean;
}) {
  return (
    <>
      {danger && (
        <button type="button" className="ghost danger" onClick={danger.onClick} disabled={busy || danger.disabled} data-testid={danger.testId}>{danger.label}</button>
      )}
      <span className="dlg-msg">{error ? <span className="form-error" role="alert">{error}</span> : null}</span>
      <button type="button" className="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
      {primary && (
        <button type="button" className={'primary' + (primary.danger ? ' danger-fill' : '')} onClick={primary.onClick} disabled={busy || primary.disabled}
          data-testid={primary.testId} data-autofocus={primary.autoFocus || undefined}>{primary.label}</button>
      )}
    </>
  );
}

/** Confirmation for a destructive action. The body is optional: a title alone is enough. */
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose, danger = true, testId }: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  /** The confirm button is red (default). */
  danger?: boolean;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try { await onConfirm(); onClose(); } catch (e) { setError(String((e as Error).message || e)); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={onClose} busy={busy} testId={testId}
      footer={<DialogFooter onCancel={onClose} busy={busy} error={error} primary={{ label: confirmLabel, onClick: () => void go(), danger, autoFocus: true }} />}>
      {children ? <div className="muted">{children}</div> : null}
    </Dialog>
  );
}
