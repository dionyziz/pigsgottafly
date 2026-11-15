// Flight editor: full-window map, left panel, collapsible navlog strip at the bottom.
// Layout slots: <MapView/> (map agent, ./map), <FlightPanel/> and <NavlogStrip/> (./panels).
// This page loads the flight, shows the editable title and save state, and wires undo/redo.
// Saving (debounced, versioned, offline-tolerant, 409 = last writer wins) is flightStore's job,
// driven by EditorProvider.update().
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../../app/session';
import { AccountMenu } from '../../app/AccountMenu';
import { ErrorBoundary } from '../../app/ErrorBoundary';
import { api, ApiRequestError } from '../../data/api';
import { flightStore } from '../../data/flightStore';
import { autoTitle, type Aircraft, type Flight, type FlightDoc, type Passenger, type Waypoint } from '../../shared';
import { EditorProvider, useEditor } from './state';
import { MapView } from './map';
import { FlightCalcProvider, FlightPanel, NavlogStrip } from './panels';
import { Icon } from './panels/ui';
import './editor.css';
import './panels/panels.css';

function SaveState() {
  const { saveStatus } = useEditor();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const s = !online && saveStatus !== 'error' ? 'offline' : saveStatus;
  const text = s === 'saving' ? 'Saving…' : s === 'offline' ? 'Offline · saved on this device' : s === 'error' ? 'Not saved' : 'Saved';
  const title = s === 'offline'
    ? 'Your changes are kept on this device and sent when the connection returns.'
    : s === 'error' ? 'The server rejected the last change. Reload the page to see the saved version.' : undefined;
  return (
    <span className={'save-state ' + s} data-testid="save-state" title={title} role="status">
      <span className="save-dot" aria-hidden="true" />{text}
    </span>
  );
}

/** The title: shown as text, edited in place on click. Empty = automatic (from the route). */
function Title() {
  const { doc, update } = useEditor();
  const [editing, setEditing] = useState(false);
  const auto = autoTitle(doc.route);
  if (!editing) {
    return (
      <button type="button" className="editor-title" data-testid="flight-title" title="Rename" onClick={() => setEditing(true)}>
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
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function UndoRedo() {
  const { undo, redo, canUndo, canRedo } = useEditor();
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? '⌘' : 'Ctrl+';
  return (
    <span className="row" style={{ gap: 0 }}>
      <button type="button" className="icon" onClick={undo} disabled={!canUndo} title={`Undo (${mod}Z)`} aria-label="Undo" data-testid="undo"><Icon name="undo" size={18} /></button>
      <button type="button" className="icon" onClick={redo} disabled={!canRedo} title={`Redo (${mac ? '⇧⌘Z' : 'Ctrl+Y'})`} aria-label="Redo" data-testid="redo"><Icon name="redo" size={18} /></button>
    </span>
  );
}

function Keys() {
  const { undo, redo } = useEditor();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  // send pending edits when leaving the page
  useEffect(() => () => { void flightStore.flushNow(); }, []);
  return null;
}

export function EditorPage() {
  const { id = '' } = useParams();
  const { pilot } = useSession();
  const [state, setState] = useState<{ flight: Flight; doc: FlightDoc } | null | 'missing'>(null);
  const [lists, setLists] = useState<{ hangar: Aircraft[]; passengers: Passenger[]; waypoints: Waypoint[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadLists = async () => {
    const [hangar, passengers, waypoints] = await Promise.all([api.aircraft.list(), api.passengers.list(), api.waypoints.list()]);
    setLists({ hangar, passengers, waypoints });
  };
  useEffect(() => {
    setState(null);
    setError(null);
    flightStore.load(id).then(
      (r) => setState(r ?? 'missing'),
      (e) => setError(e instanceof ApiRequestError && e.offline ? 'Offline, and this flight is not on this device.' : String(e.message)),
    );
    reloadLists().catch(() => setLists((l) => l ?? { hangar: [], passengers: [], waypoints: [] }));
  }, [id]);

  if (error) return <div className="loading-screen"><div className="stack" style={{ alignItems: 'center' }}><p>{error}</p><Link to="/">All flights</Link></div></div>;
  if (state === 'missing') return <div className="loading-screen"><div className="stack" style={{ alignItems: 'center' }}><p>That flight was not found.</p><Link to="/">All flights</Link></div></div>;
  if (!state || !lists) return <div className="loading-screen">Loading flight…</div>;

  return (
    <EditorProvider key={state.flight.id} flight={state.flight} initialDoc={state.doc} pilot={pilot} {...lists} reloadLists={reloadLists}>
      <FlightCalcProvider>
        <Keys />
        <div className="editor" data-testid="editor">
          <header className="editor-top">
            <Link to="/" className="brand" title="All flights"><img src="/icon.svg" alt="All flights" /></Link>
            <Title />
            <SaveState />
            <span className="spacer" />
            <UndoRedo />
            <AccountMenu />
          </header>
          <div className="editor-body">
            <aside className="editor-panel"><ErrorBoundary label="The panel failed"><FlightPanel /></ErrorBoundary></aside>
            <div className="editor-main">
              <div className="editor-map"><ErrorBoundary label="The map failed"><MapView /></ErrorBoundary></div>
              <ErrorBoundary label="The navlog failed"><NavlogStrip /></ErrorBoundary>
            </div>
          </div>
        </div>
      </FlightCalcProvider>
    </EditorProvider>
  );
}
