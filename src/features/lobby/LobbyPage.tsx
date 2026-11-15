// Lobby (Google Docs style): search, upcoming flights first, ⋮ menu (open, rename, copy, trash with
// undo). PLACEHOLDER quality — the screens agent owns and finishes this page.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { useToast } from '../../app/toast';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { FlightListItem } from '../../shared';

const fmtHm = (m: number | null) => (m == null ? '' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);

export function LobbyPage() {
  const { data, reload, loading } = useAsync(() => api.flights.list(), []);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => (data || []).filter((r) => !q || [r.summary.title, r.date, r.summary.aircraft].join(' ').toLowerCase().includes(q.toLowerCase())), [data, q]);
  const upcoming = rows.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = rows.filter((r) => r.date < today);

  const trash = async (r: FlightListItem) => {
    await api.flights.trash(r.id);
    await reload();
    toast(`“${r.summary.title || 'Untitled flight'}” moved to trash`, { label: 'Undo', onClick: () => { void api.flights.restore(r.id).then(reload); } });
  };
  const rename = async (r: FlightListItem) => {
    const t = window.prompt('Rename flight', r.summary.title);
    if (t === null) return;
    const f = await api.flights.get(r.id);
    const { id: _i, version, created: _c, updated: _u, opened: _o, deleted: _d, ...doc } = f;
    await api.flights.update(r.id, { ...doc, title: t.trim(), summary: { ...doc.summary, title: t.trim() || doc.summary.title } }, version);
    await reload();
  };
  const copy = async (r: FlightListItem) => {
    const c = await api.flights.copy(r.id);
    await reload();
    toast('Copy made', { label: 'Open', onClick: () => navigate(`/flights/${c.id}`) });
  };

  const row = (r: FlightListItem) => (
    <tr key={r.id} data-flight-id={r.id}>
      <td><Link to={`/flights/${r.id}`}>{r.summary.title || 'Untitled flight'}</Link><div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{r.summary.aircraft}</div></td>
      <td>{r.date}</td>
      <td>{r.summary.eteMin != null ? `${fmtHm(r.summary.eteMin)} · ${r.summary.distNm} NM` : ''}</td>
      <td style={{ textAlign: 'right' }}>
        <button className="ghost" onClick={() => rename(r)}>Rename</button>
        <button className="ghost" onClick={() => copy(r)}>Copy</button>
        <button className="ghost danger" onClick={() => trash(r)}>Trash</button>
      </td>
    </tr>
  );

  return (
    <Shell top={<input type="search" placeholder="Search flights" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 420, maxWidth: '100%' }} aria-label="Search flights" />}>
      <div className="page-head">
        <h1>Flights</h1>
        <span className="spacer" />
        <Link to="/flights/new" className="btn primary" data-testid="new-flight">New flight</Link>
      </div>
      {loading && !data ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">{q ? 'No matching flights.' : 'No flights yet.'}</p> : (
        <table className="list card" data-testid="flight-list">
          <tbody>
            {upcoming.length > 0 && <tr><th colSpan={4}>Upcoming</th></tr>}
            {upcoming.map(row)}
            {past.length > 0 && <tr><th colSpan={4}>{upcoming.length ? 'Earlier' : 'Recent'}</th></tr>}
            {past.map(row)}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
