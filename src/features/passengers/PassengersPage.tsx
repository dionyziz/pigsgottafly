// Passenger list. PLACEHOLDER — the screens agent owns this page (add, edit, delete, search).
import { Shell } from '../../app/Shell';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';

export function PassengersPage() {
  const { data } = useAsync(() => api.passengers.list(), []);
  return (
    <Shell>
      <div className="page-head"><h1>Passengers</h1></div>
      {!data ? <p className="muted">Loading…</p> : data.length === 0 ? <p className="muted">No passengers yet.</p> : (
        <table className="list card"><tbody>{data.map((p) => <tr key={p.id}><td>{p.fullName}</td><td>{p.phone}</td><td>{p.weightKg ?? ''}</td></tr>)}</tbody></table>
      )}
    </Shell>
  );
}
