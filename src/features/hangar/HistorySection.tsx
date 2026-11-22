// The aircraft page's History: the edit log, newest first, a page at a time.
import { useEffect, useRef, useState } from 'react';

import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { errorMessage, fmtLocalDayTime } from '../../shared/format';
import type { AircraftLogEntry } from '../../shared/sharing';
import { Loading, useCollapsed } from '../../ui';
import { Section } from './fields';
import { changeText, entryTitle } from './history';

export function HistorySection({
  aircraftId,
  version,
  myId,
}: {
  aircraftId: string;
  /** Changes when the aircraft is saved: the log is read again. */
  version: number | undefined;
  myId: string;
}) {
  const { collapsed, toggle } = useCollapsed('aircraft-history');
  const first = useAsync(
    () => (collapsed ? Promise.resolve(null) : api.aircraftLog(aircraftId)),
    [aircraftId, collapsed],
    { invalidatedBy: 'aircraft' },
  );
  const { reload } = first;
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    void reload();
  }, [version, reload]);
  // older pages, loaded on demand after the first one (their `next` is the one to continue from)
  const [older, setOlder] = useState<{ of: unknown; entries: AircraftLogEntry[]; next: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = first.data;
  const more = older?.of === page ? older : null;
  const entries = [...(page?.entries ?? []), ...(more?.entries ?? [])];
  const next = more ? more.next : (page?.next ?? null);

  const loadMore = async () => {
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.aircraftLog(aircraftId, next);
      setOlder({ of: page, entries: [...(more?.entries ?? []), ...p.entries], next: p.next });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id="history"
      title="History"
      actions={
        <button
          type="button"
          className="ghost sm"
          onClick={toggle}
          aria-expanded={!collapsed}
          data-testid="history-toggle"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      }
    >
      {collapsed ? null : first.error && !page ? (
        <span className="issue error" role="alert">
          {errorMessage(first.error)}
        </span>
      ) : !page ? (
        <Loading variant="sm" />
      ) : entries.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No changes yet
        </p>
      ) : (
        <>
          <ol className="history" data-testid="history">
            {entries.map((e) => (
              <li key={e.id} data-kind={e.kind}>
                <div className="history-head">
                  <span className="history-what">{entryTitle(e, myId)}</span>
                  <span className="muted tnum">{fmtLocalDayTime(e.at)}</span>
                </div>
                {e.kind === 'edit' && (
                  <ul className="history-changes">
                    {e.changes.map((c) => (
                      <li key={c.path}>{changeText(c)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {next && (
            <button type="button" className="sm" onClick={() => void loadMore()} disabled={busy}>
              {busy ? 'Loading…' : 'Show older'}
            </button>
          )}
          {error && (
            <span className="issue error" role="alert">
              {error}
            </span>
          )}
        </>
      )}
    </Section>
  );
}
