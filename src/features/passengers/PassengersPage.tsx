// Passengers: the pilot's list of people who may fly with him (search, add, edit, delete). These are
// added to a flight's manifest as PAX; Form 731, the General Declaration and W&B use their details.
import { useMemo, useState } from 'react';
import { Shell } from '../../app/Shell';
import { useToast } from '../../app/toast';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { Passenger } from '../../shared';
import { ageOn, fmtDate, localToday, matchesQuery } from '../lobby/format';
import { ConfirmDialog, EmptyState, KebabMenu } from '../lobby/ui';
import { PassengerDialog } from './PassengerDialog';

const searchText = (p: Passenger) => [p.fullName, p.phone, p.idNumber, p.nationality, p.relation, p.notes, p.dateOfBirth ?? ''].join(' ').toLowerCase();

export function PassengersPage() {
  const { data, error, loading, reload } = useAsync(() => api.passengers.list(), []);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Passenger | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Passenger | null>(null);
  const toast = useToast();
  const today = localToday();
  const rows = useMemo(() => (data || []).filter((p) => matchesQuery(searchText(p), q)), [data, q]);

  const missing = (p: Passenger) => [p.weightKg == null && 'weight', !p.idNumber && 'ID', !p.dateOfBirth && 'date of birth', !p.phone && 'phone'].filter(Boolean) as string[];

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
        <p className="muted">Loading…</p>
      ) : !data || data.length === 0 ? (
        <EmptyState title="No passengers yet" action={<button className="primary" onClick={() => setEditing('new')}>Add passenger</button>}>
          People you fly with. Add them once, then put them on any flight’s manifest; their details fill in Form 731, the General Declaration and the weight and balance.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No matching passengers">Nothing matches “{q}”.</EmptyState>
      ) : (
        <div className="card list-card">
          <table className="list people" data-testid="passenger-list">
            <thead><tr>
              <th>Name</th><th className="hide-sm">Phone</th><th className="hide-sm">Born</th><th className="num">Weight</th><th className="hide-sm">ID</th><th className="hide-sm">Relation</th><th />
            </tr></thead>
            <tbody>
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
                    <td className="hide-sm">{p.dateOfBirth ? <>{fmtDate(p.dateOfBirth).replace(/^\w+ /, '')}{age != null && <span className="muted"> · {age}</span>}</> : <span className="muted">—</span>}</td>
                    <td className="num">{p.weightKg != null ? `${p.weightKg} kg` : <span className="muted">—</span>}</td>
                    <td className="hide-sm">{p.idNumber ? <><span className="muted">{p.idType === 'PASSPORT' ? 'Passport ' : p.idType === 'ID' ? 'ID ' : ''}</span><span className="mono">{p.idNumber}</span></> : <span className="muted">—</span>}{p.nationality && <span className="muted"> · {p.nationality}</span>}</td>
                    <td className="hide-sm">{p.relation || <span className="muted">—</span>}</td>
                    <td className="act">
                      <KebabMenu items={[
                        { label: 'Edit', onSelect: () => setEditing(p) },
                        { label: 'Delete', onSelect: () => setDeleting(p), danger: true, separator: true },
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <PassengerDialog passenger={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={(p, created) => { setEditing(null); void reload(); toast(created ? `Added ${p.fullName}` : `Saved ${p.fullName}`); }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.fullName}?`} confirmLabel="Delete" onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.passengers.remove(deleting.id); await reload(); toast(`Deleted ${deleting.fullName}`); }}>
          They are removed from your passenger list. Flights that already have them on the manifest keep their details as they were.
        </ConfirmDialog>
      )}
    </Shell>
  );
}
