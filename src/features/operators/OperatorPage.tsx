// One operator: its details (name, contacts), whether it asks for the W&B and performance sheets
// before each flight and where they go, its documents (operations manual, PDFs), its aircraft, and
// who has access (shared directly, or through one of its aircraft). Viewers see it read-only.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loading } from '../../app/Loading';
import { Shell } from '../../app/Shell';
import { useSession } from '../../app/session';
import { useToast } from '../../app/toast';
import { useFocusParam } from '../../app/focusParam';
import { api, ApiRequestError } from '../../data/api';
import { operatorScope } from '../../data/aircraftFiles';
import { useAsync } from '../../data/useAsync';
import { isEmail, type OperatorInput, type OperatorItem, type OperatorSharing } from '../../shared';
import { ConfirmDialog, EmptyState, KebabMenu } from '../lobby/ui';
import { DocumentsSection } from '../hangar/AircraftFiles';
import { Check, Field, Section } from '../hangar/fields';
import { ROLE_LABEL, ShareDialog, SharedChip } from '../hangar/ShareDialog';
import '../hangar/hangar.css';
import '../hangar/share.css';
import '../lobby/lists.css';

const DOCS_TEXT = {
  title: 'Documents',
  intro: 'The operations manual and other PDFs of this operator, to read here. Everyone with access to the operator can read them.',
  empty: 'add the operations manual as a PDF below.',
  placeholder: 'Title, e.g. Operations manual',
};

const inputOf = ({ name, phone, email, address, aftn, notes, requiresWbPerf, declarationsEmail }: OperatorItem): OperatorInput =>
  ({ name, phone, email, address, aftn, notes, requiresWbPerf, declarationsEmail });

export function OperatorPage() {
  const { id = '' } = useParams();
  const { data, error, setData } = useAsync(() => api.operators.get(id), [id]);
  return (
    <Shell>
      {error ? (
        <EmptyState title="Operator not found" action={<Link to="/operators">All operators</Link>}>{error.message}</EmptyState>
      ) : !data ? <p><Loading /></p> : <OperatorEditor key={data.id} op={data} onSaved={setData} />}
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
  const [people, setPeople] = useState<OperatorSharing | null>(null);
  const role = op.access.role;
  const readOnly = role === 'view';
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useFocusParam(() => document.querySelector('[data-testid=operator-page]'));

  const loadPeople = () => api.operatorShares.get(op.id).then(setPeople, () => setPeople(null));
  useEffect(() => { void loadPeople(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.id]);

  const set = <K extends keyof OperatorInput>(k: K, v: OperatorInput[K]) => { setDraft((d) => ({ ...d, [k]: v })); setSaveError(null); };
  const problem = !draft.name.trim() ? 'Enter the operator’s name.'
    : draft.email.trim() && !isEmail(draft.email) ? 'The e-mail address is not valid.'
    : draft.requiresWbPerf && !isEmail(draft.declarationsEmail) ? 'Enter the e-mail address that receives the W&B and performance sheets.'
    : null;

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!dirty || busy) return;
    if (problem) { setSaveError(problem); return; }
    setBusy(true);
    try {
      const saved = await api.operators.update(op.id, { ...draft, name: draft.name.trim(), email: draft.email.trim(), declarationsEmail: draft.declarationsEmail.trim() });
      onSaved(saved);
      setDraft(inputOf(saved));
      toast(`Saved ${saved.name}`);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError && err.status === 0 ? 'You are offline. Your changes are still here; try again when back online.' : String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  };

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
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M11 3L5 9l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
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

      <form className="ac-main" onSubmit={save} noValidate>
        <fieldset className="ac-fieldset" disabled={readOnly}>
          <Section id="details" title="Details" intro="The operator’s name is printed as the operator on the General Declaration, the flight plan (OPR/) and the W&B sheet of its aircraft.">
            <div className="grid2">
              {text('name', 'Name', undefined, 'e.g. AEROCLUB MESOGEION')}
              {text('phone', 'Phone', 'Operations or the club office', '+30 …')}
            </div>
            <div className="grid2">
              {text('email', 'E-mail')}
              {text('aftn', 'AFTN or ATS contact', 'If it has one')}
            </div>
            {text('address', 'Address')}
            <Field label="Notes">
              <textarea name="notes" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} maxLength={5000} />
            </Field>
          </Section>
          <Section id="declarations" title="Before each flight" intro="Whether the operator wants the weight & balance and take-off/landing performance sheets of each flight. They are then sent from the W&B and performance export, to this address, with you in copy.">
            <Check checked={draft.requiresWbPerf} onChange={(v) => set('requiresWbPerf', v)}>
              <span data-testid="operator-requires">Requires the W&amp;B and performance sheets before each flight</span>
            </Check>
            {draft.requiresWbPerf && (
              <Field focus="declarationsEmail" label="Send them to" req hint="One e-mail address">
                <input name="declarationsEmail" type="email" value={draft.declarationsEmail} onChange={(e) => set('declarationsEmail', e.target.value)} maxLength={320} placeholder="ops@example.com" />
              </Field>
            )}
          </Section>
        </fieldset>

        <DocumentsSection scope={operatorScope(op.id)} canEdit={!readOnly} text={DOCS_TEXT} />

        <Section id="aircraft" title="Aircraft" intro="The aircraft assigned to this operator that you can see. Assign an aircraft on its page in the hangar.">
          {op.aircraft.length === 0 ? <p className="muted" style={{ margin: 0 }}>None.</p> : (
            <ul className="op-aircraft">{op.aircraft.map((a) => <li key={a.id}><Link to={`/hangar/${a.id}`} className="mono">{a.registration}</Link></li>)}</ul>
          )}
        </Section>

        <Section id="access" title="People with access" actions={<button type="button" className="sm" onClick={() => setSharing(true)}>Share</button>}
          intro="Shared directly, or seeing it through one of its aircraft (as viewers).">
          {!people ? <p className="muted" style={{ margin: 0 }}>Loading…</p> : (
            <ul className="share-people" data-testid="operator-people">
              {people.people.map((p) => (
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
            <span className="chip">View only</span>
            <span className="muted">{op.access.owner.name || op.access.owner.email} can change this operator, and so can its editors.</span>
          </div>
        ) : (
          <div className={'ac-savebar card' + (dirty ? ' dirty' : '')} role="region" aria-label="Save">
            {saveError ? <span className="form-error" role="alert">{saveError}</span> : <span className="muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>}
            <span className="spacer" />
            {dirty && <button type="button" className="ghost" onClick={() => { setDraft(baseline); setSaveError(null); }} disabled={busy}>Discard</button>}
            <button type="submit" className="primary" disabled={!dirty || busy} data-testid="operator-save">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </form>

      {sharing && (
        <ShareDialog kind="operator" id={op.id} name={op.name} onClose={() => { setSharing(false); void loadPeople(); }}
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
