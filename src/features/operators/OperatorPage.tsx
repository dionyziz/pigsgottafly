// Edits save on their own as on the aircraft page (useAutosave: PUT /api/operators/:id, debounced; on
// blur, Ctrl+S and leaving); invalid fields hold the save back.
import '../hangar/hangar.css';
import '../hangar/share.css';
import '../lobby/lists.css';

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useFocusParam } from '../../app/focusParam';
import { useSession } from '../../app/session';
import { Shell } from '../../app/Shell';
import { usePageTitle } from '../../app/title';
import { useToast } from '../../app/toast';
import { operatorScope } from '../../data/aircraftFiles';
import { api, ApiRequestError, keepalivePut } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { OperatorInput, OperatorItem } from '../../shared';
import { errorMessage } from '../../shared/format';
import {
  Check,
  Chip,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  KebabMenu,
  Loading,
  SaveStatus,
  useAutosave,
} from '../../ui';
import { DocumentsSection } from '../hangar/AircraftFiles';
import { Section } from '../hangar/fields';
import { SharedChip, ShareDialog } from '../hangar/ShareDialog';
import {
  normalizedOperator,
  type OperatorField,
  operatorHead,
  operatorInputOf,
  operatorPeople,
  validateOperator,
} from './model';

const DOCS_TEXT = {
  title: 'Documents',
  empty: 'No documents.',
  placeholder: 'Title, e.g., Operations manual',
};

export function OperatorPage() {
  const { id = '' } = useParams();
  const { data, error, setData } = useAsync(() => api.operators.get(id), [id], { cache: `operator:${id}` });
  usePageTitle(data?.name);
  return (
    <Shell>
      {error && !data ? (
        <EmptyState
          title={
            error instanceof ApiRequestError && error.status === 404
              ? 'Operator not found'
              : 'Could not load the operator'
          }
          action={
            <Link to="/operators" className="btn">
              All operators
            </Link>
          }
        >
          {error instanceof ApiRequestError && error.status === 404 ? 'It may have been deleted.' : error.message}
        </EmptyState>
      ) : !data ? (
        <Loading />
      ) : (
        <OperatorEditor key={data.id} op={data} onSaved={setData} />
      )}
    </Shell>
  );
}

