// NOTAM briefing of the flight in the editor, shared by the NOTAM panel section, the map layer and
// the navlog strip (which highlights the leg of the NOTAM picked on the map or in the panel).
//
// The server assesses the NOTAMs against the SAVED flight (route, times, altitudes), so the
// briefing is (re)loaded once the editor's changes are saved and the route/times/altitudes changed.
// <NotamProvider> sits inside <EditorProvider> (EditorPage); read with useNotams().
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiRequestError } from '../../data/api';
import { fetchNotams, lastNotams, type Notam, type NotamBriefing } from '../../data/notams';
import { useEditor } from './state';

export interface NotamState {
  briefing: NotamBriefing | null;
  loading: boolean;
  /** Request failure (network, server), null when fine. A source failure is briefing.status 'error'. */
  error: string | null;
  refresh: () => void;
  /** Hidden (not relevant) NOTAMs shown too, in the panel and on the map. */
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  /** NOTAM picked on the map or in the panel (its key), null = none. */
  selected: string | null;
  select: (key: string | null) => void;
  selectedNotam: Notam | null;
}

const NotamContext = createContext<NotamState | null>(null);

const EMPTY: NotamState = {
  briefing: null,
  loading: false,
  error: null,
  refresh: () => {},
  showAll: false,
  setShowAll: () => {},
  selected: null,
  select: () => {},
  selectedNotam: null,
};

/** The editor's NOTAM state; outside a <NotamProvider> an empty, inert state. */
export function useNotams(): NotamState {
  return use(NotamContext) ?? EMPTY;
}

/** Wait this long after the last saved change before asking the server again. */
const DEBOUNCE_MS = 1200;

export function NotamProvider({ children }: { children: ReactNode }) {
  const { flight, doc, saveStatus } = useEditor();
  const [briefing, setBriefing] = useState<NotamBriefing | null>(() => lastNotams(flight.id) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [force, setForce] = useState(0);
  const seq = useRef(0);

  // What the server's assessment depends on.
  const key = useMemo(
    () =>
      JSON.stringify([
        doc.date,
        doc.blockOff,
        doc.taxiOutMin,
        doc.taxiInMin,
        doc.aircraftId,
        doc.route.map((p) => [p.lat.toFixed(4), p.lon.toFixed(4), p.refId]),
        Object.entries(doc.legOverrides).map(([k, o]) => [k, o?.altFt ?? null]),
      ]),
    [doc.date, doc.blockOff, doc.taxiOutMin, doc.taxiInMin, doc.aircraftId, doc.route, doc.legOverrides],
  );
  const settled = saveStatus === 'saved';
  const routeLen = doc.route.length;

  useEffect(() => {
    if (!settled) return;
    if (routeLen === 0) {
      setBriefing(null);
      setLoading(false);
      setError(null);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      fetchNotams(flight.id, { refresh: force > 0 }).then(
        (b) => {
          if (my !== seq.current) return;
          setBriefing(b);
          setError(null);
          setLoading(false);
        },
        (e) => {
          if (my !== seq.current) return;
          setLoading(false);
          setError(
            e instanceof ApiRequestError && e.offline
              ? 'Offline: NOTAMs not loaded.'
              : `NOTAMs could not be loaded (${(e as Error).message}).`,
          );
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key, settled, routeLen, flight.id, force]);

  const refresh = useCallback(() => setForce((x) => x + 1), []);
  const select = useCallback((k: string | null) => setSelected(k), []);
  const selectedNotam = useMemo(
    () => (selected && briefing ? (briefing.notams.find((n) => n.key === selected) ?? null) : null),
    [selected, briefing],
  );
  // a NOTAM that left the briefing is no longer selected
  useEffect(() => {
    if (selected && briefing && !briefing.notams.some((n) => n.key === selected)) setSelected(null);
  }, [selected, briefing]);

  const value = useMemo<NotamState>(
    () => ({
      briefing,
      loading,
      error,
      refresh,
      showAll,
      setShowAll,
      selected,
      select,
      selectedNotam,
    }),
    [briefing, loading, error, refresh, showAll, selected, select, selectedNotam],
  );
  return <NotamContext value={value}>{children}</NotamContext>;
}
