// My saved waypoints. PLACEHOLDER — the screens agent owns this page.
import { Shell } from '../../app/Shell';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';

export function WaypointsPage() {
  const { data } = useAsync(() => api.waypoints.list(), []);
  return (
    <Shell>
      <div className="page-head"><h1>My waypoints</h1></div>
      {!data ? <p className="muted">Loading…</p> : data.length === 0 ? <p className="muted">No saved waypoints yet. Name a point on the map to save it.</p> : (
        <table className="list card"><tbody>{data.map((w) => <tr key={w.id}><td>{w.name}</td><td className="mono">{w.lat.toFixed(4)}, {w.lon.toFixed(4)}</td></tr>)}</tbody></table>
      )}
    </Shell>
  );
}
