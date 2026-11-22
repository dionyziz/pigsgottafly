// The server's briefing for the saved flight (PLAN-v3).
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  groupNotams,
  type Notam,
  notamLimits,
  notamSourcesLine,
  notamSubject,
  notamValidity,
  notamWhere,
  visibleNotams,
} from '../../../data/notams';
import { aerodrome } from '../../../data/ref';
import { fmtClockMs } from '../../../shared/format';
import { Chip, Collapsible, Icon } from '../../../ui';
import { useNotams } from '../notams';
import { useEditor } from '../state';
import { Section } from './ui';

/** Which NOTAM groups (aerodromes, airspace) are collapsed, per browser. */
const NOTAM_GROUPS_STORE = 'pgf.editor.notamGroups';

const fmtFetched = (ms: number | null): string => (ms ? fmtClockMs(ms, { z: true }) : '');

function NotamItem({
  n,
  selected,
  onSelect,
  onHover,
}: {
  n: Notam;
  selected: boolean;
  onSelect: () => void;
  /** The pointer over it (its area is outlined on the map) or gone. */
  onHover: (on: boolean) => void;
}) {
  const [raw, setRaw] = useState(false);
  const el = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) el.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  return (
    <li
      ref={el}
      className={'ep-notam' + (n.relevant ? '' : ' hidden-notam') + (selected ? ' selected' : '')}
      data-testid="notam"
      data-key={n.key}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button type="button" className="ep-notam-head" onClick={onSelect} aria-pressed={selected}>
        <span className="ep-notam-key mono">{n.key}</span>
        <span className="ep-notam-where">{notamWhere(n)}</span>
        <span className="spacer" />
        {n.legIndex !== null && <span className="ep-notam-leg">leg {n.legIndex + 1}</span>}
      </button>
      <div className="ep-notam-subject">{notamSubject(n)}</div>
      <div className="ep-notam-meta mono">
        <span>{notamValidity(n)}</span>
        <span>{notamLimits(n)}</span>
        {n.schedule && <span>{n.schedule}</span>}
      </div>
      <p className="ep-notam-text">{n.text}</p>
      {n.reasons.length > 0 && (
        <div className={'ep-notam-why' + (n.relevant ? '' : ' muted')}>
          {n.relevant ? '' : 'Hidden: '}
          {n.reasons.join(' · ')}
        </div>
      )}
      <button type="button" className="linkish ep-notam-rawbtn" onClick={() => setRaw((v) => !v)} aria-expanded={raw}>
        {raw ? 'Hide ICAO text' : 'ICAO text'}
      </button>
      {raw && (
        <pre className="ep-notam-raw" data-testid="notam-raw">
          {n.raw}
        </pre>
      )}
    </li>
  );
}

export function NotamSection() {
  const { briefing, loading, error, refresh, showAll, setShowAll, selected, select, hover } = useNotams();
  const list = visibleNotams(briefing, showAll);
  // the departure and the destination always have their group, even with no NOTAM
  const route = useEditor().doc.route;
  const always = useMemo(() => {
    const icaoOf = (p: (typeof route)[number] | undefined) =>
      p?.kind === 'aerodrome' ? (aerodrome(p.refId ?? p.name)?.icao ?? null) : null;
    return [icaoOf(route[0]), icaoOf(route[route.length - 1])].filter((x): x is string => !!x);
  }, [route]);
  const ok = briefing?.status === 'ok';
  const sourcesLine = briefing ? notamSourcesLine(briefing) : null;
  const badge =
    loading && !briefing ? (
      <span className="muted">Loading…</span>
    ) : ok ? (
      briefing.relevantCount ? (
        <Chip tone="warn">{briefing.relevantCount}</Chip>
      ) : (
        <span className="muted">none relevant</span>
      )
    ) : briefing ? (
      <span className="muted">not loaded</span>
    ) : undefined;

  return (
    <Section
      edits={false}
      id="notams"
      title="NOTAMs"
      badge={badge}
      actions={
        <button
          type="button"
          className="icon"
          title="Reload NOTAMs"
          aria-label="Reload NOTAMs"
          onClick={refresh}
          disabled={loading}
          data-testid="notams-refresh"
        >
          <Icon name="refresh" />
        </button>
      }
    >
      <div className="ep-notams" data-testid="notams">
        {error && <p className="ep-note warn-text">{error}</p>}
        {!briefing && !error && (
          <p className="ep-note muted">{loading ? 'Loading the NOTAM briefing…' : 'No route.'}</p>
        )}
        {briefing && briefing.status !== 'ok' && (
          <p className="ep-note warn-text" data-testid="notams-status">
            {briefing.message}
          </p>
        )}
        {briefing && ok && (
          <>
            <p className="ep-note muted" data-testid="notams-meta">
              {briefing.notams.length} NOTAM{briefing.notams.length === 1 ? '' : 's'}
              {sourcesLine?.from ? ` from ${sourcesLine.from}` : ''}
              {sourcesLine?.failed.length ? ` (${sourcesLine.failed.join(', ')})` : ''}, fetched{' '}
              {fmtFetched(briefing.fetched)} · below {Math.round(briefing.params.maxAltFt)} ft,{' '}
              {briefing.params.corridorNm} NM either side
            </p>
            {briefing.message && <p className="ep-note warn-text">{briefing.message}</p>}
            {list.length > 0 || always.length > 0 ? (
              groupNotams(list, always).map((g) => (
                <Collapsible
                  key={g.icao ?? ''}
                  id={`notams-${g.icao ?? 'airspace'}`}
                  store={NOTAM_GROUPS_STORE}
                  className="ep-notam-group"
                  testId={`notam-group-${g.icao ?? 'airspace'}`}
                  openWhen={g.notams.some((n) => n.key === selected)}
                  title={
                    g.icao ? (
                      <>
                        <span className="mono">{g.icao}</span>{' '}
                        <span className="muted ep-notam-group-name">{aerodrome(g.icao)?.name ?? ''}</span>
                      </>
                    ) : (
                      'Airspace'
                    )
                  }
                  badge={<span className="muted tnum">{g.notams.length}</span>}
                >
                  {g.notams.length === 0 && <p className="ep-note muted">No relevant NOTAMs.</p>}
                  <ul className="ep-notam-list">
                    {g.notams.map((n) => (
                      <NotamItem
                        key={n.key}
                        n={n}
                        selected={selected === n.key}
                        onSelect={() => select(selected === n.key ? null : n.key)}
                        onHover={(on) => hover(on ? n.key : null)}
                      />
                    ))}
                  </ul>
                </Collapsible>
              ))
            ) : (
              <p className="ep-note muted">No NOTAM concerns this flight.</p>
            )}
            {briefing.hiddenCount > 0 && (
              <button
                type="button"
                className="linkish ep-link"
                onClick={() => setShowAll(!showAll)}
                data-testid="notams-show-all"
              >
                {showAll ? 'Show only the relevant ones' : `Show all (${briefing.hiddenCount} hidden)`}
              </button>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
