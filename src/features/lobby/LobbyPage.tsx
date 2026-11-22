// Flights other pilots shared with this one are in their own "Shared with me" group (never in the trash).
import './lists.css';
import '../hangar/share.css';

import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useSession } from '../../app/session';
import { Shell } from '../../app/Shell';
import { useToast } from '../../app/toast';
import { api, ApiRequestError } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { autoTitle, type Flight, type FlightListItem } from '../../shared';
import { FILING_STATUS_LABEL } from '../../shared/briefing';
import { fmtDate, localDepartureDay, localToday, relativeDay, todayUtc, utcToLocalMarked } from '../../shared/date';
import { errorMessage, fmtDuration } from '../../shared/format';
import { AsyncView, Chip, Dialog, DialogFooter, EmptyState, Icon, KebabMenu, rowClick, SearchBox } from '../../ui';
import { flightSearchText, matchesQuery, passengerNames, splitFlights } from './format';
import { RouteThumb } from './RouteThumb';

const titleOf = (r: FlightListItem) => r.summary.title || 'Untitled flight';

/** PUT a new title, retrying once on a version conflict. '' = automatic title from the route. */
async function renameFlight(id: string, title: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const f: Flight = await api.flights.get(id);
    const { id: _i, version, created: _c, updated: _u, opened: _o, deleted: _d, access: _a, ...doc } = f;
    const auto = autoTitle(doc);
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
    cache: `flights:${trashView ? 'trash' : 'list'}`,
  });
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<FlightListItem | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const { pilot } = useSession();
  const today = localToday();

  const rows = useMemo(() => (data || []).filter((r) => matchesQuery(flightSearchText(r), q)), [data, q]);
  const own = useMemo(() => rows.filter((r) => !r.sharedBy), [rows]);
  const shared = useMemo(() => rows.filter((r) => r.sharedBy), [rows]);
  // flight dates are UTC dates (the flight plan's DOF): before 02:00/03:00 local, the local date is a day ahead
  const { upcoming, past } = useMemo(() => splitFlights(own, todayUtc()), [own]);

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
      toast(`“${titleOf(r)}” restored`, { label: 'Open', onClick: () => void navigate(`/flights/${r.id}`) });
    } catch (e) {
      fail('Could not restore')(e);
    }
    await reload();
  };
  const copy = async (r: FlightListItem) => {
    try {
      const c = await api.flights.copy(r.id);
      await reload();
      toast(`Made “${c.title || c.summary.title}”`, {
        label: 'Open',
        onClick: () => void navigate(`/flights/${c.id}`),
      });
    } catch (e) {
      fail('Could not copy')(e);
    }
  };
  // the same trip on a new day (the next one from today; nothing filed or signed yet), opened at once
  const flyAgain = async (r: FlightListItem) => {
    try {
      const c = await api.flights.copy(r.id, { title: '', date: today });
      void navigate(`/flights/${c.id}`);
    } catch (e) {
      fail('Could not copy')(e);
    }
  };
  // a flight shared with this pilot: their own access ends (the owner can share it again)
  const leave = async (r: FlightListItem) => {
    setData((d) => d?.filter((x) => x.id !== r.id));
    try {
      await api.flightShares.remove(r.id, pilot.id);
      toast(`You left “${titleOf(r)}”`);
    } catch (e) {
      fail('Could not leave the flight')(e);
    }
    await reload();
  };
  const openNewTab = (r: FlightListItem) => window.open(`/flights/${r.id}`, '_blank', 'noopener');

  const onRowClick = (r: FlightListItem) =>
    rowClick((e) => {
      if (trashView) return;
      if (e.metaKey || e.ctrlKey) openNewTab(r);
      else void navigate(`/flights/${r.id}`);
    });

  const row = (r: FlightListItem) => {
    const s = r.summary;
    const date = r.date || s.date;
    const rel = relativeDay(localDepartureDay(date, s.blockOff), today);
    const local = utcToLocalMarked(date, s.blockOff);
    const route = s.from && s.to ? (s.from === s.to ? `Local flight · ${s.from}` : `${s.from} → ${s.to}`) : '';
    const dash = <span className="muted">—</span>;
    const pax = passengerNames(r);
    const items = trashView
      ? [{ label: 'Restore', onSelect: () => void restore(r) }]
      : r.sharedBy
        ? [
            { label: 'Open', onSelect: () => void navigate(`/flights/${r.id}`) },
            { label: 'Fly again', onSelect: () => void flyAgain(r) },
            { label: 'Leave', onSelect: () => void leave(r), danger: true, separator: true },
          ]
        : [
            { label: 'Fly again', onSelect: () => void flyAgain(r) },
            { label: 'Open in new tab', onSelect: () => openNewTab(r), separator: true },
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
          <div className="sub">
            {[route, s.aircraft].filter(Boolean).join(' · ') || 'No route yet'}
            {r.sharedBy && (
              <>
                {' '}
                <Chip
                  sm
                  className="share-chip"
                  testId="flight-shared-by"
                  title={`Shared with you by ${r.sharedBy.name || r.sharedBy.email}${r.sharedBy.name ? ` (${r.sharedBy.email})` : ''}`}
                >
                  {r.role === 'edit' ? 'Can edit' : 'View only'} · {r.sharedBy.name || r.sharedBy.email}
                </Chip>
              </>
            )}
            {r.filingStatus && (
              <>
                {' '}
                <Chip
                  sm
                  tone={r.filingStatus === 'rejected' ? 'danger' : r.filingStatus === 'cancelled' ? undefined : 'ok'}
                  testId="flight-filing"
                >
                  {FILING_STATUS_LABEL[r.filingStatus]}
                </Chip>
              </>
            )}
          </div>
        </div>
        <div className="cell pax hide-sm" data-testid="flight-pax" title={pax || undefined}>
          {pax || dash}
        </div>
        <div className="cell hide-sm">
          <b>{fmtDate(date) || 'No date'}</b>
          {rel && <div className="sub">{rel}</div>}
        </div>
        <div className="cell hide-sm" title={local ? `${local} local time` : undefined}>
          {s.blockOff ? (
            <>
              <b className="tnum">{s.blockOff}Z</b>
              {local && <div className="sub tnum">{local}LT</div>}
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
          <span className="hide-sm">Passengers</span>
          <span className="hide-sm">Date</span>
          <span className="hide-sm">Block start</span>
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
                {section('Shared with me', shared)}
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
  // the automatic name (the date) is the placeholder; an automatic title starts empty
  const auto = autoTitle({ date: row.date || row.summary.date });
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
