// Admin (ADMIN_EMAILS only; the API answers 403 to everyone else), tabs Pilots | Errors | E-mails:
// /admin, every pilot with their sign-up and last sign-in, what they have (flights, aircraft,
// passengers, operators) and what they share; /admin/mail, the e-mail action log (every outbound
// e-mail: forms to HCAA, declarations to operators, signup notices), filterable by pilot and kind.
// Read-only. /admin/errors is ErrorsPage.tsx.
import { useState } from 'react';
import { Loading } from '../../app/Loading';
import { Shell } from '../../app/Shell';
import { api, ApiRequestError } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { AdminMail, AdminPilot, AdminShare } from '../../shared';
import { EmptyState } from '../lobby/ui';
import '../lobby/lists.css';
import { AdminNav } from './AdminNav';

const pad = (n: number) => String(n).padStart(2, '0');
const when = (ms: number) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const shareText = (s: AdminShare) => `${s.kind === 'aircraft' ? '' : 'operator '}${s.name} (${s.role === 'edit' ? 'editor' : 'viewer'}) ${s.pilot}`;

const KINDS: [string, string][] = [['', 'All kinds'], ['731', 'Form 731'], ['gendec', 'General Declaration'], ['wbperf', 'W&B / performance'], ['signup', 'Signup notice'], ['signup-more', 'More signups']];
const RESULT_CLASS: Record<AdminMail['result'], string> = { sent: '', pending: 'muted', failed: 'bad', capped: 'warn' };

function MailLog({ pilots }: { pilots: AdminPilot[] }) {
  const [pilot, setPilot] = useState('');
  const [kind, setKind] = useState('');
  const { data, error, loading } = useAsync(() => api.admin.mail({ pilot, kind }), [pilot, kind]);
  return (
    <>
      <div className="page-head">
        <h1>E-mails</h1>
        <AdminNav current="mail" />
        <select aria-label="Pilot" value={pilot} onChange={(e) => setPilot(e.target.value)} data-testid="admin-mail-pilot">
          <option value="">All pilots</option>
          {pilots.map((p) => <option key={p.id} value={p.id}>{p.name || p.email || p.id}</option>)}
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="admin-mail-kind">
          {KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </div>
      {error ? <EmptyState title="Could not load the e-mails">{error.message}</EmptyState>
        : loading && !data ? <p><Loading /></p>
        : !data?.length ? <p className="muted">No e-mails.</p> : (
        <div className="card list-card">
          <table className="list" data-testid="admin-mail">
            <thead><tr><th>Time</th><th>Pilot</th><th>Kind</th><th>To</th><th>Subject</th><th>Result</th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} data-mail-id={m.id}>
                  <td className="mono">{when(m.at)}</td>
                  <td>{m.pilot || <span className="muted">—</span>}</td>
                  <td>{KINDS.find(([v]) => v === m.kind)?.[1] ?? m.kind}{m.flightId && <div className="hint mono">{m.flightId}</div>}</td>
                  <td>{m.recipient}</td>
                  <td>{m.subject}</td>
                  <td className={RESULT_CLASS[m.result]}>{m.result}{m.error && <div className="hint">{m.error}</div>}{m.messageId && <div className="hint mono">{m.messageId}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function AdminPage() {
  const { data, error, loading } = useAsync(() => api.admin.pilots(), []);
  return (
    <Shell>
      <div className="page-head">
        <h1>Pilots</h1>
        {data && <span className="muted">{data.length}</span>}
        <AdminNav current="pilots" />
      </div>
      {error ? (
        <EmptyState title={error instanceof ApiRequestError && error.status === 403 ? 'Admins only' : 'Could not load the pilots'}>{error.message}</EmptyState>
      ) : loading && !data ? <p><Loading /></p> : (
        <div className="card list-card">
          <table className="list" data-testid="admin-pilots">
            <thead><tr>
              <th>Pilot</th><th>Signed up</th><th>Last sign-in</th><th className="num">Flights</th><th className="num">Aircraft</th><th className="num">Passengers</th><th className="num">Operators</th><th>Shares</th>
            </tr></thead>
            <tbody>
              {(data ?? []).map((p) => (
                <tr key={p.id} data-pilot-id={p.id}>
                  <td><div className="nm">{p.name || <span className="muted">No name</span>}</div><div className="hint">{p.email || p.id}</div></td>
                  <td className="mono">{when(p.created)}</td>
                  <td className="mono">{when(p.lastLogin)}</td>
                  <td className="num">{p.flights}{p.trashedFlights > 0 && <span className="muted"> +{p.trashedFlights} trash</span>}</td>
                  <td className="num">{p.aircraft}</td>
                  <td className="num">{p.passengers}</td>
                  <td className="num">{p.operators}</td>
                  <td>
                    {p.sharedByThem.map((s, i) => <div key={`b${i}`} className="hint">Shares {shareText(s).replace(/\) /, ') with ')}</div>)}
                    {p.sharedWithThem.map((s, i) => <div key={`w${i}`} className="hint">Has {shareText(s).replace(/\) /, ') from ')}</div>)}
                    {!p.sharedByThem.length && !p.sharedWithThem.length && <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

export function MailPage() {
  const { data, error } = useAsync(() => api.admin.pilots(), []);
  return (
    <Shell>
      {error ? (
        <>
          <div className="page-head"><h1>E-mails</h1><AdminNav current="mail" /></div>
          <EmptyState title={error instanceof ApiRequestError && error.status === 403 ? 'Admins only' : 'Could not load the pilots'}>{error.message}</EmptyState>
        </>
      ) : <MailLog pilots={data ?? []} />}
    </Shell>
  );
}
