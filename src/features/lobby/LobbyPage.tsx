// Lobby (Google Docs style): search by name/date/aircraft/route, upcoming flights first (soonest
// first) then past ones (most recent first); each row has a route sketch, title, date, block-off,
// aircraft and totals, and a ⋮ menu: Open in new tab, Rename, Make a copy, Move to trash (with
// Undo). A Trash view lists trashed flights with Restore. The header (h1, tabs, New flight) keeps
// its layout in both views.
import './lists.css';

import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Shell } from '../../app/Shell';
import { useToast } from '../../app/toast';
import { api, ApiRequestError } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { autoTitle, type Flight, type FlightListItem } from '../../shared';
import { fmtDate, localToday, relativeDay, utcToLocal } from '../../shared/date';
import { errorMessage, fmtDuration } from '../../shared/format';
import { AsyncView, Dialog, DialogFooter, EmptyState, Icon, KebabMenu, rowClick, SearchBox } from '../../ui';
import { flightSearchText, matchesQuery, splitFlights } from './format';
import { RouteThumb } from './RouteThumb';

const titleOf = (r: FlightListItem) => r.summary.title || 'Untitled flight';

/** PUT a new title, retrying once on a version conflict. '' = automatic title from the route. */
async function renameFlight(id: string, title: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const f: Flight = await api.flights.get(id);
    const { id: _i, version, created: _c, updated: _u, opened: _o, deleted: _d, ...doc } = f;
    const auto = autoTitle(doc.route);
    // typing back exactly the automatic name keeps the title automatic (it follows route edits)
    const stored = title === auto ? '' : title;
    try {
      await api.flights.update(
        id,
        { ...doc, title: stored, summary: { ...doc.summary, title: stored || auto } },
        version,
      );
      return;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409 && attempt === 0) continue;
      throw e;
    }
  }
}

