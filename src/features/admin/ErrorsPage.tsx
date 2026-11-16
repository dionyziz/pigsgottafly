// Admin → Errors (/admin/errors; ADMIN_EMAILS only, the API answers 403 to everyone else): the error
// groups recorded by the monitor (api/_lib/monitor.ts): server errors and 5xx answers, client errors,
// failed migrations and health-check warnings, newest first. A row opens its last stack; "Resolve"
// hides it until it happens again (which e-mails the admins again).
import '../lobby/lists.css';

import { useState } from 'react';

import { Shell } from '../../app/Shell';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { errorMessage } from '../../shared/format';
import type { AppErrorDetail, AppErrorGroup } from '../../shared/monitoring';
import { AsyncView, Chip, EmptyState, Loading, rowClick, SegmentedControl } from '../../ui';
import { AdminNav } from './AdminNav';
import { adminErrorTitle, when } from './AdminPage';

type Filter = 'open' | 'resolved' | 'all';
const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
] as const;

function Detail({ fingerprint }: { fingerprint: string }) {
  const { data, error } = useAsync<AppErrorDetail>(() => api.admin.error(fingerprint), [fingerprint]);
  if (error) return <span className="muted">{error.message}</span>;
  if (!data) return <Loading variant="sm" />;
  return (
    <div className="stack admin-error-detail">
      <div className="hint">
        Fingerprint <span className="mono">{data.fingerprint}</span>
        {data.pilotId && (
          <>
            {' '}
            · pilot <span className="mono">{data.pilotId}</span>
          </>
        )}
        {data.lastAlerted && <> · last e-mailed {when(data.lastAlerted)}</>}
      </div>
      {data.userAgent && <div className="hint">{data.userAgent}</div>}
      <pre className="mono admin-stack" data-testid="admin-error-stack">
        {data.stack || 'No stack'}
      </pre>
    </div>
  );
}

export function ErrorsPage() {
  const [filter, setFilter] = useState<Filter>('open');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync<AppErrorGroup[]>(() => api.admin.errors(filter), [filter], {
    refetchOnFocus: true,
  });
  const [resolveError, setResolveError] = useState<string | null>(null);
  const resolve = async (fp: string) => {
    setResolveError(null);
    try {
      await api.admin.resolveError(fp);
      await reload();
    } catch (e) {
      setResolveError(errorMessage(e));
    }
  };
  return (
    <Shell>
      <div className="page-head">
        <h1>Errors</h1>
        {data && (
          <Chip count sm>
            {data.length}
          </Chip>
        )}
        <AdminNav current="errors" />
        <span className="spacer" />
        <SegmentedControl sm label="Show" value={filter} options={FILTERS} onChange={setFilter} />
      </div>
      {resolveError && (
        <p className="form-error" role="alert">
          {resolveError}
        </p>
      )}
      <AsyncView
        data={data}
        error={error}
        loading={loading}
        reload={() => void reload()}
        errorTitle={error ? adminErrorTitle(error, 'errors') : undefined}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={filter === 'open' ? 'No open errors' : 'No errors'} />}
      >
        {(list) => (
          <div className="card list-card">
            <table className="list" data-testid="admin-errors">
              <thead>
                <tr>
                  <th>Error</th>
                  <th className="hide-sm">Kind</th>
                  <th className="num">Count</th>
                  <th className="hide-sm">First seen</th>
                  <th>Last seen</th>
                  <th className="hide-sm">Release</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((g) => (
                  <ErrorRow
                    key={g.fingerprint}
                    g={g}
                    expanded={open === g.fingerprint}
                    onToggle={() => setOpen(open === g.fingerprint ? null : g.fingerprint)}
                    onResolve={() => void resolve(g.fingerprint)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncView>
    </Shell>
  );
}

function ErrorRow({
  g,
  expanded,
  onToggle,
  onResolve,
}: {
  g: AppErrorGroup;
  expanded: boolean;
  onToggle: () => void;
  onResolve: () => void;
}) {
  const where = [g.method, g.route].filter(Boolean).join(' ');
  return (
    <>
      <tr className="clickable" data-fingerprint={g.fingerprint} onClick={rowClick(onToggle)} aria-expanded={expanded}>
        <td>
          <div className="nm admin-msg">{g.message}</div>
          <div className="hint">
            {where || '—'}
            {g.status ? ` → ${g.status}` : ''}
          </div>
        </td>
        <td className="hide-sm">
          <Chip sm>{g.kind}</Chip>
        </td>
        <td className="num">{g.count}</td>
        <td className="tnum hide-sm">{when(g.firstSeen)}</td>
        <td className="tnum">{when(g.lastSeen)}</td>
        <td className="mono hide-sm">{g.release ? g.release.slice(0, 7) : '—'}</td>
        <td>
          {g.resolvedAt ? (
            <span className="hint">Resolved {when(g.resolvedAt)}</span>
          ) : (
            <button type="button" className="sm" onClick={onResolve}>
              Resolve
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7}>
            <Detail fingerprint={g.fingerprint} />
          </td>
        </tr>
      )}
    </>
  );
}
