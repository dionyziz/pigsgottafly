// METAR: the latest reports at the route's aerodromes and those near it, while the flight is about
// to start or under way (metarStations.ts); fetched again every few minutes while the box is shown.
import { useEffect, useMemo, useState } from 'react';

import { REF } from '../../../data/ref';
import { fetchMetarTaf, type MetarTafResult } from '../../../data/weatherMetar';
import { useEditor } from '../state';
import { useFlightCalc } from './calc';
import { metarBoxShown, type MetarStation, metarStations } from './metarStations';
import { Section } from './ui';

const REFETCH_MS = 5 * 60 * 1000;
/** Older than this, the report's age is shown as a warning. */
const STALE_MS = 75 * 60 * 1000;

const ROLE: Record<MetarStation['role'], string> = {
  departure: 'Departure',
  stop: 'Stop',
  destination: 'Destination',
  area: '',
};

function age(ms: number, now: number): string {
  const min = Math.max(0, Math.round((now - ms) / 60000));
  return min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ${min % 60} min ago`;
}

/** The time, updated every minute (the ages, and when to fetch again). */
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function MetarSection() {
  const { doc } = useEditor();
  const { departure, arrival, stops } = useFlightCalc();
  const now = useClock();
  const shown = metarBoxShown(doc.date, departure.timeMs, arrival.timeMs, now);

  const stations = useMemo(
    () =>
      metarStations(
        [departure.aerodrome, ...stops.map((s) => s.aerodrome), arrival.aerodrome],
        doc.route,
        REF.aerodromes,
      ),
    [departure.aerodrome, arrival.aerodrome, stops, doc.route],
  );
  const key = shown ? stations.map((s) => s.icao).join(',') : '';
  const round = Math.floor(now / REFETCH_MS);
  const [reports, setReports] = useState<MetarTafResult | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void fetchMetarTaf(key.split(',')).then((r) => {
      if (live) setReports(r);
    });
    return () => {
      live = false;
    };
  }, [key, round]);

  if (!shown) return null;
  const rows = stations
    .map((s) => {
      const r = reports?.stations[s.icao];
      return r?.metar && !r.metar.nil ? { s, metar: r.metar, observedMs: r.observedMs } : null;
    })
    .filter((x) => x != null);
  if (!rows.length) return null;

  return (
    <Section id="metar" title="METAR" badge={<span className="muted">{rows.length}</span>}>
      <ul className="ep-metars" data-testid="metar-list">
        {rows.map(({ s, metar: m, observedMs }) => (
          <li key={s.icao} data-icao={s.icao} data-role={s.role}>
            <div className="ep-metar-head">
              <b className="mono">{s.icao}</b>
              <span className="muted ep-metar-name">
                {ROLE[s.role] || `${Math.round(s.offRouteNm ?? 0)} NM off route`} · {s.aerodrome.name}
              </span>
              {observedMs != null && (
                <span
                  className={`tnum ep-metar-age${now - observedMs > STALE_MS ? ' warn-text' : ' muted'}`}
                  data-testid="metar-age"
                >
                  {age(observedMs, now)}
                </span>
              )}
            </div>
            <div className="ep-metar mono">{m.raw}</div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
