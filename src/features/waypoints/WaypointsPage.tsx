// Points are usually saved from the flight editor; here a click on the map, or typed coordinates, adds one too.
import '../lobby/lists.css';

import { useMemo, useRef, useState } from 'react';

import { Shell } from '../../app/Shell';
import { useToast } from '../../app/toast';
import { api, keepalivePut } from '../../data/api';
import { useEntity } from '../../data/entities';
import type { LatLon, Waypoint } from '../../shared';
import { errorMessage } from '../../shared/format';
import {
  AsyncView,
  AutosaveFooter,
  ConfirmDialog,
  Dialog,
  DialogFooter,
  EmptyState,
  Field,
  KebabMenu,
  rowClick,
  SearchBox,
  useAutosave,
} from '../../ui';
import { matchesQuery } from '../lobby/format';
import { type FormIssue, useFormIssues } from '../passengers/formIssues';
import { formatDms, normaliseWaypointName, parseLatLon } from './coords';
import { WaypointMap } from './WaypointMap';

export function WaypointsPage() {
  const { data, error, loading, reload, setData } = useEntity('waypoints');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenamingState] = useState<{ id: string; name: string } | null>(null);
  const skipBlur = useRef(false);
  const setRenaming = (r: { id: string; name: string } | null) => {
    if (r && !renaming) skipBlur.current = false;
    setRenamingState(r);
  };
  const [editing, setEditing] = useState<Waypoint | { new: LatLon | null } | null>(null);
  const [deleting, setDeleting] = useState<Waypoint | null>(null);
  const toast = useToast();
  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => all.filter((w) => matchesQuery(`${w.name} ${w.notes}`.toLowerCase(), q)), [all, q]);

  const commitRename = async () => {
    if (!renaming) return;
    skipBlur.current = true; // the input unmounts; ignore a second blur
    const name = normaliseWaypointName(renaming.name);
    const w = all.find((x) => x.id === renaming.id);
    setRenaming(null);
    if (!w || !name || name === w.name) return;
    if (all.some((x) => x.id !== w.id && x.name === name)) {
      toast(`You already have a waypoint called ${name}`);
      return;
    }
    setData((d) => (d ?? []).map((x) => (x.id === w.id ? { ...x, name } : x)));
    try {
      await api.waypoints.update(w.id, { name });
    } catch (e) {
      toast(`Could not rename: ${errorMessage(e)}`);
      await reload();
    }
  };

  return (
    <Shell>
      <div className="page-head">
        <h1>My waypoints</h1>
        <span className="spacer" />
        {all.length > 0 && <SearchBox sm value={q} onChange={setQ} placeholder="Search waypoints" />}
        <button className="primary" onClick={() => setEditing({ new: null })} data-testid="add-waypoint">
          Add waypoint
        </button>
      </div>
      <AsyncView
        data={data}
        error={error}
        loading={loading}
        reload={() => void reload()}
        errorTitle="Could not load your waypoints"
      >
        {() => (
          <div className="wp-layout">
            <div>
              {all.length === 0 ? (
                <EmptyState title="No saved waypoints yet">Click the map to add one.</EmptyState>
              ) : rows.length === 0 ? (
                <EmptyState title="No matching waypoints">Nothing matches “{q}”.</EmptyState>
              ) : (
                <div className="card list-card">
                  <table className="list" data-testid="waypoint-list">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Position</th>
                        <th className="hide-sm">Notes</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((w) => (
                        <tr
                          key={w.id}
                          className={'clickable' + (w.id === selected ? ' selected' : '')}
                          data-waypoint-id={w.id}
                          onClick={rowClick(() => setSelected(w.id))}
                        >
                          <td>
                            {renaming?.id === w.id ? (
                              <form
                                className="inline-edit"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  e.currentTarget.querySelector('input')?.blur();
                                }}
                              >
                                <input
                                  autoFocus
                                  value={renaming.name}
                                  onChange={(e) => setRenaming({ id: w.id, name: e.target.value })}
                                  onBlur={() => {
                                    if (skipBlur.current) return;
                                    void commitRename();
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                      skipBlur.current = true;
                                      setRenaming(null);
                                    }
                                  }}
                                  aria-label="Waypoint name"
                                  maxLength={40}
                                />
                              </form>
                            ) : (
                              <span
                                className="nm mono"
                                onDoubleClick={() => setRenaming({ id: w.id, name: w.name })}
                                title="Double-click to rename"
                              >
                                {w.name}
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="mono" style={{ fontSize: 'var(--fs-sm)' }}>
                              {formatDms(w)}
                            </div>
                            <div className="hint mono">
                              {w.lat.toFixed(5)}, {w.lon.toFixed(5)}
                            </div>
                          </td>
                          <td
                            className="hide-sm muted"
                            style={{
                              maxWidth: 200,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {w.notes}
                          </td>
                          <td className="act">
                            <KebabMenu
                              items={[
                                { label: 'Rename', onSelect: () => setRenaming({ id: w.id, name: w.name }) },
                                { label: 'Edit position and notes', onSelect: () => setEditing(w) },
                                { label: 'Show on map', onSelect: () => setSelected(w.id) },
                                { label: 'Delete', onSelect: () => setDeleting(w), danger: true, separator: true },
                              ]}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <WaypointMap
              waypoints={all}
              selectedId={selected}
              onSelect={setSelected}
              onMapClick={(lat, lon) => setEditing({ new: { lat, lon } })}
            />
          </div>
        )}
      </AsyncView>
      {editing && (
        <WaypointDialog
          waypoint={'new' in editing ? null : editing}
          at={'new' in editing ? editing.new : null}
          existing={all}
          onClose={() => setEditing(null)}
          onSaved={(w, created) => {
            setSelected(w.id);
            if (!created) return;
            setEditing(null);
            toast(`Saved ${w.name}`);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.waypoints.remove(deleting.id);
            if (selected === deleting.id) setSelected(null);
            toast(`Deleted ${deleting.name}`);
          }}
        />
      )}
    </Shell>
  );
}

type WaypointField = 'name' | 'position';

export function validateWaypoint(
  name: string,
  pos: string,
  existing: Waypoint[],
  id?: string,
): FormIssue<WaypointField>[] {
  const out: FormIssue<WaypointField>[] = [];
  const n = normaliseWaypointName(name);
  if (!n) out.push({ field: 'name', message: 'Enter a name' });
  else if (existing.some((x) => x.id !== id && x.name === n))
    out.push({ field: 'name', message: `You already have ${n}` });
  if (!parseLatLon(pos))
    out.push({ field: 'position', message: pos.trim() ? 'Position not recognised' : 'Enter a position' });
  return out;
}

interface WaypointForm {
  name: string;
  pos: string;
  notes: string;
}

function WaypointDialog({
  waypoint,
  at,
  existing,
  onClose,
  onSaved,
}: {
  waypoint: Waypoint | null;
  at: LatLon | null;
  existing: Waypoint[];
  onClose: () => void;
  /** After adding (created) and after each save of an existing waypoint. */
  onSaved: (w: Waypoint, created: boolean) => void;
}) {
  const start = waypoint ?? at;
  const form = useRef<HTMLFormElement>(null);
  const [f, setF] = useState<WaypointForm>({
    name: waypoint?.name ?? '',
    pos: start ? `${start.lat.toFixed(6)}, ${start.lon.toFixed(6)}` : '',
    notes: waypoint?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = useFormIssues<WaypointField>(form);
  const parsed = parseLatLon(f.pos);
  const set = (k: keyof WaypointForm, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    if (k !== 'notes') issues.clear(k === 'pos' ? 'position' : k);
  };

  // an existing waypoint saves on its own; its problems show as they arise
  const live = validateWaypoint(f.name, f.pos, existing, waypoint?.id);
  const input = (x: WaypointForm) => {
    const p = parseLatLon(x.pos)!;
    return { name: normaliseWaypointName(x.name), lat: p.lat, lon: p.lon, notes: x.notes.trim() };
  };
  const autosave = useAutosave({
    value: f,
    enabled: !!waypoint && live.length === 0,
    save: async (x) => onSaved(await api.waypoints.update(waypoint!.id, input(x)), false),
    keepalive: (x) => waypoint && keepalivePut(`waypoints/${encodeURIComponent(waypoint.id)}`, input(x)),
  });
  const blocked = autosave.dirty && live.length > 0;
  const issuesOf = (k: WaypointField) =>
    waypoint ? live.filter((i) => i.field === k).map((i) => i.message) : issues.of(k);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (waypoint) {
      if (blocked) issues.check(live);
      else if (await autosave.settle()) onClose();
      return;
    }
    if (!issues.check(live) || !parsed) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.waypoints.create(input(f)), true);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={waypoint ? `Edit ${waypoint.name}` : 'New waypoint'}
      onClose={onClose}
      busy={busy}
      testId="waypoint-dialog"
      footer={
        waypoint ? (
          <AutosaveFooter autosave={autosave} blocked={blocked} onDone={() => void submit()} />
        ) : (
          <DialogFooter
            onCancel={onClose}
            busy={busy}
            error={error}
            primary={{ label: 'Add waypoint', onClick: () => void submit() }}
          />
        )
      }
    >
      <form
        className="stack"
        onSubmit={submit}
        onBlur={waypoint ? () => autosave.flush() : undefined}
        ref={form}
        noValidate
      >
        <Field label="Name" issues={issuesOf('name')}>
          <input
            name="name"
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
            data-autofocus
            maxLength={40}
            placeholder="e.g., ZOFRI"
            style={{ textTransform: 'uppercase', fontFamily: 'var(--mono)' }}
          />
        </Field>
        <Field
          label="Position"
          issues={issuesOf('position')}
          hint={parsed ? <span className="mono">{formatDms(parsed)}</span> : undefined}
        >
          <input
            name="position"
            value={f.pos}
            onChange={(e) => set('pos', e.target.value)}
            placeholder="37.9083, 23.7261 or 375430N 0234334E"
            className={f.pos.trim() && !parsed ? 'invalid' : undefined}
          />
        </Field>
        <Field label="Notes">
          <textarea name="notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
