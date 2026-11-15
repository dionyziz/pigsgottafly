// My waypoints: the pilot's saved custom points (list, search, rename in place, edit position/notes,
// delete) beside a small map. Points are usually saved from the flight editor; here a click on the
// map, or typed coordinates, adds one too.
import { useMemo, useRef, useState } from 'react';
import { Shell } from '../../app/Shell';
import { useToast } from '../../app/toast';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { LatLon, Waypoint } from '../../shared';
import { matchesQuery } from '../lobby/format';
import { ConfirmDialog, Dialog, EmptyState, KebabMenu } from '../lobby/ui';
import { formatDms, normaliseWaypointName, parseLatLon } from './coords';
import { WaypointMap } from './WaypointMap';

export function WaypointsPage() {
  const { data, error, loading, reload, setData } = useAsync(() => api.waypoints.list(), []);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenamingState] = useState<{ id: string; name: string } | null>(null);
  const skipBlur = useRef(false);
  const setRenaming = (r: { id: string; name: string } | null) => { if (r && !renaming) skipBlur.current = false; setRenamingState(r); };
  const [editing, setEditing] = useState<Waypoint | { new: LatLon | null } | null>(null);
  const [deleting, setDeleting] = useState<Waypoint | null>(null);
  const toast = useToast();
  const all = data || [];
  const rows = useMemo(() => all.filter((w) => matchesQuery(`${w.name} ${w.notes}`.toLowerCase(), q)), [all, q]);

  const commitRename = async () => {
    if (!renaming) return;
    skipBlur.current = true; // the input unmounts; ignore a second blur
    const name = normaliseWaypointName(renaming.name);
    const w = all.find((x) => x.id === renaming.id);
    setRenaming(null);
    if (!w || !name || name === w.name) return;
    if (all.some((x) => x.id !== w.id && x.name === name)) { toast(`You already have a waypoint called ${name}`); return; }
    setData((d) => d?.map((x) => (x.id === w.id ? { ...x, name } : x)));
    try { await api.waypoints.update(w.id, { name }); } catch (e) { toast(`Could not rename: ${(e as Error).message}`); }
    await reload();
  };

  return (
    <Shell>
      <div className="page-head">
        <h1>My waypoints</h1>
        <span className="spacer" />
        {all.length > 0 && (
          <div className="searchbox" style={{ width: 260 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <input type="search" placeholder="Search waypoints" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search waypoints" />
          </div>
        )}
        <button className="primary" onClick={() => setEditing({ new: null })} data-testid="add-waypoint">Add waypoint</button>
      </div>
      {error && !data ? (
        <EmptyState title="Could not load your waypoints" action={<button onClick={() => void reload()}>Try again</button>}>{error.message}</EmptyState>
      ) : loading && !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="wp-layout">
          <div>
            {all.length === 0 ? (
              <EmptyState title="No saved waypoints yet">
                Points you name on the map while planning (say, ZOFRI) can be saved here and reused on any flight. Click the map to add one now.
              </EmptyState>
            ) : rows.length === 0 ? (
              <EmptyState title="No matching waypoints">Nothing matches “{q}”.</EmptyState>
            ) : (
              <div className="card list-card">
                <table className="list" data-testid="waypoint-list">
                  <thead><tr><th>Name</th><th>Position</th><th className="hide-sm">Notes</th><th /></tr></thead>
                  <tbody>
                    {rows.map((w) => (
                      <tr key={w.id} className={'clickable' + (w.id === selected ? ' selected' : '')} data-waypoint-id={w.id}
                        onClick={(e) => { if (!(e.target as HTMLElement).closest('button, input, .menu')) setSelected(w.id); }}>
                        <td>
                          {renaming?.id === w.id ? (
                            <form className="inline-edit" onSubmit={(e) => { e.preventDefault(); (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.blur(); }}>
                              <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: w.id, name: e.target.value })}
                                onBlur={() => { if (skipBlur.current) return; void commitRename(); }} onKeyDown={(e) => { if (e.key === 'Escape') { skipBlur.current = true; setRenaming(null); } }} aria-label="Waypoint name" maxLength={40} />
                            </form>
                          ) : (
                            <span className="nm mono" onDoubleClick={() => setRenaming({ id: w.id, name: w.name })} title="Double-click to rename">{w.name}</span>
                          )}
                        </td>
                        <td>
                          <div className="mono" style={{ fontSize: 'var(--fs-sm)' }}>{formatDms(w)}</div>
                          <div className="hint mono">{w.lat.toFixed(5)}, {w.lon.toFixed(5)}</div>
                        </td>
                        <td className="hide-sm muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.notes}</td>
                        <td className="act">
                          <KebabMenu items={[
                            { label: 'Rename', onSelect: () => setRenaming({ id: w.id, name: w.name }) },
                            { label: 'Edit position and notes', onSelect: () => setEditing(w) },
                            { label: 'Show on map', onSelect: () => setSelected(w.id) },
                            { label: 'Delete', onSelect: () => setDeleting(w), danger: true, separator: true },
                          ]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <WaypointMap waypoints={all} selectedId={selected} onSelect={setSelected} onMapClick={(lat, lon) => setEditing({ new: { lat, lon } })} />
        </div>
      )}
      {editing && (
        <WaypointDialog waypoint={'new' in editing ? null : editing} at={'new' in editing ? editing.new : null} existing={all}
          onClose={() => setEditing(null)}
          onSaved={(w, created) => { setEditing(null); setSelected(w.id); void reload(); toast(created ? `Saved ${w.name}` : `Updated ${w.name}`); }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.name}?`} confirmLabel="Delete" onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.waypoints.remove(deleting.id); if (selected === deleting.id) setSelected(null); await reload(); toast(`Deleted ${deleting.name}`); }}>
          Flights that already go through {deleting.name} keep it at the same position.
        </ConfirmDialog>
      )}
    </Shell>
  );
}

function WaypointDialog({ waypoint, at, existing, onClose, onSaved }: {
  waypoint: Waypoint | null;
  at: LatLon | null;
  existing: Waypoint[];
  onClose: () => void;
  onSaved: (w: Waypoint, created: boolean) => void;
}) {
  const start = waypoint ?? at;
  const [name, setName] = useState(waypoint?.name ?? '');
  const [pos, setPos] = useState(start ? `${start.lat.toFixed(6)}, ${start.lon.toFixed(6)}` : '');
  const [notes, setNotes] = useState(waypoint?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseLatLon(pos);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const n = normaliseWaypointName(name);
    if (!n) { setError('Please give the waypoint a name'); return; }
    if (existing.some((x) => x.id !== waypoint?.id && x.name === n)) { setError(`You already have a waypoint called ${n}`); return; }
    if (!parsed) { setError('Position not recognised. Try 37.9083, 23.7261 or 375430N 0234334E'); return; }
    setBusy(true);
    try {
      const input = { name: n, lat: parsed.lat, lon: parsed.lon, notes: notes.trim() };
      const w = waypoint ? await api.waypoints.update(waypoint.id, input) : await api.waypoints.create(input);
      onSaved(w, !waypoint);
    } catch (err) {
      setError(String((err as Error).message || err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={waypoint ? `Edit ${waypoint.name}` : 'New waypoint'} onClose={onClose} busy={busy} testId="waypoint-dialog" footer={<>
      <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="primary" onClick={() => void submit()} disabled={busy}>Save</button>
    </>}>
      <form className="stack" onSubmit={submit}>
        <label className="field">Name
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} data-autofocus maxLength={40} placeholder="e.g. ZOFRI" style={{ textTransform: 'uppercase', fontFamily: 'var(--mono)' }} />
        </label>
        <label className="field">Position
          <input name="position" value={pos} onChange={(e) => setPos(e.target.value)} placeholder="37.9083, 23.7261 or 375430N 0234334E" className={pos.trim() && !parsed ? 'invalid' : undefined} />
          <span className="hint mono">{parsed ? formatDms(parsed) : 'Decimal degrees, degrees and minutes, or ICAO 375430N 0234334E'}</span>
        </label>
        <label className="field">Notes<textarea name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button type="submit" hidden />
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
