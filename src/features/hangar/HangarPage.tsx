// Hangar: the pilot's aircraft. PLACEHOLDER — the screens agent owns this page (add from type
// template via src/shared/templates.ts, identity, speeds, fuel, mass & balance, performance,
// equipment, compass cards).
import { Link } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';

export function HangarPage() {
  const { data } = useAsync(() => api.aircraft.list(), []);
  return (
    <Shell>
      <div className="page-head"><h1>Hangar</h1></div>
      {!data ? <p className="muted">Loading…</p> : data.length === 0 ? <p className="muted">No aircraft yet.</p> : (
        <table className="list card"><tbody>
          {data.map((a) => <tr key={a.id}><td><Link to={`/hangar/${a.id}`}>{a.registration}</Link></td><td>{a.makeModel}</td><td>{a.cruiseTasKt} kt</td></tr>)}
        </tbody></table>
      )}
    </Shell>
  );
}
