// NOTAMs relevant to the flight (PLAN-v3): the server's briefing for the saved flight, decoded
// (subject, validity, limits, item E) with the raw ICAO text one click away; the hidden ones behind
// "Show all (N hidden)" with the reason each is hidden. Picking one highlights its area on the map
// and its leg in the navlog strip.
import { useEffect, useRef, useState } from 'react';
import { notamLimits, notamSubject, notamValidity, notamWhere, visibleNotams, type Notam } from '../../../data/notams';
import { useNotams } from '../notams';
import { fmtClockMs } from '../../../shared/format';
import { Chip, Icon } from '../../../ui';
import { Section } from './ui';

const fmtFetched = (ms: number | null): string => (ms ? fmtClockMs(ms, { z: true }) : '');

function NotamItem({ n, selected, onSelect }: { n: Notam; selected: boolean; onSelect(): void }) {
  const [raw, setRaw] = useState(false);
  const el = useRef<HTMLLIElement>(null);
  useEffect(() => { if (selected) el.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [selected]);
  return (
    <li ref={el} className={'ep-notam' + (n.relevant ? '' : ' hidden-notam') + (selected ? ' selected' : '')} data-testid="notam" data-key={n.key}>
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
      {n.reasons.length > 0 && <div className={'ep-notam-why' + (n.relevant ? '' : ' muted')}>{n.relevant ? '' : 'Hidden: '}{n.reasons.join(' · ')}</div>}
      <button type="button" className="linkish ep-notam-rawbtn" onClick={() => setRaw((v) => !v)} aria-expanded={raw}>{raw ? 'Hide ICAO text' : 'ICAO text'}</button>
      {raw && <pre className="ep-notam-raw" data-testid="notam-raw">{n.raw}</pre>}
    </li>
  );
}

export function NotamSection() {
  const { briefing, loading, error, refresh, showAll, setShowAll, selected, select } = useNotams();
  const list = visibleNotams(briefing, showAll);
  const ok = briefing?.status === 'ok';
  const badge = loading && !briefing ? <span className="muted">Loading…</span>
    : ok ? (briefing!.relevantCount ? <Chip tone="warn">{briefing!.relevantCount}</Chip> : <span className="muted">none relevant</span>)
    : briefing ? <span className="muted">not loaded</span> : undefined;

  return (
    <Section
      id="notams"
      title="NOTAMs"
      badge={badge}
      actions={<button type="button" className="icon" title="Reload NOTAMs" aria-label="Reload NOTAMs" onClick={refresh} disabled={loading} data-testid="notams-refresh"><Icon name="refresh" /></button>}
    >
      <div className="ep-notams" data-testid="notams">
        {error && <p className="ep-note warn-text">{error}</p>}
        {!briefing && !error && <p className="ep-note muted">{loading ? 'Loading the NOTAM briefing…' : 'Draw a route to load the NOTAMs along it.'}</p>}
        {briefing && briefing.status !== 'ok' && <p className="ep-note warn-text" data-testid="notams-status">{briefing.message}</p>}
        {briefing && ok && (
          <>
            <p className="ep-note muted">
              {briefing.notams.length} NOTAM{briefing.notams.length === 1 ? '' : 's'} for {briefing.locations.join(' ')}, fetched {fmtFetched(briefing.fetched)}
              {' '}· below {Math.round(briefing.params.maxAltFt)} ft, {briefing.params.corridorNm} NM either side
            </p>
            {briefing.message && <p className="ep-note warn-text">{briefing.message}</p>}
            {list.length > 0 ? (
              <ul className="ep-notam-list">
                {list.map((n) => <NotamItem key={n.key} n={n} selected={selected === n.key} onSelect={() => select(selected === n.key ? null : n.key)} />)}
              </ul>
            ) : <p className="ep-note muted">No NOTAM concerns this flight.</p>}
            {briefing.hiddenCount > 0 && (
              <button type="button" className="linkish ep-link" onClick={() => setShowAll(!showAll)} data-testid="notams-show-all">
                {showAll ? 'Show only the relevant ones' : `Show all (${briefing.hiddenCount} hidden)`}
              </button>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