export function LobbyPage() {
  const [params, setParams] = useSearchParams();
  const trashView = params.get('view') === 'trash';
  const { data, reload, loading, error, setData } = useAsync(() => api.flights.list(trashView), [trashView], {
    refetchOnFocus: true,
    invalidatedBy: 'flights',
  });
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<FlightListItem | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const today = localToday();

  const rows = useMemo(() => (data || []).filter((r) => matchesQuery(flightSearchText(r), q)), [data, q]);
  const { upcoming, past } = useMemo(() => splitFlights(rows, today), [rows, today]);

  const fail = useCallback((what: string) => (e: unknown) => toast(`${what}: ${errorMessage(e)}`), [toast]);

  const trash = async (r: FlightListItem) => {
    setData((d) => d?.filter((x) => x.id !== r.id));
    try {
      await api.flights.trash(r.id);
      toast(`“${titleOf(r)}” moved to trash`, {
        label: 'Undo',
        onClick: () => {
          void api.flights.restore(r.id).then(() => reload(), fail('Could not restore'));
        },
      });
    } catch (e) {
      fail('Could not move to trash')(e);
    }
    await reload();
  };
  const restore = async (r: FlightListItem) => {
    setData((d) => d?.filter((x) => x.id !== r.id));
    try {
      await api.flights.restore(r.id);
      toast(`“${titleOf(r)}” restored`, { label: 'Open', onClick: () => navigate(`/flights/${r.id}`) });
    } catch (e) {
      fail('Could not restore')(e);
    }
    await reload();
  };
  const copy = async (r: FlightListItem) => {
    try {
      const c = await api.flights.copy(r.id);
      await reload();
      toast(`Made “${c.title || c.summary.title}”`, { label: 'Open', onClick: () => navigate(`/flights/${c.id}`) });
    } catch (e) {
      fail('Could not copy')(e);
    }
  };
  const openNewTab = (r: FlightListItem) => window.open(`/flights/${r.id}`, '_blank', 'noopener');

  const onRowClick = (r: FlightListItem) =>
    rowClick((e) => {
      if (trashView) return;
      if (e.metaKey || e.ctrlKey) openNewTab(r);
      else navigate(`/flights/${r.id}`);
    });

  const row = (r: FlightListItem) => {
    const s = r.summary;
    const date = r.date || s.date;
    const rel = relativeDay(date, today);
    const local = utcToLocal(date, s.blockOff);
    const route = s.from && s.to ? (s.from === s.to ? `Local flight · ${s.from}` : `${s.from} → ${s.to}`) : '';
    const dash = <span className="muted">—</span>;
    const items = trashView
      ? [{ label: 'Restore', onSelect: () => void restore(r) }]
      : [
          { label: 'Open in new tab', onSelect: () => openNewTab(r) },
          { label: 'Rename', onSelect: () => setRenaming(r), separator: true },
          { label: 'Make a copy', onSelect: () => void copy(r) },
          { label: 'Move to trash', onSelect: () => void trash(r), danger: true, separator: true },
        ];
    return (
      <div
        key={r.id}
        className={'flight-row' + (date === today && !trashView ? ' today' : '')}
        data-flight-id={r.id}
        onClick={onRowClick(r)}
        style={{ cursor: trashView ? 'default' : 'pointer' }}
      >
        <RouteThumb route={s.route} />
        <div style={{ minWidth: 0 }}>
          {trashView ? (
            <div className="title">{titleOf(r)}</div>
          ) : (
            <Link to={`/flights/${r.id}`} className="title" style={{ color: 'var(--ink)', display: 'block' }}>
              {titleOf(r)}
            </Link>
          )}
          <div className="sub">{[route, s.aircraft].filter(Boolean).join(' · ') || 'No route yet'}</div>
        </div>
        <div className="cell hide-sm">
          <b>{fmtDate(date) || 'No date'}</b>
          {rel && <div className="sub">{rel}</div>}
        </div>
        <div className="cell hide-sm" title={local ? `${local} local time` : undefined}>
          {s.blockOff ? (
            <>
              <b>{s.blockOff}</b> UTC{local && <div className="sub">{local} local</div>}
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </div>
        <div className="cell num hide-sm" data-testid="flight-dist">
          {s.distNm != null ? `${Math.round(s.distNm)} NM` : dash}
        </div>
        <div className="cell num hide-sm" data-testid="flight-time">
          {s.eteMin != null ? fmtDuration(s.eteMin) : dash}
        </div>
        <div className="cell num hide-sm" data-testid="flight-fuel">
          {s.fuelL != null ? `${Math.round(s.fuelL)} L` : dash}
        </div>
        <KebabMenu items={items} />
      </div>
    );
  };

  const section = (label: string, list: FlightListItem[]) =>
    list.length > 0 && (
      <>
        <div className="lobby-section">
          {label}
          <span className="count">{list.length}</span>
        </div>
        <div className="lobby-head-cols">
          <span />
          <span>Flight</span>
          <span className="hide-sm">Date</span>
          <span className="hide-sm">Block-off</span>
          <span className="num hide-sm">Distance</span>
          <span className="num hide-sm">Time</span>
          <span className="num hide-sm">Fuel</span>
          <span />
        </div>
        <div className="card flights">{list.map(row)}</div>
      </>
    );

  const searchBox = (
    <SearchBox
      value={q}
      onChange={setQ}
      placeholder={trashView ? 'Search the trash' : 'Search by name, date, aircraft or aerodrome'}
      label="Search flights"
      testId="flight-search"
    />
  );

  return (
    <Shell top={searchBox}>
      <div className="page-head lobby-head">
        <h1>Flights</h1>
        <div className="tabs lobby-tabs">
          <button type="button" aria-pressed={!trashView} onClick={() => setParams({}, { replace: true })}>
            All flights
          </button>
          <button
            type="button"
            aria-pressed={trashView}
            onClick={() => setParams({ view: 'trash' }, { replace: true })}
            data-testid="trash-view"
          >
            Trash
          </button>
        </div>
        <span className="spacer" />
        {/* kept in the trash view (hidden), so the header does not move */}
        <Link
          to="/flights/new"
          className="btn primary"
          data-testid="new-flight"
          style={trashView ? { visibility: 'hidden' } : undefined}
          aria-hidden={trashView || undefined}
          tabIndex={trashView ? -1 : undefined}
        >
          <Icon name="plus" size={14} />
          New flight
        </Link>
      </div>
      <AsyncView
        data={data}
        error={error}
        loading={loading}
        reload={() => void reload()}
        errorTitle="Could not load your flights"
        isEmpty={() => rows.length === 0 && !q}
        empty={
          trashView ? (
            <EmptyState title="The trash is empty" />
          ) : (
            <EmptyState
              title="No flights yet"
              action={
                <Link to="/flights/new" className="btn primary">
                  New flight
                </Link>
              }
            />
          )
        }
        isNoMatch={() => rows.length === 0}
        noMatch={<EmptyState title="No matching flights" />}
      >
        {() => (
          <div data-testid="flight-list">
            {trashView ? (
              section('In the trash', [...upcoming, ...past])
            ) : (
              <>
                {section('Upcoming', upcoming)}
                {section('Past', past)}
              </>
            )}
          </div>
        )}
      </AsyncView>
      {renaming && (
        <RenameDialog
          row={renaming}
          onClose={() => setRenaming(null)}
          onDone={async () => {
            setRenaming(null);
            await reload();
          }}
        />
      )}
    </Shell>
  );
}

function RenameDialog({
  row,
  onClose,
  onDone,
}: {
  row: FlightListItem;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  // the automatic name (from the route) is the placeholder; an automatic title starts empty
  const auto = autoTitle((row.points ?? []).map((name) => ({ name })));
  const [title, setTitle] = useState(row.summary.title === auto ? '' : row.summary.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      await renameFlight(row.id, title.trim());
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Rename flight"
      onClose={onClose}
      busy={busy}
      testId="rename-dialog"
      footer={
        <DialogFooter
          onCancel={onClose}
          busy={busy}
          error={error}
          primary={{ label: 'Rename', onClick: () => void submit() }}
        />
      }
    >
      <form onSubmit={submit}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder={auto}
          style={{ width: '100%' }}
          aria-label="Flight name"
        />
      </form>
    </Dialog>
  );
}
