// Passengers: the pilot's list of people who may fly with them (search, add, edit, delete: the bin
// on the row or Delete in the dialog, confirmed, with Undo). These are added to a flight's manifest as PAX; Form 731, the General Declaration and W&B use their details.
// The pilot is listed first (PIC) and edited with the same form, saved to the profile.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { usePilot } from '../../app/session';
import { useToast } from '../../app/toast';
import { api } from '../../data/api';
import { useEntity } from '../../data/entities';
import type { Passenger, PassengerInput, PersonDetails, Pilot } from '../../shared';
import { errorMessage } from '../../shared/format';
import { ageOn, fmtDate, localToday } from '../../shared/date';
import { AsyncView, Chip, ConfirmDialog, EmptyState, Icon, SearchBox, rowClick } from '../../ui';
import { matchesQuery } from '../lobby/format';
import { PassengerDialog, PilotDetailsDialog } from './PassengerDialog';
import './passengers.css';
import type { PersonField } from './person';
import '../lobby/lists.css';

const searchText = (p: PersonDetails & { notes?: string }) => [p.fullName, p.phone, p.idNumber, p.nationality, p.notes ?? '', p.dateOfBirth ?? ''].join(' ').toLowerCase();

/** What a person still lacks for the forms or W&B, with the field that takes it. */
function missing(p: PersonDetails, pilot?: Pilot): [PersonField, string][] {
  const out: [PersonField, string | false][] = [
    ['weightKg', p.weightKg == null && 'weight'],
    ['idNumber', !p.idNumber && 'ID'],
    ['dateOfBirth', !p.dateOfBirth && 'date of birth'],
    ['phone', !p.phone && 'phone'],
    ['nationality', !!pilot && !p.nationality && 'nationality'],
    ['licenceNo', !!pilot && !pilot.licenceNo && 'licence number'],
  ];
  return out.filter((x): x is [PersonField, string] => !!x[1]);
}

const none = <span className="muted">—</span>;

const inputOf = ({ id: _i, created: _c, updated: _u, ...rest }: Passenger): PassengerInput => rest;

/** One row of the list: the pilot (PIC) or a passenger. "Missing …" items open the dialog at that field. */
function PersonRow({ person, pilot, today, onEdit, onDelete, testId, passengerId }: {
  person: PersonDetails;
  /** Set for the pilot's own row. */
  pilot?: Pilot;
  today: string;
  onEdit: (fields?: PersonField[]) => void;
  /** The row's bin (passengers only). */
  onDelete?: () => void;
  testId?: string;
  passengerId?: string;
}) {
  const age = ageOn(person.dateOfBirth, today);
  const miss = missing(person, pilot);
  return (
    <tr className="clickable" onClick={rowClick(() => onEdit())} data-testid={testId} data-passenger-id={passengerId}>
      <td>
        <div className="nm">
          {person.fullName || <span className="warn-text">Your name is not set</span>}
          {pilot && <> <Chip sm>PIC · you</Chip></>}
        </div>
        {miss.length > 0 && (
          <div className="hint" title="Needed for the forms or W&B">
            Missing {miss.map(([field, label], i) => (
              <Fragment key={field}>{i > 0 && ', '}<button type="button" className="linkish" onClick={() => onEdit([field])}>{label}</button></Fragment>
            ))}
          </div>
        )}
      </td>
      <td className="hide-sm">{person.phone || none}</td>
      <td className="hide-sm date">{person.dateOfBirth ? <>{fmtDate(person.dateOfBirth)}{age != null && <span className="muted"> · age {age}</span>}</> : none}</td>
      <td className="num">{person.weightKg != null ? `${person.weightKg} kg` : none}</td>
      <td className="hide-sm">{person.idNumber ? <span className="mono">{person.idNumber}</span> : none}</td>
      <td className="hide-sm">{person.nationality || none}</td>
      <td className="act">
        {onDelete && (
          <button type="button" className="icon row-delete" title={`Delete ${person.fullName}`} aria-label={`Delete ${person.fullName}`}
            onClick={onDelete} data-testid="passenger-row-delete"><Icon name="trash" /></button>
        )}
      </td>
    </tr>
  );
}

