// Removing a shared aircraft from the hangar removes only the pilot's access.
import '../lobby/lists.css';
import './hangar.css';

import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useBack, withBack } from '../../app/back';
import { useSession } from '../../app/session';
import { Shell } from '../../app/Shell';
import { useToast } from '../../app/toast';
import { api, ApiRequestError } from '../../data/api';
import { useEntity } from '../../data/entities';
import { localToday } from '../../shared/date';
import { errorMessage } from '../../shared/format';
import type { HangarAircraft } from '../../shared/sharing';
import type { Aircraft } from '../../shared/types';
import { Chip, ConfirmDialog, Dialog, DialogFooter, EmptyState, KebabMenu, Loading } from '../../ui';
import {
  addedText,
  addOptions,
  type AddSource,
  alreadyInHangar,
  defaultSource,
  keepsOperator,
  newAircraftInput,
  normalRegistration,
  registrationTaken,
  sameSource,
} from './add';
import { AircraftPhoto } from './AircraftFiles';
import { StatusChip } from './CompassSection';
import { updatedText } from './history';
import { InviteDialog } from './InviteDialog';
import { missingEssentials } from './model';
import { SharedChip, ShareDialog } from './ShareDialog';

export function HangarPage() {
  const { data, error, loading, reload } = useEntity('aircraft');
  const { pilot, setPilot, session } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  // opened from a flight (?back=): the new aircraft's page keeps the way back
  const { back } = useBack();
  const [adding, setAdding] = useState<{ copyOf?: Aircraft } | null>(null);
  const [deleting, setDeleting] = useState<Aircraft | null>(null);
  const [sharing, setSharing] = useState<HangarAircraft | null>(null);
  const [leaving, setLeaving] = useState<HangarAircraft | null>(null);
  const [inviting, setInviting] = useState(false);
  const dropDefault = (a: Aircraft) => {
    if (pilot.defaultAircraftId === a.id) setPilot({ ...pilot, defaultAircraftId: null });
  };
  const today = localToday();

  const makeDefault = async (a: Aircraft) => {
    try {
      setPilot(await api.me.update({ defaultAircraftId: a.id }));
      toast(`${a.registration} is now your default aircraft`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  // The server makes a new aircraft the default when the pilot has none; refresh the profile to show it.
  const onCreated = async (a: Aircraft) => {
    setAdding(null);
    let becameDefault = false;
    if (!pilot.defaultAircraftId) {
      try {
        const me = await api.me.get();
        setPilot(me);
        becameDefault = me.defaultAircraftId === a.id;
      } catch {
        /* the profile refreshes on the next load */
      }
    }
    toast(addedText(a.registration, becameDefault));
    void navigate(withBack(`/hangar/${a.id}`, back));
  };

  return (
    <Shell>
      <div className="page-head">
        <h1>Hangar</h1>
        <span className="spacer" />
        {session.mode === 'google' && (
          <button onClick={() => setInviting(true)} data-testid="invite-pilots">
            Invite pilots
          </button>
        )}
        <button className="primary" onClick={() => setAdding({})} data-testid="add-aircraft">
          Add aircraft
        </button>
      </div>
      {error && !data ? (
        <EmptyState
          title="Could not load your hangar"
          action={<button onClick={() => void reload()}>Try again</button>}
        >
          {errorMessage(error)}
        </EmptyState>
      ) : loading && !data ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No aircraft"
          action={
            <button className="primary" onClick={() => setAdding({})}>
              Add aircraft
            </button>
          }
        />
      ) : (
        <div className="ac-grid" data-testid="hangar-list">
          {data.map((a) => {
            const miss = missingEssentials(a);
            const isDefault = pilot.defaultAircraftId === a.id;
            const seats = a.massBalance.stations.flatMap((s) => (s.kind === 'seat' ? s.seats || [] : [])).length;
            return (
              <div key={a.id} className="ac-card card" data-aircraft-id={a.id}>
                <div className="ac-card-photo">
                  <AircraftPhoto
                    aircraftId={a.id}
                    photo={a.photo}
                    placeholder={a.placeholder}
                    className="card-top"
                    alt=""
                  />
                </div>
                <div className="ac-card-head">
                  <Link to={withBack(`/hangar/${a.id}`, back)} className="reg mono ac-card-link">
                    {a.registration}
                  </Link>
                  {isDefault && <Chip tone="ok">Default</Chip>}
                  <span className="spacer" />
                  <KebabMenu
                    items={[
                      { label: 'Open', onSelect: () => void navigate(withBack(`/hangar/${a.id}`, back)) },
                      { label: 'Share…', onSelect: () => setSharing(a) },
                      ...(isDefault ? [] : [{ label: 'Make default aircraft', onSelect: () => void makeDefault(a) }]),
                      { label: 'Add another of this type', onSelect: () => setAdding({ copyOf: a }) },
                      a.access?.role === 'owner'
                        ? { label: 'Delete', onSelect: () => setDeleting(a), danger: true, separator: true }
                        : {
                            label: 'Remove from my hangar',
                            onSelect: () => setLeaving(a),
                            danger: true,
                            separator: true,
                          },
                    ]}
                  />
                </div>
                {a.access?.role !== 'owner' && (
                  <div className="ac-card-share">
                    <SharedChip access={a.access} />
                  </div>
                )}
                <div className="ac-card-body">
                  <div className="type">
                    {a.makeModel || <span className="muted">Type not set</span>}
                    {a.icaoType && (
                      <span className="muted">
                        {' '}
                        · {a.icaoType}/{a.wake}
                      </span>
                    )}
                  </div>
                  <dl className="figs">
                    <div>
                      <dt>Cruise / pattern</dt>
                      <dd>
                        {a.cruiseTasKt > 0 ? a.cruiseTasKt : '—'} / {a.patternTasKt > 0 ? a.patternTasKt : '—'}{' '}
                        <small>kt</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Usable fuel</dt>
                      <dd>
                        {a.fuel.usableL > 0 ? a.fuel.usableL : '—'} <small>L</small>
                        {a.fuel.burnLph > 0 && <span className="muted"> · {a.fuel.burnLph} L/h</span>}
                      </dd>
                    </div>
                    <div>
                      <dt>Empty / MTOW</dt>
                      <dd>
                        {a.massBalance.emptyMassKg > 0 ? a.massBalance.emptyMassKg : '—'} /{' '}
                        {a.massBalance.mtowKg > 0 ? a.massBalance.mtowKg : '—'} <small>kg</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Seats</dt>
                      <dd>
                        {seats || '—'}
                        {a.massBalance.envelopes.utility && <span className="muted"> · utility</span>}
                      </dd>
                    </div>
                  </dl>
                  <div className="row wrap foot">
                    {a.compassCards.length ? (
                      <StatusChip card={a.compassCards[0]} today={today} />
                    ) : (
                      <Chip>No compass card</Chip>
                    )}
                    {a.equipment.item10a && (
                      <Chip mono title="FPL item 10">
                        {a.equipment.item10a}/{a.equipment.item10b || '?'}
                      </Chip>
                    )}
                  </div>
                  {miss.length > 0 && <div className="hint missing">Not set: {miss.join(', ')}</div>}
                  {a.updatedAt ? (
                    <div className="hint ac-card-updated" data-testid="aircraft-updated">
                      {updatedText(a.updatedAt, a.updatedBy, pilot.id)}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {adding && (
        <AddAircraftDialog
          hangar={data || []}
          copyOf={adding.copyOf}
          onClose={() => setAdding(null)}
          onCreated={(a) => {
            void onCreated(a);
          }}
        />
      )}
      {sharing && (
        <ShareDialog
          id={sharing.id}
          name={sharing.registration}
          onClose={() => setSharing(null)}
          onLeft={() => {
            dropDefault(sharing);
            setSharing(null);
            void reload();
            toast(`Removed ${sharing.registration} from your hangar`);
          }}
        />
      )}
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      {leaving && (
        <ConfirmDialog
          title={`Remove ${leaving.registration} from your hangar?`}
          confirmLabel="Remove"
          onClose={() => setLeaving(null)}
          onConfirm={async () => {
            await api.shares.remove(leaving.id, pilot.id);
            dropDefault(leaving);
            await reload();
            toast(`Removed ${leaving.registration} from your hangar`);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.registration}?`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.aircraft.remove(deleting.id);
            dropDefault(deleting);
            await reload();
            toast(`Deleted ${deleting.registration}`);
          }}
        />
      )}
    </Shell>
  );
}

function AddAircraftDialog({
  hangar,
  copyOf,
  onClose,
  onCreated,
}: {
  hangar: Aircraft[];
  copyOf?: Aircraft;
  onClose: () => void;
  onCreated: (a: Aircraft) => void;
}) {
  const [reg, setReg] = useState('');
  const [src, setSrc] = useState<AddSource>(() => defaultSource(copyOf));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regNorm = normalRegistration(reg);
  const dup = registrationTaken(hangar, regNorm);

  const create = async () => {
    if (busy) return;
    const made = newAircraftInput(hangar, src, regNorm);
    if (made.error !== null) {
      setError(made.error);
      return;
    }
    const base = made.input;
    setBusy(true);
    try {
      if (base.operatorId) {
        const op = await api.operators.get(base.operatorId).catch(() => null);
        if (!keepsOperator(op)) base.operatorId = null;
      }
      onCreated(await api.aircraft.create(base));
    } catch (err) {
      setError(err instanceof ApiRequestError && err.status === 409 ? alreadyInHangar(regNorm) : errorMessage(err));
      setBusy(false);
    }
  };
  const radio = (s: AddSource, title: string, desc: string) => {
    const on = sameSource(src, s);
    return (
      <label className={'src-opt' + (on ? ' on' : '')} key={s.kind + ('id' in s ? s.id : '')}>
        <input type="radio" name="src" checked={on} onChange={() => setSrc(s)} />
        <span>
          <b>{title}</b>
          {desc && <span className="hint">{desc}</span>}
        </span>
      </label>
    );
  };
  return (
    <Dialog
      title="Add aircraft"
      onClose={onClose}
      busy={busy}
      wide
      testId="add-aircraft-dialog"
      footer={
        <DialogFooter
          onCancel={onClose}
          busy={busy}
          error={error}
          primary={{
            label: busy ? 'Adding…' : 'Add aircraft',
            onClick: () => void create(),
            disabled: busy,
            testId: 'add-aircraft-submit',
          }}
        />
      }
    >
      <form
        id="add-ac"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="stack"
        noValidate
      >
        <label className="field">
          <span>
            Registration
            <span className="req" aria-hidden>
              *
            </span>
          </span>
          <input
            className={'mono upper' + (dup ? ' invalid' : '')}
            value={reg}
            onChange={(e) => {
              setReg(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder="e.g., SX-ABC"
            maxLength={20}
            data-autofocus
          />
        </label>
        <div className="field">
          <span>Start from</span>
          <div className="src-opts">{addOptions(hangar).map((o) => radio(o.source, o.title, o.description))}</div>
        </div>
      </form>
    </Dialog>
  );
}
