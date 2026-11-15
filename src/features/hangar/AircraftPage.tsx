// One aircraft. PLACEHOLDER — the screens agent owns this page.
import { useParams } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';

export function AircraftPage() {
  const { id = '' } = useParams();
  const { data, error } = useAsync(() => api.aircraft.get(id), [id]);
  return (
    <Shell>
      {error ? <p>Aircraft not found.</p> : !data ? <p className="muted">Loading…</p> : (
        <>
          <div className="page-head"><h1>{data.registration}</h1><span className="muted">{data.makeModel}</span></div>
          <pre className="card mono" style={{ padding: 16, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(data, null, 2)}</pre>
        </>
      )}
    </Shell>
  );
}
