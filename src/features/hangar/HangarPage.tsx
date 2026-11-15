// Hangar: the pilot's aircraft as cards (key figures, what is still missing, compass card status),
// with "Add aircraft" from a type template, as a same-type copy of another aircraft, or blank.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { useSession } from '../../app/session';
import { useToast } from '../../app/toast';
import { api, ApiRequestError } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { Aircraft } from '../../shared/types';
import { localToday } from '../lobby/format';
import { ConfirmDialog, Dialog, EmptyState, KebabMenu } from '../lobby/ui';
import { toInput } from './AircraftPage';
import { StatusChip } from './CompassSection';
import { missingEssentials, sameTypeCopy } from './model';
import { buildFromTemplate, TYPE_TEMPLATES } from './templates';
import '../lobby/lists.css';
import './hangar.css';

export function HangarPage() {
  const { data, error, loading, reload } = useAsync(() => api.aircraft.list(), []);
  const { pilot, setPilot } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [adding, setAdding] = useState<{ copyOf?: Aircraft } | null>(null);
  const [deleting, setDeleting] = useState<Aircraft | null>(null);
  const today = localToday();

  const makeDefault = async (a: Aircraft) => {
    try { setPilot(await api.me.update({ defaultAircraftId: a.id })); toast(`${a.registration} is now your default aircraft`); }
    catch (e) { toast(String((e as Error).message || e)); }
  };

  return (
    <Shell>
      <div className="page-head">
        <h1>Hangar</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding({})} data-testid="add-aircraft">Add aircraft</button>
      </div>
      {error && !data ? (
        <EmptyState title="Could not load your hangar" action={<button onClick={() => void reload()}>Try again</button>}>{error.message}</EmptyState>
      ) : loading && !data ? (
        <p className="muted">Loading…</p>
      ) : !data || data.length === 0 ? (
        <EmptyState title="Your hangar is empty" action={<button className="primary" onClick={() => setAdding({})}>Add aircraft</button>}>
          Add the aircraft you fly. Start from a type template to get the flight manual’s fuel system, loading stations, envelopes and performance tables, then enter the registration, the weighing report and the compass card.
        </EmptyState>
      ) : (
        <div className="ac-grid" data-testid="hangar-list">
          {data.map((a) => {
            const miss = missingEssentials(a);
            const isDefault = pilot.defaultAircraftId === a.id;
            const seats = a.massBalance.stations.flatMap((s) => (s.kind === 'seat' ? s.seats || [] : [])).length;
            return (
              <div key={a.id} className="ac-card card" data-aircraft-id={a.id}>
                <div className="ac-card-head">
                  <Link to={`/hangar/${a.id}`} className="reg mono">{a.registration}</Link>
                  {isDefault && <span className="chip ok" title="New flights use this aircraft">Default</span>}
                  <span className="spacer" />
                  <KebabMenu items={[
                    { label: 'Open', onSelect: () => navigate(`/hangar/${a.id}`) },
                    ...(isDefault ? [] : [{ label: 'Make default aircraft', onSelect: () => void makeDefault(a) }]),
                    { label: 'Add another of this type', onSelect: () => setAdding({ copyOf: a }) },
                    { label: 'Delete', onSelect: () => setDeleting(a), danger: true, separator: true },
                  ]} />
                </div>
                <Link to={`/hangar/${a.id}`} className="ac-card-body">
                  <div className="type">{a.makeModel || <span className="muted">Type not set</span>}{a.icaoType && <span className="muted"> · {a.icaoType}/{a.wake}</span>}</div>
                  <dl className="figs">
                    <div><dt>Cruise / pattern</dt><dd>{a.cruiseTasKt > 0 ? a.cruiseTasKt : '—'} / {a.patternTasKt > 0 ? a.patternTasKt : '—'} <small>kt</small></dd></div>
                    <div><dt>Usable fuel</dt><dd>{a.fuel.usableL > 0 ? a.fuel.usableL : '—'} <small>L</small>{a.fuel.burnLph > 0 && <span className="muted"> · {a.fuel.burnLph} L/h</span>}</dd></div>
                    <div><dt>Empty / MTOW</dt><dd>{a.massBalance.emptyMassKg > 0 ? a.massBalance.emptyMassKg : '—'} / {a.massBalance.mtowKg > 0 ? a.massBalance.mtowKg : '—'} <small>kg</small></dd></div>
                    <div><dt>Seats</dt><dd>{seats || '—'}{a.massBalance.envelopes.utility && <span className="muted"> · utility</span>}</dd></div>
                  </dl>
                  <div className="row wrap foot">
                    {a.compassCards.length ? <StatusChip card={a.compassCards[0]} today={today} /> : <span className="chip">No compass card</span>}
                    {a.equipment.item10a && <span className="chip mono" title="FPL item 10">{a.equipment.item10a}/{a.equipment.item10b || '?'}</span>}
                  </div>
                  {miss.length > 0 && <div className="hint missing">Not set: {miss.join(', ')}</div>}
                </Link>
              </div>
            );
          })}
        </div>
      )}
      {adding && (
        <AddAircraftDialog hangar={data || []} copyOf={adding.copyOf} onClose={() => setAdding(null)}
          onCreated={(a) => { setAdding(null); toast(`Added ${a.registration}`); navigate(`/hangar/${a.id}`); }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.registration}?`} confirmLabel="Delete" onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.aircraft.remove(deleting.id);
            if (pilot.defaultAircraftId === deleting.id) setPilot({ ...pilot, defaultAircraftId: null });
            await reload();
            toast(`Deleted ${deleting.registration}`);
          }}>
          The aircraft and its weight and balance, performance and compass data are removed. Flights planned with it keep their route and manifest but will have no aircraft.
        </ConfirmDialog>
      )}
    </Shell>
  );
}

type Source = { kind: 'template'; id: string } | { kind: 'copy'; id: string } | { kind: 'blank' };

function AddAircraftDialog({ hangar, copyOf, onClose, onCreated }: { hangar: Aircraft[]; copyOf?: Aircraft; onClose: () => void; onCreated: (a: Aircraft) => void }) {
  const [reg, setReg] = useState('');
  const [src, setSrc] = useState<Source>(copyOf ? { kind: 'copy', id: copyOf.id } : TYPE_TEMPLATES.length ? { kind: 'template', id: TYPE_TEMPLATES[0].id } : { kind: 'blank' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regNorm = reg.trim().toUpperCase();
  const dup = hangar.some((a) => a.registration === regNorm);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regNorm) { setError('Enter the registration.'); return; }
    if (dup) { setError(`${regNorm} is already in your hangar.`); return; }
    const base = src.kind === 'copy'
      ? sameTypeCopy(toInput(hangar.find((a) => a.id === src.id)!), regNorm)
      : { ...buildFromTemplate(src.kind === 'template' ? src.id : null), registration: regNorm };
    setBusy(true);
    try {
      onCreated(await api.aircraft.create(base));
    } catch (err) {
      setError(err instanceof ApiRequestError && err.status === 409 ? `${regNorm} is already in your hangar.` : String((err as Error).message || err));
      setBusy(false);
    }
  };
  const radio = (s: Source, title: string, desc: string) => {
    const on = src.kind === s.kind && (s.kind === 'blank' || (src as { id: string }).id === (s as { id: string }).id);
    return (
      <label className={'src-opt' + (on ? ' on' : '')} key={s.kind + ('id' in s ? s.id : '')}>
        <input type="radio" name="src" checked={on} onChange={() => setSrc(s)} />
        <span><b>{title}</b><span className="hint">{desc}</span></span>
      </label>
    );
  };
  return (
    <Dialog title="Add aircraft" onClose={onClose} busy={busy} wide testId="add-aircraft-dialog" footer={<>
      <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="submit" form="add-ac" className="primary" disabled={busy}>{busy ? 'Adding…' : 'Add aircraft'}</button>
    </>}>
      <form id="add-ac" onSubmit={create} className="stack" noValidate>
        <label className="field"><span>Registration<span className="req" aria-hidden>*</span></span>
          <input className={'mono upper' + (dup ? ' invalid' : '')} value={reg} onChange={(e) => { setReg(e.target.value.toUpperCase()); setError(null); }} placeholder="e.g. SX-ABC" maxLength={20} data-autofocus />
        </label>
        <div className="field">
          <span>Start from</span>
          <div className="src-opts">
            {TYPE_TEMPLATES.map((t) => radio({ kind: 'template', id: t.id }, `${t.label} type template`, t.description))}
            {hangar.map((a) => radio({ kind: 'copy', id: a.id }, `Same type as ${a.registration}`, `${a.makeModel || 'Unknown type'}: copies speeds, fuel, equipment, stations, envelopes and performance. Serial, colours, weighing and compass cards start empty.`))}
            {radio({ kind: 'blank' }, 'Blank', 'Enter everything yourself.')}
          </div>
        </div>
        <p className="hint" style={{ margin: 0 }}>Either way, enter this airframe’s weighing report (empty mass and CG), speeds, burn rate and compass card on the next page.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
