// Lists the operators the pilot may assign (owner or editor; the current one even when only viewed). An
// aircraft without a linked operator keeps its old free-text operator, shown as such.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';

import { api } from '../../data/api';
import { useEntity } from '../../data/entities';
import type { AircraftInput, OperatorItem } from '../../shared';
import { errorMessage } from '../../shared/format';
import { Dialog, DialogFooter, Field } from '../../ui';
import { newOperatorInput } from './model';

const NEW = '__new__';

export function OperatorPicker({
  a,
  edit,
  disabled,
}: {
  a: AircraftInput;
  edit: (fn: (d: AircraftInput) => void) => void;
  disabled?: boolean;
}) {
  const { data, error } = useEntity('operators');
  const list = data ?? (error ? [] : null);
  const [creating, setCreating] = useState(false);
  const choices = (list ?? []).filter((o) => o.access.role !== 'view' || o.id === a.operatorId);
  const choose = (o: OperatorItem | null) =>
    edit((d) => {
      d.operatorId = o?.id ?? null;
      if (o) d.operator = o.name;
    });
  const current = (list ?? []).find((o) => o.id === a.operatorId);
  return (
    <div className="op-picker">
      <div className="row">
        <select
          name="operator"
          value={a.operatorId ?? ''}
          disabled={disabled || !list}
          data-testid="aircraft-operator"
          aria-label="Operator"
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW) {
              setCreating(true);
              return;
            }
            choose(choices.find((o) => o.id === v) ?? null);
          }}
        >
          <option value="">{a.operator.trim() && !a.operatorId ? `${a.operator} (name only)` : 'None'}</option>
          {a.operatorId && !current && <option value={a.operatorId}>{a.operator || 'Operator'}</option>}
          {choices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value={NEW}>New operator…</option>
        </select>
        {a.operatorId && (
          <Link to={`/operators/${a.operatorId}`} className="op-open">
            Open
          </Link>
        )}
      </div>
      {/* a portal: the picker sits inside the field's <label>, which would take the dialog's clicks */}
      {creating &&
        createPortal(
          <NewOperatorDialog
            initialName={!a.operatorId ? a.operator.trim() : ''}
            onClose={() => setCreating(false)}
            onCreated={(o) => {
              choose(o);
              setCreating(false);
            }}
          />,
          document.body,
        )}
    </div>
  );
}

export function NewOperatorDialog({
  initialName = '',
  onClose,
  onCreated,
}: {
  initialName?: string;
  onClose: () => void;
  onCreated: (o: OperatorItem) => void;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const made = newOperatorInput(name);
    if (made.error !== null) {
      setError(made.error);
      return;
    }
    setBusy(true);
    try {
      onCreated(await api.operators.create(made.input));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="New operator"
      onClose={onClose}
      busy={busy}
      testId="new-operator-dialog"
      footer={
        <DialogFooter
          error={error}
          onCancel={onClose}
          busy={busy}
          primary={{ label: 'Create', onClick: () => void submit(), testId: 'new-operator-create' }}
        />
      }
    >
      <form onSubmit={submit} className="stack" noValidate>
        <Field label="Name" req>
          <input
            name="operatorName"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            data-autofocus
            maxLength={200}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
