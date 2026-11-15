// Flight editor: full-window map, left panel, collapsible navlog strip at the bottom.
// Layout slots: <MapView/> (map agent, ./map), <FlightPanel/> and <NavlogStrip/> (screens agent,
// ./panels). This page (screens agent) loads the flight and wires keyboard undo/redo.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../../app/session';
import { AccountMenu } from '../../app/AccountMenu';
import { ErrorBoundary } from '../../app/ErrorBoundary';
import { api, ApiRequestError } from '../../data/api';
import { flightStore } from '../../data/flightStore';
import type { Aircraft, Flight, FlightDoc, Passenger, Waypoint } from '../../shared';
import { EditorProvider, useEditor } from './state';
import { MapView } from './map';
import { FlightPanel, NavlogStrip } from './panels';
import './editor.css';

function SaveState() {
  const { saveStatus } = useEditor();
  const text = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'offline' ? 'Offline · saved on this device' : saveStatus === 'error' ? 'Not saved' : 'Saved';
  return <span className="muted" data-testid="save-state" style={{ fontSize: 'var(--fs-sm)' }}>{text}</span>;
}

function Title() {
  const { doc } = useEditor();
  return <span className="editor-title" data-testid="flight-title">{doc.summary.title || doc.title || 'Untitled flight'}</span>;
}

function Keys() {
  const { undo, redo } = useEditor();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
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
    flightStore.load(id).then((r) => setState(r ?? 'missing'), (e) => setError(e instanceof ApiRequestError && e.offline ? 'Offline, and this flight is not on this device.' : String(e.message)));
    reloadLists().catch(() => setLists({ hangar: [], passengers: [], waypoints: [] }));
  }, [id]);

  if (error) return <div className="loading-screen">{error}</div>;
  if (state === 'missing') return <div className="loading-screen"><div className="stack" style={{ alignItems: 'center' }}><p>That flight was not found.</p><Link to="/">All flights</Link></div></div>;
  if (!state || !lists) return <div className="loading-screen">Loading flight…</div>;

  return (
    <EditorProvider flight={state.flight} initialDoc={state.doc} pilot={pilot} {...lists} reloadLists={reloadLists}>
      <Keys />
      <div className="editor" data-testid="editor">
        <header className="editor-top">
          <Link to="/" className="brand" title="All flights"><img src="/icon.svg" alt="" /></Link>
          <Title />
          <SaveState />
          <span className="spacer" />
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
    </EditorProvider>
  );
}
