// One operator: its details (name, contacts), whether it asks for the W&B and performance sheets
// before each flight and where they go, its documents (operations manual, PDFs), its aircraft, and
// who has access (shared directly, or through one of its aircraft). Viewers see it read-only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { useSession } from '../../app/session';
import { useToast } from '../../app/toast';
import { useFocusParam } from '../../app/focusParam';
import { api, ApiRequestError } from '../../data/api';
import { operatorScope } from '../../data/aircraftFiles';
import { useAsync } from '../../data/useAsync';
import { isEmail, type OperatorInput, type OperatorItem } from '../../shared';
import { errorMessage } from '../../shared/format';
import { Check, Chip, ConfirmDialog, EmptyState, Field, Icon, KebabMenu, Loading } from '../../ui';
import { DocumentsSection } from '../hangar/AircraftFiles';
import { Section } from '../hangar/fields';
import { ROLE_LABEL, ShareDialog, SharedChip } from '../hangar/ShareDialog';
import '../hangar/hangar.css';
import '../hangar/share.css';
import '../lobby/lists.css';

const DOCS_TEXT = {
  title: 'Documents',
  empty: 'No documents.',
  placeholder: 'Title, e.g. Operations manual',
};

const inputOf = ({ name, phone, email, address, aftn, notes, requiresWbPerf, declarationsEmail }: OperatorItem): OperatorInput =>
  ({ name, phone, email, address, aftn, notes, requiresWbPerf, declarationsEmail });

export function OperatorPage() {
  const { id = '' } = useParams();
  const { data, error, setData } = useAsync(() => api.operators.get(id), [id]);
  return (
    <Shell>
      {error && !data ? (
        <EmptyState title={error instanceof ApiRequestError && error.status === 404 ? 'Operator not found' : 'Could not load the operator'}
          action={<Link to="/operators" className="btn">All operators</Link>}>
          {error instanceof ApiRequestError && error.status === 404 ? 'It may have been deleted.' : error.message}
        </EmptyState>
      ) : !data ? <Loading /> : <OperatorEditor key={data.id} op={data} onSaved={setData} />}
    </Shell>
  );
}

