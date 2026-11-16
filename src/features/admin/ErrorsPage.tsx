// Admin → Errors (/admin/errors; ADMIN_EMAILS only, the API answers 403 to everyone else): the error
// groups recorded by the monitor (api/_lib/monitor.ts): server errors and 5xx answers, client errors,
// failed migrations and health-check warnings, newest first. A row opens its last stack; "Resolve"
// hides it until it happens again (which e-mails the admins again).
import { useState } from 'react';
import { Loading } from '../../app/Loading';
import { Shell } from '../../app/Shell';
import { api, ApiRequestError } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { AppErrorDetail, AppErrorGroup } from '../../shared/monitoring';
import { EmptyState } from '../lobby/ui';
import '../lobby/lists.css';
import { AdminNav } from './AdminNav';

const pad = (n: number) => String(n).padStart(2, '0');
const when = (ms: number | null) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type Filter = 'open' | 'resolved' | 'all';

function Detail({ fingerprint }: { fingerprint: string }) {
  const { data, error } = useAsync<AppErrorDetail>(() => api.admin.error(fingerprint), [fingerprint]);
  if (error) return <span className="muted">{error.message}</span>;
  if (!data) return <Loading />;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="hint">
        Fingerprint <span className="mono">{data.fingerprint}</span>
        {data.pilotId && <> · pilot <span className="mono">{data.pilotId}</span></>}
        {data.lastAlerted && <> · last e-mailed {when(data.lastAlerted)}</>}
      </div>
      {data.userAgent && <div className="hint">{data.userAgent}</div>}
      <pre className="mono" data-testid="admin-error-stack" style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0, maxHeight: 360, overflow: 'auto' }}>
        {data.stack || 'No stack'}
      </pre>
    </div>
  );
}

export function ErrorsPage() {
  const [filter, setFilter] = useState<Filter>('open');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync<AppErrorGroup[]>(() => api.admin.errors(filter), [filter]);
  const resolve = async (fp: string) => {
    await api.admin.resolveError(fp);
    await reload();
  };
  return (
    <Shell>
      <div className="page-head">
        <h1>Errors</h1>
        {data && <span className="muted">{data.length}</span>}
        <AdminNav current="errors" />
        <div className="tabs" style={{ marginLeft: 'auto' }}>
          {(['open', 'resolved', 'all'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
      </div>
      {error ? (
        <EmptyState title={error instanceof ApiRequestError && error.status === 403 ? 'Admins only' : 'Could not load the errors'}>{error.message}</EmptyState>
      ) : loading && !data ? <p><Loading /></p> : !data?.length ? (
        <EmptyState title={filter === 'open' ? 'No open errors' : 'No errors'}>Server, client and migration errors appear here, grouped.</EmptyState>
      ) : (
        <div className="card list-card">
          <table className="list" data-testid="admin-errors">
            <thead><tr>
              <th>Error</th><th>Kind</th><th className="num">Count</th><th>First seen</th><th>Last seen</th><th>Release</th><th></th>
            </tr></thead>
            <tbody>
              {data.map((g) => (
                <ErrorRow key={g.fingerprint} g={g} expanded={open === g.fingerprint}
                  onToggle={() => setOpen(open === g.fingerprint ? null : g.fingerprint)} onResolve={() => resolve(g.fingerprint)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function ErrorRow({ g, expanded, onToggle, onResolve }: { g: AppErrorGroup; expanded: boolean; onToggle: () => void; onResolve: () => void }) {
  const where = [g.method, g.route].filter(Boolean).join(' ');
  return (
    <>
      <tr data-fingerprint={g.fingerprint} onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td>
          <div className="nm" style={{ wordBreak: 'break-word' }}>{g.message}</div>
          <div className="hint">{where || '—'}{g.status ? ` → ${g.status}` : ''}</div>
        </td>
        <td>{g.kind}</td>
        <td className="num">{g.count}</td>
        <td className="mono">{when(g.firstSeen)}</td>
        <td className="mono">{when(g.lastSeen)}</td>
        <td className="mono">{g.release ? g.release.slice(0, 7) : '—'}</td>
        <td onClick={(e) => e.stopPropagation()}>
          {g.resolvedAt ? <span className="hint">Resolved {when(g.resolvedAt)}</span> : <button type="button" onClick={onResolve}>Resolve</button>}
        </td>
      </tr>
      {expanded && (
        <tr><td colSpan={7}><Detail fingerprint={g.fingerprint} /></td></tr>
      )}
    </>
  );
}
