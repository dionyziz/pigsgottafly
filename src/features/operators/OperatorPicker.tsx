// The aircraft page's operator field: a dropdown of the operators the pilot may assign (owner or
// editor; the current one even when only viewed), "None", and "New operator…" (created on the spot
// and selected). Choosing one sets the aircraft's operatorId and its operator text to the name; an
// aircraft without a linked operator keeps its old free-text operator, shown as such.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../../data/api';
import { EMPTY_OPERATOR, type AircraftInput, type OperatorItem } from '../../shared';
import { Dialog } from '../lobby/ui';

const NEW = '__new__';

export function OperatorPicker({ a, edit, disabled }: { a: AircraftInput; edit: (fn: (d: AircraftInput) => void) => void; disabled?: boolean }) {
  const [list, setList] = useState<OperatorItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let live = true;
    api.operators.list().then((l) => { if (live) setList(l); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, []);
  const choices = (list ?? []).filter((o) => o.access.role !== 'view' || o.id === a.operatorId);
  const choose = (o: OperatorItem | null) => edit((d) => { d.operatorId = o?.id ?? null; if (o) d.operator = o.name; });
  const current = (list ?? []).find((o) => o.id === a.operatorId);
  return (
    <div className="op-picker">
      <div className="row">
        <select value={a.operatorId ?? ''} disabled={disabled || !list} data-testid="aircraft-operator" aria-label="Operator"
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW) { setCreating(true); return; }
            choose(choices.find((o) => o.id === v) ?? null);
          }}>
          <option value="">{a.operator.trim() && !a.operatorId ? `${a.operator} (name only)` : 'None'}</option>
          {a.operatorId && !current && <option value={a.operatorId}>{a.operator || 'Operator'}</option>}
          {choices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value={NEW}>New operator…</option>
        </select>
        {a.operatorId && <Link to={`/operators/${a.operatorId}`} className="op-open">Open</Link>}
      </div>
      {/* a portal: the picker sits inside the field's <label>, which would take the dialog's clicks */}
      {creating && createPortal(
        <NewOperatorDialog initialName={!a.operatorId ? a.operator.trim() : ''} onClose={() => setCreating(false)}
          onCreated={(o) => { setList((l) => [...(l ?? []), o].sort((x, y) => x.name.localeCompare(y.name))); choose(o); setCreating(false); }} />,
        document.body,
      )}
    </div>
  );
}

/** Creates an operator by name (the rest on its page). */
export function NewOperatorDialog({ initialName = '', onClose, onCreated }: { initialName?: string; onClose: () => void; onCreated: (o: OperatorItem) => void }) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) { setError('Enter the operator’s name.'); return; }
    setBusy(true);
    try {
      onCreated(await api.operators.create({ ...EMPTY_OPERATOR, name: name.trim() }));
    } catch (err) {
      setError(String((err as Error).message || err));
      setBusy(false);
    }
  };
  return (
    <Dialog title="New operator" onClose={onClose} busy={busy} testId="new-operator-dialog" footer={<>
      {error && <p className="form-error" role="alert" style={{ marginRight: 'auto', alignSelf: 'center' }}>{error}</p>}
      <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="primary" onClick={() => void submit()} disabled={busy} data-testid="new-operator-create">Create</button>
    </>}>
      <form onSubmit={submit} className="stack">
        <label className="field">Name<input name="operatorName" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} data-autofocus maxLength={200} placeholder="e.g. the club or the owner" /></label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
