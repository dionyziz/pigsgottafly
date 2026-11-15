// Operators: the clubs and owners who operate the pilot's aircraft (own, shared with them, or seen
// through a shared aircraft), with their aircraft and whether they ask for the W&B and performance
// sheets before each flight. "New operator" creates one and opens its page.
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Loading } from '../../app/Loading';
import { Shell } from '../../app/Shell';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { EmptyState } from '../lobby/ui';
import { SharedChip } from '../hangar/ShareDialog';
import { NewOperatorDialog } from './OperatorPicker';
import '../lobby/lists.css';

export function OperatorsPage() {
  const { data, error, loading, reload } = useAsync(() => api.operators.list(), []);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <Shell>
      <div className="page-head">
        <h1>Operators</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setCreating(true)} data-testid="add-operator">New operator</button>
      </div>
      {error && !data ? (
        <EmptyState title="Could not load the operators" action={<button onClick={() => void reload()}>Try again</button>}>{error.message}</EmptyState>
      ) : loading && !data ? (
        <p><Loading /></p>
      ) : !data || data.length === 0 ? (
        <EmptyState title="No operators yet" action={<button className="primary" onClick={() => setCreating(true)}>New operator</button>}>
          The club or owner who operates an aircraft: its name goes on the General Declaration and the flight plan, and it can ask for the W&amp;B and performance sheets before each flight.
        </EmptyState>
      ) : (
        <div className="card list-card">
          <table className="list" data-testid="operator-list">
            <thead><tr><th>Name</th><th className="hide-sm">Aircraft</th><th className="hide-sm">Contact</th><th>Declarations</th></tr></thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id} className="clickable" data-operator-id={o.id} onClick={() => navigate(`/operators/${o.id}`)}>
                  <td>
                    <div className="nm"><Link to={`/operators/${o.id}`} onClick={(e) => e.stopPropagation()}>{o.name}</Link> <SharedChip access={o.access} /></div>
                    {o.access.role === 'view' && o.access.viaAircraft.length > 0 && <div className="hint">Through {o.access.viaAircraft.join(', ')}</div>}
                  </td>
                  <td className="hide-sm mono">{o.aircraft.map((a) => a.registration).join(', ') || <span className="muted">—</span>}</td>
                  <td className="hide-sm">{[o.phone, o.email].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                  <td>{o.requiresWbPerf ? <span className="chip warn" title={`W&B and performance to ${o.declarationsEmail} before each flight`}>W&amp;B + performance</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewOperatorDialog onClose={() => setCreating(false)} onCreated={(o) => navigate(`/operators/${o.id}`)} />}
    </Shell>
  );
}