function OperatorEditor({ op, onSaved }: { op: OperatorItem; onSaved: (o: OperatorItem) => void }) {
  const { pilot } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<OperatorInput>(() => operatorInputOf(op));
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const head = operatorHead(op);
  const readOnly = head.readOnly;
  useFocusParam(() => document.querySelector('[data-testid=operator-page]'));
  // who has access: refetched when a share of the operator or of one of its aircraft changes
  const people = useAsync(() => api.operatorShares.get(op.id), [op.id], {
    invalidatedBy: ['operators', 'aircraft'],
    cache: `operatorShares:${op.id}`,
  });

  const set = <K extends keyof OperatorInput>(k: K, v: OperatorInput[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const issues = validateOperator(draft);
  const issuesOf = (k: OperatorField) => issues.filter((i) => i.field === k).map((i) => i.message);

  const save = useCallback(
    async (input: OperatorInput) => onSaved(await api.operators.update(op.id, normalizedOperator(input))),
    [op.id, onSaved],
  );
  const autosave = useAutosave({
    value: draft,
    enabled: !readOnly && issues.length === 0,
    save,
    keepalive: (v) => keepalivePut(`operators/${encodeURIComponent(op.id)}`, normalizedOperator(v)),
  });
  const blocked = autosave.dirty && issues.length > 0;
  const saveError = autosave.status === 'failed' ? autosave.error : null;

  const { flush } = autosave;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        flush();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [flush]);

  const text = (
    k: 'name' | 'phone' | 'email' | 'address' | 'aftn',
    label: string,
    hint?: string,
    placeholder?: string,
  ) => (
    <Field
      focus={k}
      label={label}
      hint={hint}
      req={k === 'name'}
      issues={k === 'name' || k === 'email' ? issuesOf(k) : undefined}
    >
      <input
        name={k}
        value={draft[k]}
        onChange={(e) => set(k, e.target.value)}
        maxLength={k === 'name' ? 200 : 320}
        placeholder={placeholder}
        type={k === 'email' ? 'email' : 'text'}
      />
    </Field>
  );

  return (
    <div className="ac-page op-page" data-testid="operator-page">
      <div className="ac-head op-head">
        <div className="ac-head-back">
          <Link to="/operators" className="back" aria-label="Back to the operators" title="Operators">
            <Icon name="back" size={18} />
          </Link>
        </div>
        <div className="ac-head-main">
          <div className="ac-title">
            <h1>{draft.name || 'Operator'}</h1>
            <span className="ac-sub">{head.subtitle}</span>
            <SharedChip access={op.access} />
            {!readOnly && <SaveStatus status={autosave.status} blocked={blocked} />}
          </div>
          <span className="spacer" />
          <button type="button" onClick={() => setSharing(true)} data-testid="share-operator">
            Share
          </button>
          {head.canDelete && (
            <KebabMenu
              label="Operator actions"
              items={[{ label: 'Delete operator', onSelect: () => setDeleting(true), danger: true }]}
            />
          )}
        </div>
      </div>

      <form
        className="ac-main"
        onSubmit={(e) => {
          e.preventDefault();
          autosave.flush();
        }}
        onBlur={() => autosave.flush()}
        noValidate
      >
        <fieldset className="ac-fieldset" disabled={readOnly}>
          <Section id="details" title="Details">
            <div className="grid2">
              {text('name', 'Name')}
              {text('phone', 'Phone', undefined, '+30 …')}
            </div>
            <div className="grid2">
              {text('email', 'E-mail')}
              {text('aftn', 'AFTN or ATS contact')}
            </div>
            {text('address', 'Address')}
            <Field label="Notes">
              <textarea
                name="notes"
                rows={2}
                value={draft.notes}
                onChange={(e) => set('notes', e.target.value)}
                maxLength={5000}
              />
            </Field>
          </Section>
          <Section id="declarations" title="Before each flight">
            <Check checked={draft.requiresWbPerf} onChange={(v) => set('requiresWbPerf', v)}>
              <span data-testid="operator-requires">
                Requires the W&amp;B and performance sheets before each flight
              </span>
            </Check>
            {draft.requiresWbPerf && (
              <Field focus="declarationsEmail" label="Send them to" req issues={issuesOf('declarationsEmail')}>
                <input
                  name="declarationsEmail"
                  type="email"
                  value={draft.declarationsEmail}
                  onChange={(e) => set('declarationsEmail', e.target.value)}
                  maxLength={320}
                  placeholder="ops@example.com"
                />
              </Field>
            )}
            <Check checked={draft.requiresFplCopy} onChange={(v) => set('requiresFplCopy', v)}>
              <span data-testid="operator-requires-fpl">Wants a copy of each filed flight plan by e-mail</span>
            </Check>
            {draft.requiresFplCopy && (
              <Field focus="fplCopyEmail" label="Send it to" req issues={issuesOf('fplCopyEmail')}>
                <input
                  name="fplCopyEmail"
                  type="email"
                  value={draft.fplCopyEmail}
                  onChange={(e) => set('fplCopyEmail', e.target.value)}
                  maxLength={320}
                  placeholder="ops@example.com"
                />
              </Field>
            )}
          </Section>
        </fieldset>

        <DocumentsSection scope={operatorScope(op.id)} canEdit={!readOnly} text={DOCS_TEXT} />

        <Section id="aircraft" title="Aircraft">
          {op.aircraft.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              None.
            </p>
          ) : (
            <ul className="op-aircraft">
              {op.aircraft.map((a) => (
                <li key={a.id}>
                  <Link to={`/hangar/${a.id}`} className="mono">
                    {a.registration}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          id="access"
          title="People with access"
          actions={
            <button type="button" className="sm" onClick={() => setSharing(true)}>
              Share
            </button>
          }
        >
          {!people.data ? (
            people.error ? (
              <p className="form-error" role="alert">
                {errorMessage(people.error)}
              </p>
            ) : (
              <Loading variant="sm" />
            )
          ) : (
            <ul className="share-people" data-testid="operator-people">
              {operatorPeople(people.data.people, pilot.id).map((p) => (
                <li key={p.key} data-role={p.role} data-direct={p.direct ? '1' : '0'}>
                  <span className="share-who">
                    <b>
                      {p.name}
                      {p.self && <span className="muted"> (you)</span>}
                    </b>
                    {p.email && <span className="hint">{p.email}</span>}
                  </span>
                  <span className="muted share-role">{p.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {readOnly ? (
          <div className="ac-viewonly card">
            <Chip>View only</Chip>
            <span className="muted">{head.viewOnly}</span>
          </div>
        ) : saveError ? (
          <div className="ac-problem card" role="alert" data-testid="problem-bar">
            <span className="danger-text">
              {saveError instanceof ApiRequestError && saveError.offline
                ? 'Offline: changes not saved yet'
                : `Not saved: ${errorMessage(saveError)}`}
            </span>
            <span className="spacer" />
            <button type="button" className="sm" onClick={autosave.retry} data-testid="save-retry">
              Retry
            </button>
          </div>
        ) : null}
      </form>

      {sharing && (
        <ShareDialog
          kind="operator"
          id={op.id}
          name={op.name}
          onClose={() => setSharing(false)}
          onLeft={() => {
            toast(head.left);
            void navigate('/operators');
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={head.deleteTitle}
          confirmLabel="Delete"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api.operators.remove(op.id);
            toast(head.deleted);
            void navigate('/operators');
          }}
        >
          {head.deleteMessage}
        </ConfirmDialog>
      )}
    </div>
  );
}