export function PassengersPage() {
  const { data, error, loading, reload, setData } = useEntity('passengers');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Passenger | 'new' | 'me' | null>(null);
  const [focusFields, setFocusFields] = useState<string[]>([]);
  const pilot = usePilot();
  const toast = useToast();
  // ?edit=me or ?edit=<passenger id>, with &fields=<names> (links from the forms' missing-details list).
  const [params, setParams] = useSearchParams();
  const editParam = params.get('edit');
  useEffect(() => {
    if (!editParam) return;
    const fields = (params.get('fields') || '').split(',').filter(Boolean);
    if (editParam === 'me') { setFocusFields(fields); setEditing('me'); setParams({}, { replace: true }); return; }
    if (!data) return;
    const p = data.find((x) => x.id === editParam);
    if (p) { setFocusFields(fields); setEditing(p); } else toast('That passenger was deleted');
    setParams({}, { replace: true });
  }, [editParam, data, setParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const [deleting, setDeleting] = useState<Passenger | null>(null);
  // Deletes at once (the row goes), with Undo: the details come back as a new passenger record.
  const remove = async (p: Passenger) => {
    await api.passengers.remove(p.id);
    setData((d) => (d ?? []).filter((x) => x.id !== p.id));
    toast(`Deleted ${p.fullName}`, {
      label: 'Undo',
      onClick: () => { void api.passengers.create(inputOf(p)).catch((e) => toast(errorMessage(e))); },
    });
  };
  const today = localToday();
  const rows = useMemo(() => (data || []).filter((p) => matchesQuery(searchText(p), q)), [data, q]);
  const showMe = matchesQuery(searchText(pilot), q);
  const edit = (who: Passenger | 'me', fields: string[] = []) => { setFocusFields(fields); setEditing(who); };
  const close = () => { setEditing(null); setFocusFields([]); };

  return (
    <Shell>
      <div className="page-head">
        <h1>Passengers</h1>
        <span className="spacer" />
        {data && data.length > 0 && <SearchBox sm value={q} onChange={setQ} placeholder="Search passengers" />}
        <button className="primary" onClick={() => setEditing('new')} data-testid="add-passenger">Add passenger</button>
      </div>
      <AsyncView data={data} error={error} loading={loading} reload={() => void reload()} errorTitle="Could not load your passengers"
        isNoMatch={() => rows.length === 0 && !showMe} noMatch={<EmptyState title="No matching passengers">Nothing matches “{q}”.</EmptyState>}>
        {() => (
          <div className="card list-card">
            <table className="list people" data-testid="passenger-list">
              <thead><tr>
                <th>Name</th><th className="hide-sm">Phone</th><th className="hide-sm">Born</th><th className="num">Weight</th>
                <th className="hide-sm">ID</th><th className="hide-sm">Nationality</th><th />
              </tr></thead>
              <tbody>
                {showMe && (
                  <PersonRow person={pilot} pilot={pilot} today={today} testId="pilot-row" onEdit={(fields) => edit('me', fields)} />
                )}
                {rows.map((p) => (
                  <PersonRow key={p.id} person={p} passengerId={p.id} today={today} onEdit={(fields) => edit(p, fields)} onDelete={() => setDeleting(p)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncView>
      {editing === 'me' && <PilotDetailsDialog focus={focusFields} onClose={close} onSaved={(p) => { close(); toast(`Saved ${p.fullName}`); }} />}
      {editing && editing !== 'me' && (
        <PassengerDialog passenger={editing === 'new' ? null : editing} focus={focusFields} onClose={close}
          onDelete={(p) => { close(); setDeleting(p); }}
          onSaved={(p, created) => { close(); toast(created ? `Added ${p.fullName}` : `Saved ${p.fullName}`); }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.fullName}?`} confirmLabel="Delete" onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}>
          Flights that already have them on the manifest keep their details.
        </ConfirmDialog>
      )}
    </Shell>
  );
}
