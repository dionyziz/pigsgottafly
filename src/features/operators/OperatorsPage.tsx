// Operators: the clubs and owners who operate the pilot's aircraft (own, shared with them, or seen
// through a shared aircraft), with their aircraft and whether they ask for the W&B and performance
// sheets before each flight. "New operator" creates one and opens its page. The list is the
// 'operators' entity (src/data/entities.ts): fresh after any operator, aircraft or share change.
import { Link, useNavigate } from 'react-router';
import { useState } from 'react';
import { Shell } from '../../app/Shell';
import { useEntity } from '../../data/entities';
import { AsyncView, Chip, EmptyState, rowClick } from '../../ui';
import { SharedChip } from '../hangar/ShareDialog';
import { NewOperatorDialog } from './OperatorPicker';
import '../lobby/lists.css';

const none = <span className="muted">—</span>;

export function OperatorsPage() {
  const { data, error, loading, reload } = useEntity('operators');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <Shell>
      <div className="page-head">
        <h1>Operators</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setCreating(true)} data-testid="add-operator">New operator</button>
      </div>
      <AsyncView data={data} error={error} loading={loading} reload={() => void reload()} errorTitle="Could not load the operators"
        isEmpty={(d) => d.length === 0} empty={(
          <EmptyState title="No operators yet" action={<button className="primary" onClick={() => setCreating(true)}>New operator</button>} />
        )}>
        {(list) => (
          <div className="card list-card">
            <table className="list" data-testid="operator-list">
              <thead><tr><th>Name</th><th className="hide-sm">Aircraft</th><th className="hide-sm">Contact</th><th>Declarations</th></tr></thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id} className="clickable" data-operator-id={o.id} onClick={rowClick(() => navigate(`/operators/${o.id}`))}>
                    <td>
                      <div className="nm"><Link to={`/operators/${o.id}`}>{o.name}</Link> <SharedChip access={o.access} /></div>
                      {o.access.role === 'view' && o.access.viaAircraft.length > 0 && <div className="hint">Through {o.access.viaAircraft.join(', ')}</div>}
                    </td>
                    <td className="hide-sm mono">{o.aircraft.map((a) => a.registration).join(', ') || none}</td>
                    <td className="hide-sm">{[o.phone, o.email].filter(Boolean).join(' · ') || none}</td>
                    <td>{o.requiresWbPerf ? <Chip tone="warn" title={`W&B and performance to ${o.declarationsEmail} before each flight`}>W&amp;B + performance</Chip> : none}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncView>
      {creating && <NewOperatorDialog onClose={() => setCreating(false)} onCreated={(o) => navigate(`/operators/${o.id}`)} />}
    </Shell>
  );
}
