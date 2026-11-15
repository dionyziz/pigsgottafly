// Passengers: the pilot's list of people who may fly with them (search, add, edit, delete: the bin
// on the row or Delete in the dialog, confirmed, with Undo). These are
// added to a flight's manifest as PAX; Form 731, the General Declaration and W&B use their details.
// The pilot is listed first (PIC) and edited with the same form, saved to the profile.
import { Loading } from '../../app/Loading';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { useToast } from '../../app/toast';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { Passenger, PassengerInput, PersonDetails } from '../../shared';
import { usePilot } from '../../app/session';
import { ageOn, fmtDate, localToday, matchesQuery } from '../lobby/format';
import { ConfirmDialog, EmptyState } from '../lobby/ui';
import { PassengerDialog, PilotDetailsDialog } from './PassengerDialog';

const searchText = (p: PersonDetails & { notes?: string }) => [p.fullName, p.phone, p.idNumber, p.nationality, p.notes ?? '', p.dateOfBirth ?? ''].join(' ').toLowerCase();

const inputOf = ({ id: _i, created: _c, updated: _u, ...rest }: Passenger): PassengerInput => rest;

export function PassengersPage() {
  const { data, error, loading, reload, setData } = useAsync(() => api.passengers.list(), []);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Passenger | 'new' | 'me' | null>(null);
  const pilot = usePilot();
  // ?edit=me or ?edit=<passenger id> (links from the forms' missing-details list) opens that person.
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const editParam = params.get('edit');
  const [focusFields, setFocusFields] = useState<string[]>([]);
  useEffect(() => {
    if (!editParam) return;
    setFocusFields((params.get('fields') || '').split(',').filter(Boolean));
    if (editParam === 'me') { setEditing('me'); setParams({}, { replace: true }); return; }
    if (!data) return;
    const p = data.find((x) => x.id === editParam);
    if (p) setEditing(p);
    else toast('That passenger was deleted');
    setParams({}, { replace: true });
  }, [editParam, data, setParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const [deleting, setDeleting] = useState<Passenger | null>(null);
  // Deletes at once (the row goes), with Undo: the details come back as a new passenger record.
  const remove = async (p: Passenger) => {
    await api.passengers.remove(p.id);
    setData((d) => d?.filter((x) => x.id !== p.id));
    toast(`Deleted ${p.fullName}`, {
      label: 'Undo',
      onClick: () => { void api.passengers.create(inputOf(p)).then(() => reload(), (e) => toast(String((e as Error).message || e))); },
    });
    void reload();
  };
  const today = localToday();
  const rows = useMemo(() => (data || []).filter((p) => matchesQuery(searchText(p), q)), [data, q]);
  const showMe = matchesQuery(searchText(pilot), q);

  const missing = (p: PersonDetails) => [p.weightKg == null && 'weight', !p.idNumber && 'ID', !p.dateOfBirth && 'date of birth', !p.phone && 'phone'].filter(Boolean) as string[];

  return (
    <Shell>
      <div className="page-head">
        <h1>Passengers</h1>
        <span className="spacer" />
        {data && data.length > 0 && (
          <div className="searchbox" style={{ width: 300 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <input type="search" placeholder="Search passengers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search passengers" />
          </div>
        )}
        <button className="primary" onClick={() => setEditing('new')} data-testid="add-passenger">Add passenger</button>
      </div>
      {error && !data ? (
        <EmptyState title="Could not load your passengers" action={<button onClick={() => void reload()}>Try again</button>}>{error.message}</EmptyState>
      ) : loading && !data ? (
        <p><Loading /></p>
      ) : rows.length === 0 && !(data && data.length === 0) && !showMe ? (
        <EmptyState title="No matching passengers">Nothing matches “{q}”.</EmptyState>
      ) : (
        <div className="card list-card">
          <table className="list people" data-testid="passenger-list">
            <thead><tr>
              <th>Name</th><th className="hide-sm">Phone</th><th className="hide-sm">Born</th><th className="num">Weight</th><th className="hide-sm">ID</th><th />
            </tr></thead>
            <tbody>
              {showMe && (() => {
                const age = ageOn(pilot.dateOfBirth, today);
                const miss = [...missing(pilot), !pilot.nationality && 'nationality', !pilot.licenceNo && 'licence number'].filter(Boolean) as string[];
                return (
                  <tr className="clickable" onClick={(e) => { if (!(e.target as HTMLElement).closest('button, .menu')) setEditing('me'); }} data-testid="pilot-row">
                    <td>
                      <div className="nm">{pilot.fullName || <span className="warn-text">Your name is not set</span>} <span className="chip">PIC · you</span></div>
                      {miss.length > 0 && <div className="hint" title="Needed for the forms or W&B">Missing {miss.join(', ')}</div>}
                    </td>
                    <td className="hide-sm">{pilot.phone || <span className="muted">—</span>}</td>
                    <td className="hide-sm">{pilot.dateOfBirth ? <>{fmtDate(pilot.dateOfBirth).replace(/^\w+ /, '')}{age != null && <span className="muted"> · age {age}</span>}</> : <span className="muted">—</span>}</td>
                    <td className="num">{pilot.weightKg != null ? `${pilot.weightKg} kg` : <span className="muted">—</span>}</td>
                    <td className="hide-sm">{pilot.idNumber ? <><span className="mono">{pilot.idNumber}</span></> : <span className="muted">—</span>}{pilot.nationality && <span className="muted"> · {pilot.nationality}</span>}</td>
                    <td className="act" />
                  </tr>
                );
              })()}
              {rows.map((p) => {
                const age = ageOn(p.dateOfBirth, today);
                const miss = missing(p);
                return (
                  <tr key={p.id} className="clickable" onClick={(e) => { if (!(e.target as HTMLElement).closest('button, .menu')) setEditing(p); }} data-passenger-id={p.id}>
                    <td>
                      <div className="nm">{p.fullName}</div>
                      {miss.length > 0 && <div className="hint" title="Needed for the forms or W&B">Missing {miss.join(', ')}</div>}
                    </td>
                    <td className="hide-sm">{p.phone || <span className="muted">—</span>}</td>
                    <td className="hide-sm">{p.dateOfBirth ? <>{fmtDate(p.dateOfBirth).replace(/^\w+ /, '')}{age != null && <span className="muted"> · age {age}</span>}</> : <span className="muted">—</span>}</td>
                    <td className="num">{p.weightKg != null ? `${p.weightKg} kg` : <span className="muted">—</span>}</td>
                    <td className="hide-sm">{p.idNumber ? <><span className="mono">{p.idNumber}</span></> : <span className="muted">—</span>}{p.nationality && <span className="muted"> · {p.nationality}</span>}</td>
                    <td className="act">
                      <button type="button" className="icon row-delete" title={`Delete ${p.fullName}`} aria-label={`Delete ${p.fullName}`}
                        onClick={(e) => { e.stopPropagation(); setDeleting(p); }} data-testid="passenger-row-delete">
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing === 'me' && <PilotDetailsDialog focus={focusFields} onClose={() => { setEditing(null); setFocusFields([]); }} onSaved={(p) => { setEditing(null); toast(`Saved ${p.fullName}`); }} />}
      {editing && editing !== 'me' && (
        <PassengerDialog passenger={editing === 'new' ? null : editing} focus={focusFields} onClose={() => { setEditing(null); setFocusFields([]); }}
          onDelete={(p) => { setEditing(null); setFocusFields([]); setDeleting(p); }}
          onSaved={(p, created) => { setEditing(null); void reload(); toast(created ? `Added ${p.fullName}` : `Saved ${p.fullName}`); }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.fullName}?`} confirmLabel="Delete" onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}>
          They are removed from your passenger list. Flights that already have them on the manifest keep their details as they were.
        </ConfirmDialog>
      )}
    </Shell>
  );
}
