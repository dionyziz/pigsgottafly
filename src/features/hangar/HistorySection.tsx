// The aircraft page's Version history: the revisions, newest first, a page at a time. Each opens the
// aircraft as that revision left it (VersionPreview), to compare and restore.
import { useEffect, useRef, useState } from 'react';

import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { changeText, entryTitle } from '../../shared/aircraftHistory';
import { errorMessage, fmtLocalDayTime } from '../../shared/format';
import type { AircraftRevision } from '../../shared/sharing';
import { Loading, useCollapsed } from '../../ui';
import { Section } from './fields';

export function HistorySection({
  aircraftId,
  version,
  myId,
  selected,
  onOpen,
}: {
  aircraftId: string;
  /** Changes when the aircraft is saved: the history is read again. */
  version: number | undefined;
  myId: string;
  /** The revision being looked at. */
  selected: number | null;
  onOpen: (r: AircraftRevision) => void;
}) {
  const { collapsed, toggle } = useCollapsed('aircraft-history');
  const first = useAsync(
    () => (collapsed ? Promise.resolve(null) : api.aircraftRevisions.list(aircraftId)),
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
  const [older, setOlder] = useState<{ of: unknown; revisions: AircraftRevision[]; next: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = first.data;
  const more = older?.of === page ? older : null;
  const revisions = [...(page?.revisions ?? []), ...(more?.revisions ?? [])];
  const next = more ? more.next : (page?.next ?? null);

  const loadMore = async () => {
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.aircraftRevisions.list(aircraftId, next);
      setOlder({ of: page, revisions: [...(more?.revisions ?? []), ...p.revisions], next: p.next });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id="history"
      title="Version history"
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
      ) : revisions.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No changes yet
        </p>
      ) : (
        <>
          <ol className="history" data-testid="history">
            {revisions.map((r, i) => (
              <li key={r.id} data-kind={r.kind} className={r.id === selected ? 'selected' : undefined}>
                <button
                  type="button"
                  className="history-open"
                  onClick={() => onOpen(r)}
                  aria-current={r.id === selected ? 'true' : undefined}
                  data-testid="history-open"
                >
                  <span className="history-head">
                    <span className="history-what">{entryTitle(r, myId)}</span>
                    <span className="muted tnum">{fmtLocalDayTime(r.at)}</span>
                  </span>
                  {i === 0 && <span className="history-current">Current version</span>}
                  {(r.kind === 'edit' || r.kind === 'restore') && r.changes.length > 0 && (
                    <ul className="history-changes">
                      {r.changes.map((c) => (
                        <li key={c.path}>{changeText(c)}</li>
                      ))}
                    </ul>
                  )}
                  {r.skipped && <span className="muted history-skipped">Not restored: {r.skipped.join(', ')}</span>}
                </button>
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
