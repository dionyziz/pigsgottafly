// Saving (debounced, versioned, offline-tolerant, 409 = last writer wins) is flightStore's job, driven by
// EditorProvider.update().
import './editor.css';
import './panels/panels.css';

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { AccountMenu } from '../../app/AccountMenu';
import { ErrorBoundary } from '../../app/ErrorBoundary';
import { useSession } from '../../app/session';
import { flightTitle, usePageTitle } from '../../app/title';
import { api, ApiRequestError } from '../../data/api';
import { useEntity } from '../../data/entities';
import { flightStore } from '../../data/flightStore';
import { useAsync } from '../../data/useAsync';
import { autoTitle, type Flight, type FlightDoc } from '../../shared';
import { FILING_STATUS_LABEL } from '../../shared/briefing';
import { fmtClockMs } from '../../shared/format';
import { manifestContacts } from '../../shared/sharing';
import { Chip, Icon, Loading } from '../../ui';
import { ShareDialog } from '../hangar/ShareDialog';
import { focusSection, onEditorFocus } from './focus';
import { LegHoverProvider } from './legHover';
import { MapView } from './map';
import { NotamProvider } from './notams';
import { FlightCalcProvider, FlightPanel, NavlogStrip } from './panels';
import { useResizable } from './resizable';
import { EditorProvider, useEditor } from './state';

function EditorTitle() {
  const { doc } = useEditor();
  usePageTitle(flightTitle(doc));
  return null;
}

function FilingChip() {
  const { flight } = useEditor();
  const q = useAsync(() => api.filing.get(flight.id), [flight.id], {
    cache: `filing:${flight.id}`,
    refetchOnFocus: true,
    invalidatedBy: 'flights',
  });
  const f = q.data?.filing;
  if (!f) return null;
  const tone = f.status === 'rejected' ? 'danger' : f.status === 'cancelled' ? undefined : 'ok';
  return (
    <button type="button" className="ep-chip-btn" onClick={() => focusSection('filing')} data-testid="filing-chip">
      <Chip tone={tone}>
        {FILING_STATUS_LABEL[f.status]}
        {f.eobt != null && f.status !== 'cancelled' ? ` ${fmtClockMs(f.eobt, { z: true })}` : ''}
      </Chip>
    </button>
  );
}