function OperatorEditor({ op, onSaved }: { op: OperatorItem; onSaved: (o: OperatorItem) => void }) {
  const { pilot } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const baseline = useMemo(() => inputOf(op), [op]);
  const [draft, setDraft] = useState<OperatorInput>(baseline);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const role = op.access.role;
  const readOnly = role === 'view';
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useFocusParam(() => document.querySelector('[data-testid=operator-page]'));
  // who has access: refetched when a share of the operator or of one of its aircraft changes
  const people = useAsync(() => api.operatorShares.get(op.id), [op.id], { invalidatedBy: ['operators', 'aircraft'] });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof OperatorInput>(k: K, v: OperatorInput[K]) => { setDraft((d) => ({ ...d, [k]: v })); setSaveError(null); };
  const problem = !draft.name.trim() ? 'Enter the operator’s name.'
    : draft.email.trim() && !isEmail(draft.email) ? 'The e-mail address is not valid.'
    : draft.requiresWbPerf && !isEmail(draft.declarationsEmail) ? 'Enter the e-mail address that receives the W&B and performance sheets.'
    : null;

  const save = useCallback(async () => {
    if (!dirty || busy) return;
    if (problem) { setSaveError(problem); return; }
    setBusy(true);
    try {
      const saved = await api.operators.update(op.id, { ...draft, name: draft.name.trim(), email: draft.email.trim(), declarationsEmail: draft.declarationsEmail.trim() });
      onSaved(saved);
      setDraft(inputOf(saved));
      toast(`Saved ${saved.name}`);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError && err.status === 0 ? 'You are offline. Your changes are kept.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [dirty, busy, problem, op.id, draft, onSaved, toast]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [save]);

  const text = (k: 'name' | 'phone' | 'email' | 'address' | 'aftn', label: string, hint?: string, placeholder?: string) => (
    <Field focus={k} label={label} hint={hint} req={k === 'name'}>
      <input name={k} value={draft[k]} onChange={(e) => set(k, e.target.value)} maxLength={k === 'name' ? 200 : 320} placeholder={placeholder}
        type={k === 'email' ? 'email' : 'text'} />
    </Field>
  );

  return (
    <div className="ac-page op-page" data-testid="operator-page">
      <div className="page-head ac-head">
        <Link to="/operators" className="back" aria-label="Back to the operators" title="Operators">
          <Icon name="back" size={18} />
        </Link>
        <div>
          <h1>{draft.name || 'Operator'}</h1>
          <div className="muted">{op.aircraft.length ? op.aircraft.map((a) => a.registration).join(', ') : 'No aircraft'}</div>
        </div>
        <SharedChip access={op.access} />
        <span className="spacer" />
        <button type="button" onClick={() => setSharing(true)} data-testid="share-operator">Share</button>
        {role === 'owner' && <KebabMenu label="Operator actions" items={[{ label: 'Delete operator', onSelect: () => setDeleting(true), danger: true }]} />}
      </div>

      <form className="ac-main" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <fieldset className="ac-fieldset" disabled={readOnly}>
          <Section id="details" title="Details">
            <div className="grid2">
              {text('name', 'Name', 'Printed as the operator on the GenDec, FPL OPR/ and the W&B sheet', 'e.g. AEROCLUB MESOGEION')}
              {text('phone', 'Phone', undefined, '+30 …')}
            </div>
            <div className="grid2">
              {text('email', 'E-mail')}
              {text('aftn', 'AFTN or ATS contact')}
            </div>
            {text('address', 'Address')}
            <Field label="Notes">
              <textarea name="notes" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} maxLength={5000} />
            </Field>
          </Section>
          <Section id="declarations" title="Before each flight">
            <Check checked={draft.requiresWbPerf} onChange={(v) => set('requiresWbPerf', v)}>
              <span data-testid="operator-requires">Requires the W&amp;B and performance sheets before each flight</span>
            </Check>
            {draft.requiresWbPerf && (
              <Field focus="declarationsEmail" label="Send them to" req hint="Sent from the W&B and performance export, with you in copy">
                <input name="declarationsEmail" type="email" value={draft.declarationsEmail} onChange={(e) => set('declarationsEmail', e.target.value)} maxLength={320} placeholder="ops@example.com" />
              </Field>
            )}
          </Section>
        </fieldset>

        <DocumentsSection scope={operatorScope(op.id)} canEdit={!readOnly} text={DOCS_TEXT} />

        <Section id="aircraft" title="Aircraft">
          {op.aircraft.length === 0 ? <p className="muted" style={{ margin: 0 }}>None. Assign an aircraft on its page in the hangar.</p> : (
            <ul className="op-aircraft">{op.aircraft.map((a) => <li key={a.id}><Link to={`/hangar/${a.id}`} className="mono">{a.registration}</Link></li>)}</ul>
          )}
        </Section>

        <Section id="access" title="People with access" actions={<button type="button" className="sm" onClick={() => setSharing(true)}>Share</button>}>
          {!people.data ? (people.error ? <p className="form-error" role="alert">{errorMessage(people.error)}</p> : <Loading variant="sm" />) : (
            <ul className="share-people" data-testid="operator-people">
              {people.data.people.map((p) => (
                <li key={p.pilotId} data-role={p.role} data-direct={p.direct ? '1' : '0'}>
                  <span className="share-who">
                    <b>{p.name || p.email}{p.pilotId === pilot.id && <span className="muted"> (you)</span>}</b>
                    {p.name && <span className="hint">{p.email}</span>}
                  </span>
                  <span className="muted share-role">{ROLE_LABEL[p.role]}{!p.direct && p.via.length ? ` · through ${p.via.join(', ')}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {readOnly ? (
          <div className="ac-viewonly card">
            <Chip>View only</Chip>
            <span className="muted">Shared by {op.access.owner.name || op.access.owner.email}</span>
          </div>
        ) : (
          <div className={'ac-savebar card' + (dirty ? ' dirty' : '')} role="region" aria-label="Save">
            {saveError ? <span className="form-error" role="alert">{saveError}</span> : <span className="muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>}
            <span className="spacer" />
            {dirty && <button type="button" className="ghost" onClick={() => { setDraft(baseline); setSaveError(null); }} disabled={busy}>Discard</button>}
            <button type="submit" className="primary" disabled={!dirty || busy} title="Save (Ctrl+S)" data-testid="operator-save">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </form>

      {sharing && (
        <ShareDialog kind="operator" id={op.id} name={op.name} onClose={() => setSharing(false)}
          onLeft={() => { toast(`You no longer have ${op.name}`); navigate('/operators'); }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${op.name}?`} confirmLabel="Delete" onClose={() => setDeleting(false)}
          onConfirm={async () => { await api.operators.remove(op.id); toast(`Deleted ${op.name}`); navigate('/operators'); }}>
          Its details and documents are removed. Its aircraft keep “{op.name}” as their operator’s name, without the link.
        </ConfirmDialog>
      )}
    </div>
  );
}
