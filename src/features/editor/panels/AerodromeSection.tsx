// Aerodrome hours: each aerodrome of the route (departure, stops, touch-and-goes, destination) with
// its status at the planned time there, its hours, ATS and handling on the flight's date (AIP AD 2.3 /
// AD 1.6 + the flight's NOTAMs, marked by NOTAM id) and the AIP text. Warnings for a closed
// aerodrome are in the warnings list (calc.tsx) and on the map.
import { useMemo } from 'react';
import { clockZ } from '../../../calc';
import { useEditor } from '../state';
import { AdHoursDetail, adDayInfo } from '../AerodromeHours';
import { AD_ROLE, useFlightCalc, type AdCheck } from './calc';
import { Chip, Section } from './ui';

function StatusChip({ c }: { c: AdCheck }) {
  if (!Number.isFinite(c.fromMs)) return <span className="muted">time not set</span>;
  const s = c.ad.status;
  return (
    <Chip tone={s === 'open' ? 'ok' : s === 'closed' ? 'danger' : undefined} title={`${c.ad.why} (${c.ad.source})`}>
      {s === 'open' ? 'Open' : s === 'closed' ? `Closed ${clockZ(c.ad.at)}Z` : 'Hours not known'}
    </Chip>
  );
}

export function AerodromeSection() {
  const { doc } = useEditor();
  const { aerodromeChecks, adEffects } = useFlightCalc();
  const items = useMemo(() => aerodromeChecks.map((c) => ({ c, info: adDayInfo(c.aerodrome, doc.date, adEffects) })), [aerodromeChecks, adEffects, doc.date]);
  const closed = aerodromeChecks.filter((c) => c.ad.status === 'closed' && Number.isFinite(c.fromMs)).length;
  return (
    <Section id="aerodromes" title="Aerodrome hours"
      badge={closed ? <Chip tone="danger">{closed} closed</Chip> : items.length ? <span className="muted">{items.length}</span> : undefined}>
      {!items.length ? <p className="ep-note muted">Add aerodromes to the route to see their hours.</p> : (
        <ul className="ep-ad-list" data-testid="aerodrome-hours">
          {items.map(({ c, info }) => (
            <li key={`${c.role}-${c.pointIndex}`} className={'ep-ad' + (c.ad.status === 'closed' && Number.isFinite(c.fromMs) ? ' is-closed' : '')} data-testid="aerodrome-hours-item" data-icao={c.aerodrome.icao ?? c.aerodrome.id}>
              <div className="ep-ad-head">
                <b>{AD_ROLE[c.role]} {c.aerodrome.icao || c.aerodrome.name}</b>
                <span className="muted ep-ad-name">{c.aerodrome.name}</span>
                <span className="spacer" />
                <StatusChip c={c} />
              </div>
              {Number.isFinite(c.fromMs) && <div className="ep-ad-when muted">{c.when}{c.ad.notam ? ` · NOTAM ${c.ad.notam}` : ''}</div>}
              <AdHoursDetail a={c.aerodrome} info={info} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
