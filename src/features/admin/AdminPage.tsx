// ADMIN_EMAILS only; the API answers 403 to everyone else.
import '../lobby/lists.css';

import { useState } from 'react';

import { Shell } from '../../app/Shell';
import { api, ApiRequestError } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import type { AdminMail, AdminPilot, AdminShare } from '../../shared';
import { fmtLocalDayTime } from '../../shared/format';
import { AsyncView, Chip, type ChipTone, EmptyState } from '../../ui';
import { AdminNav } from './AdminNav';

export const when = (ms: number | null | undefined) => fmtLocalDayTime(ms || null, { fallback: '—' });
const none = <span className="muted">—</span>;
export const adminErrorTitle = (e: Error, what: string) =>
  e instanceof ApiRequestError && e.status === 403 ? 'Admins only' : `Could not load the ${what}`;
const shareText = (s: AdminShare) =>
  `${s.kind === 'aircraft' ? '' : 'operator '}${s.name} (${s.role === 'edit' ? 'editor' : 'viewer'}) ${s.pilot}`;

const KINDS: [string, string][] = [
  ['', 'All kinds'],
  ['731', 'Form 731'],
  ['731-pax', 'Form 731 to passenger'],
  ['gendec', 'General Declaration'],
  ['wbperf', 'W&B / performance'],
  ['navlog', 'Navlog to self'],
  ['share-aircraft', 'Aircraft shared'],
  ['share-operator', 'Operator shared'],
  ['share-flight', 'Flight shared'],
  ['invite', 'Invitation'],
  ['signup', 'Signup notice'],
  ['signup-more', 'More signups'],
];
const RESULT_TONE: Record<AdminMail['result'], ChipTone | undefined> = {
  sent: 'ok',
  pending: undefined,
  failed: 'danger',
  capped: 'warn',
};

function MailLog({ pilots }: { pilots: AdminPilot[] }) {
  const [pilot, setPilot] = useState('');
  const [kind, setKind] = useState('');
  const { data, error, loading, reload } = useAsync(() => api.admin.mail({ pilot, kind }), [pilot, kind], {
    refetchOnFocus: true,
  });
  return (
    <>
      <div className="page-head">
        <h1>E-mails</h1>
        <AdminNav current="mail" />
        <span className="spacer" />
        <select
          aria-label="Pilot"
          value={pilot}
          onChange={(e) => setPilot(e.target.value)}
          data-testid="admin-mail-pilot"
        >
          <option value="">All pilots</option>
          {pilots.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.email || p.id}
            </option>
          ))}
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="admin-mail-kind">
          {KINDS.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <AsyncView
        data={data}
        error={error}
        loading={loading}
        reload={() => void reload()}
        errorTitle="Could not load the e-mails"
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="No e-mails" />}
      >
        {(list) => (
          <div className="card list-card">
            <table className="list" data-testid="admin-mail">
              <thead>
                <tr>
                  <th>Time</th>
                  <th className="hide-sm">Pilot</th>
                  <th>Kind</th>
                  <th className="hide-sm">To</th>
                  <th className="hide-sm">Subject</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} data-mail-id={m.id}>
                    <td className="tnum">{when(m.at)}</td>
                    <td className="hide-sm">{m.pilot || none}</td>
                    <td>
                      {KINDS.find(([v]) => v === m.kind)?.[1] ?? m.kind}
                      {m.flightId && <div className="hint mono">{m.flightId}</div>}
                    </td>
                    <td className="hide-sm">{m.recipient}</td>
                    <td className="hide-sm">{m.subject}</td>
                    <td>
                      <Chip sm tone={RESULT_TONE[m.result]}>
                        {m.result}
                      </Chip>
                      {m.error && <div className="hint">{m.error}</div>}
                      {m.messageId && <div className="hint mono">{m.messageId}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncView>
    </>
  );
}

export function AdminPage() {
  const { data, error, loading, reload } = useAsync(() => api.admin.pilots(), [], { refetchOnFocus: true });
  return (
    <Shell>
      <div className="page-head">
        <h1>Pilots</h1>
        {data && (
          <Chip count sm>
            {data.length}
          </Chip>
        )}
        <AdminNav current="pilots" />
      </div>
      <AsyncView
        data={data}
        error={error}
        loading={loading}
        reload={() => void reload()}
        errorTitle={error ? adminErrorTitle(error, 'pilots') : undefined}
      >
        {(list) => (
          <div className="card list-card">
            <table className="list" data-testid="admin-pilots">
              <thead>
                <tr>
                  <th>Pilot</th>
                  <th className="hide-sm">Signed up</th>
                  <th>Last sign-in</th>
                  <th className="num">Flights</th>
                  <th className="num hide-sm">Aircraft</th>
                  <th className="num hide-sm">Passengers</th>
                  <th className="num hide-sm">Operators</th>
                  <th className="hide-sm">Shares</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} data-pilot-id={p.id}>
                    <td>
                      <div className="nm">{p.name || <span className="muted">No name</span>}</div>
                      <div className="hint">{p.email || p.id}</div>
                    </td>
                    <td className="tnum hide-sm">{when(p.created)}</td>
                    <td className="tnum">{when(p.lastLogin)}</td>
                    <td className="num">
                      {p.flights}
                      {p.trashedFlights > 0 && <span className="muted"> +{p.trashedFlights} trash</span>}
                    </td>
                    <td className="num hide-sm">{p.aircraft}</td>
                    <td className="num hide-sm">{p.passengers}</td>
                    <td className="num hide-sm">{p.operators}</td>
                    <td className="hide-sm">
                      {p.sharedByThem.map((s, i) => (
                        <div key={`b${i}`} className="hint">
                          Shares {shareText(s).replace(/\) /, ') with ')}
                        </div>
                      ))}
                      {p.sharedWithThem.map((s, i) => (
                        <div key={`w${i}`} className="hint">
                          Has {shareText(s).replace(/\) /, ') from ')}
                        </div>
                      ))}
                      {!p.sharedByThem.length && !p.sharedWithThem.length && none}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncView>
    </Shell>
  );
}

export function MailPage() {
  const { data, error } = useAsync(() => api.admin.pilots(), []);
  return (
    <Shell>
      {error ? (
        <>
          <div className="page-head">
            <h1>E-mails</h1>
            <AdminNav current="mail" />
          </div>
          <EmptyState title={adminErrorTitle(error, 'pilots')}>{error.message}</EmptyState>
        </>
      ) : (
        <MailLog pilots={data ?? []} />
      )}
    </Shell>
  );
}