function SaveState() {
  const { saveStatus } = useEditor();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const s = !online && saveStatus !== 'error' ? 'offline' : saveStatus;
  const text =
    s === 'saving'
      ? 'Saving…'
      : s === 'offline'
        ? 'Offline · saved on this device'
        : s === 'error'
          ? 'Not saved'
          : 'Saved';
  const title =
    s === 'error' ? 'The server rejected the last change. Reload the page to see the saved version.' : undefined;
  return (
    <span className={'save-state ' + s} data-testid="save-state" title={title} role="status">
      <span className="save-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

function SharedFlightChip() {
  const { flight } = useEditor();
  const a = flight.access;
  if (!a) return null;
  const by = a.owner.name || a.owner.email;
  return (
    <Chip
      className="share-chip"
      title={`Shared with you by ${by}${a.owner.email && a.owner.name ? ` (${a.owner.email})` : ''}${a.role === 'view' ? ': you can view it, not change it' : ''}`}
      testId="view-only-chip"
    >
      {a.role === 'view' ? `View only · shared by ${by}` : `Shared by ${by}`}
    </Chip>
  );
}

function ShareButton() {
  const { flight, doc, passengers } = useEditor();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <button type="button" className="sm" onClick={() => setOpen(true)} data-testid="share-flight">
        Share
      </button>
      {open && (
        <ShareDialog
          kind="flight"
          id={flight.id}
          name={flight.title.trim() || autoTitle(flight)}
          onClose={() => setOpen(false)}
          onLeft={() => void navigate('/')}
          passengers={manifestContacts(doc.crew, passengers)}
        />
      )}
    </>
  );
}

/** Empty = automatic (from the route). */
function Title() {
  const { doc, update, readOnly } = useEditor();
  const [editing, setEditing] = useState(false);
  const auto = autoTitle(doc);
  if (readOnly)
    return (
      <span className="editor-title" data-testid="flight-title">
        {doc.title.trim() || auto}
      </span>
    );
  if (!editing) {
    return (
      <button
        type="button"
        className="editor-title"
        data-testid="flight-title"
        title="Rename"
        onClick={() => setEditing(true)}
      >
        {doc.title.trim() || auto}
      </button>
    );
  }
  return (
    <input
      className="editor-title"
      data-testid="flight-title-input"
      aria-label="Flight title"
      autoFocus
      onFocus={(e) => e.target.select()}
      value={doc.title}
      placeholder={auto}
      size={Math.max(16, Math.min(60, (doc.title || auto).length + 2))}
      onChange={(e) => update((d) => ({ ...d, title: e.target.value }), { coalesce: 'title' })}
      onBlur={(e) => {
        setEditing(false);
        const t = e.target.value.trim();
        if (t !== doc.title) update((d) => ({ ...d, title: t }), { coalesce: 'title' });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function UndoRedo() {
  const { undo, redo, canUndo, canRedo, readOnly } = useEditor();
  if (readOnly) return null;
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? '⌘' : 'Ctrl+';
  return (
    <span className="row" style={{ gap: 0 }}>
      <button
        type="button"
        className="icon"
        onClick={undo}
        disabled={!canUndo}
        title={`Undo (${mod}Z)`}
        aria-label="Undo"
        data-testid="undo"
      >
        <Icon name="undo" size={18} />
      </button>
      <button
        type="button"
        className="icon"
        onClick={redo}
        disabled={!canRedo}
        title={`Redo (${mac ? '⇧⌘Z' : 'Ctrl+Y'})`}
        aria-label="Redo"
        data-testid="redo"
      >
        <Icon name="redo" size={18} />
      </button>
    </span>
  );
}

function Keys() {
  const { undo, redo } = useEditor();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  // send pending edits when leaving the page
  useEffect(
    () => () => {
      void flightStore.flushNow();
    },
    [],
  );
  return null;
}

export function EditorPage() {
  const { id = '' } = useParams();
  const { pilot } = useSession();
  const [state, setState] = useState<{ flight: Flight; doc: FlightDoc } | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);
  const hangar = useEntity('aircraft');
  const passengers = useEntity('passengers');
  const waypoints = useEntity('waypoints');
  const { reload: reloadHangar } = hangar,
    { reload: reloadPassengers } = passengers,
    { reload: reloadWaypoints } = waypoints;
  const reloadLists = useCallback(async () => {
    await Promise.all([reloadHangar(), reloadPassengers(), reloadWaypoints()]);
  }, [reloadHangar, reloadPassengers, reloadWaypoints]);
  useEffect(() => {
    // this device's copy opens at once; the server's replaces it only when it is newer and nothing was
    // edited meanwhile (a change made on another device)
    const quick = flightStore.peek(id);
    setState(quick);
    setError(null);
    flightStore.load(id).then(
      (r) =>
        setState((cur) =>
          !r
            ? 'missing'
            : !cur || cur === 'missing' || (cur.flight.version !== r.flight.version && !flightStore.hasUnsent(id))
              ? r
              : // this device's copy stays, with the access the server gives now (a role may have changed)
                { ...cur, flight: { ...cur.flight, access: r.flight.access } },
        ),
      (e) => {
        if (quick) return; // offline: this device's copy stays open
        setError(
          e instanceof ApiRequestError && e.offline
            ? 'Offline, and this flight is not on this device.'
            : String(e.message),
        );
      },
    );
  }, [id]);
  // a list that failed to load counts as empty (the editor still opens)
  const listsReady = !hangar.loading && !passengers.loading && !waypoints.loading;

  if (error)
    return (
      <div className="loading-screen">
        <div className="stack" style={{ alignItems: 'center' }}>
          <p>{error}</p>
          <Link to="/">All flights</Link>
        </div>
      </div>
    );
  if (state === 'missing')
    return (
      <div className="loading-screen">
        <div className="stack" style={{ alignItems: 'center' }}>
          <p>Flight not found.</p>
          <Link to="/">All flights</Link>
        </div>
      </div>
    );
  if (!state || !listsReady) return <Loading variant="screen" label="Loading flight…" />;

  return (
    <EditorProvider
      key={`${state.flight.id}:${state.flight.version}`}
      flight={state.flight}
      initialDoc={state.doc}
      pilot={pilot}
      hangar={hangar.data ?? NONE}
      passengers={passengers.data ?? NONE}
      waypoints={waypoints.data ?? NONE}
      passengersLoaded={passengers.data !== undefined}
      reloadLists={reloadLists}
    >
      <NotamProvider>
        <FlightCalcProvider>
          <LegHoverProvider>
            <Keys />
            <div className="editor" data-testid="editor">
              <header className="editor-top">
                <Link to="/" className="brand" title="All flights">
                  <img src="/icon.svg" alt="All flights" />
                </Link>
                <Title />
                <SaveState />
                <SharedFlightChip />
                <EditorTitle />
                <FilingChip />
                <span className="spacer" />
                <UndoRedo />
                <ShareButton />
                <AccountMenu />
              </header>
              <div className="editor-body">
                <ResizablePanel />
                <div className="editor-main">
                  <div className="editor-map">
                    <ErrorBoundary label="The map failed">
                      <MapView />
                    </ErrorBoundary>
                  </div>
                  <ErrorBoundary label="The navlog failed">
                    <NavlogStrip />
                  </ErrorBoundary>
                </div>
              </div>
            </div>
          </LegHoverProvider>
        </FlightCalcProvider>
      </NotamProvider>
    </EditorProvider>
  );
}

const NONE: never[] = [];

const COLLAPSED_KEY = 'pgf.editor.panelCollapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

function ResizablePanel() {
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const r = useResizable({
    key: 'pgf.editor.panelWidth',
    axis: 'x',
    dir: 1,
    min: 280,
    max: () => Math.max(320, Math.round(window.innerWidth * 0.6)),
    initial: null,
    collapseBelow: 180,
    onCollapse: () => setCollapsed(true),
  });
  // a warning's fix focuses a field of the panel: show the panel first
  useEffect(() => onEditorFocus(() => setCollapsed(false)), []);
  const label = collapsed ? 'Show the flight panel' : 'Hide the flight panel';
  return (
    <>
      <aside
        id="editor-panel"
        className={'editor-panel' + (collapsed ? ' is-collapsed' : '')}
        ref={(el) => {
          r.panelRef.current = el;
        }}
        style={r.size != null ? { width: r.size } : undefined}
        hidden={collapsed}
        data-testid="editor-panel"
      >
        <ErrorBoundary label="The panel failed">
          <FlightPanel />
        </ErrorBoundary>
      </aside>
      <div className={'editor-edge' + (collapsed ? ' is-collapsed' : '')}>
        {!collapsed && <div {...r.handleProps} aria-label="Resize the flight panel" data-testid="resize-panel" />}
        <button
          type="button"
          className="editor-collapse"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls="editor-panel"
          aria-label={label}
          title={label}
          data-testid="panel-collapse"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d={collapsed ? 'M3.5 1.5 7 5l-3.5 3.5' : 'M6.5 1.5 3 5l3.5 3.5'}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </>
  );
}
