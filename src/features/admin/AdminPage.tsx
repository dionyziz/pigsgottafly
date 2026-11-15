// Admin (ADMIN_EMAILS only; the API answers 403 to everyone else): every pilot with their sign-up and
// last sign-in, what they have (flights, aircraft, passengers, operators) and what they share. Read-only.
import { Loading } from '../../app/Loading';
import { Shell } from '../../app/Shell';
import { api, ApiRequestError } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { AdminShare } from '../../shared';
import { EmptyState } from '../lobby/ui';
import '../lobby/lists.css';

const pad = (n: number) => String(n).padStart(2, '0');
const when = (ms: number) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const shareText = (s: AdminShare) => `${s.kind === 'aircraft' ? '' : 'operator '}${s.name} (${s.role === 'edit' ? 'editor' : 'viewer'}) ${s.pilot}`;

export function AdminPage() {
  const { data, error, loading } = useAsync(() => api.admin.pilots(), []);
  return (
    <Shell>
      <div className="page-head">
        <h1>Pilots</h1>
        {data && <span className="muted">{data.length}</span>}
      </div>
      {error ? (
        <EmptyState title={error instanceof ApiRequestError && error.status === 403 ? 'Admins only' : 'Could not load the pilots'}>{error.message}</EmptyState>
      ) : loading && !data ? <p><Loading /></p> : (
        <div className="card list-card">
          <table className="list" data-testid="admin-pilots">
            <thead><tr>
              <th>Pilot</th><th>Signed up</th><th>Last sign-in</th><th className="num">Flights</th><th className="num">Aircraft</th><th className="num">Passengers</th><th className="num">Operators</th><th>Shares</th>
            </tr></thead>
            <tbody>
              {(data ?? []).map((p) => (
                <tr key={p.id} data-pilot-id={p.id}>
                  <td><div className="nm">{p.name || <span className="muted">No name</span>}</div><div className="hint">{p.email || p.id}</div></td>
                  <td className="mono">{when(p.created)}</td>
                  <td className="mono">{when(p.lastLogin)}</td>
                  <td className="num">{p.flights}{p.trashedFlights > 0 && <span className="muted"> +{p.trashedFlights} trash</span>}</td>
                  <td className="num">{p.aircraft}</td>
                  <td className="num">{p.passengers}</td>
                  <td className="num">{p.operators}</td>
                  <td>
                    {p.sharedByThem.map((s, i) => <div key={`b${i}`} className="hint">Shares {shareText(s).replace(/\) /, ') with ')}</div>)}
                    {p.sharedWithThem.map((s, i) => <div key={`w${i}`} className="hint">Has {shareText(s).replace(/\) /, ') from ')}</div>)}
                    {!p.sharedByThem.length && !p.sharedWithThem.length && <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
