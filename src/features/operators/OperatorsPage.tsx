// The list is the 'operators' entity (src/data/entities.ts): fresh after any operator, aircraft or share edit.
import '../lobby/lists.css';

import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Shell } from '../../app/Shell';
import { useEntity } from '../../data/entities';
import { AsyncView, Chip, EmptyState, rowClick } from '../../ui';
import { SharedChip } from '../hangar/ShareDialog';
import { operatorRow } from './model';
import { NewOperatorDialog } from './OperatorPicker';

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
        <button className="primary" onClick={() => setCreating(true)} data-testid="add-operator">
          New operator
        </button>
      </div>
      <AsyncView
        data={data}
        error={error}
        loading={loading}
        reload={() => void reload()}
        errorTitle="Could not load the operators"
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            title="No operators yet"
            action={
              <button className="primary" onClick={() => setCreating(true)}>
                New operator
              </button>
            }
          />
        }
      >
        {(list) => (
          <div className="card list-card">
            <table className="list" data-testid="operator-list">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hide-sm">Aircraft</th>
                  <th className="hide-sm">Contact</th>
                  <th>Declarations</th>
                </tr>
              </thead>
              <tbody>
                {list
                  .map((o) => ({ o, r: operatorRow(o) }))
                  .map(({ o, r }) => (
                    <tr
                      key={o.id}
                      className="clickable"
                      data-operator-id={o.id}
                      onClick={rowClick(() => void navigate(`/operators/${o.id}`))}
                    >
                      <td>
                        <div className="nm">
                          <Link to={`/operators/${o.id}`}>{o.name}</Link> <SharedChip access={o.access} />
                        </div>
                        {r.through && <div className="hint">{r.through}</div>}
                      </td>
                      <td className="hide-sm mono">{r.aircraft || none}</td>
                      <td className="hide-sm">{r.contact || none}</td>
                      <td>
                        {r.flags.map((f) => (
                          <Chip key={f.label} tone="warn" title={f.title}>
                            {f.label}
                          </Chip>
                        ))}
                        {r.flags.length === 0 && none}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncView>
      {creating && (
        <NewOperatorDialog onClose={() => setCreating(false)} onCreated={(o) => void navigate(`/operators/${o.id}`)} />
      )}
    </Shell>
  );
}
