import { AipLink, VfrChartLinks } from '../../../app/AipLink';
import type { RefAerodrome } from '../../../shared/ref';
import { type AdDayInfo, adHandlingLine, adHoursLine } from '../adDay';
import { AdHoursDetail } from '../AerodromeHours';
import { PopItem } from './MapPopover';
import type { VfrChart } from './vfrCharts';

const title = (a: RefAerodrome) => (a.icao ? `${a.icao} · ${a.name}` : a.name);

export function AerodromeTipRows({ a, info }: { a: RefAerodrome; info: AdDayInfo }) {
  const closed = info.ad?.runs.every((r) => r.status === 'closed');
  return (
    <div className="pgf-tip-section" data-testid="aerodrome-tip">
      <div className="pgf-air-tip-row">
        <b className="pgf-air-type t-ad">AD</b>
        <span className="pgf-air-tip-name">{title(a)}</span>
        {a.elevFt !== null && <span className="pgf-air-tip-lim">{Math.round(a.elevFt)} ft</span>}
      </div>
      <span className={'pgf-ad-tip-line' + (closed ? ' is-danger' : '')} data-testid="aerodrome-tip-hours">
        {adHoursLine(info)}
      </span>
      {info.handling && <span className="pgf-ad-tip-line">{adHandlingLine(info)}</span>}
    </div>
  );
}

export function AerodromeDetails({
  a,
  info,
  airac,
  charts = [],
}: {
  a: RefAerodrome;
  info: AdDayInfo;
  airac: string;
  charts?: VfrChart[];
}) {
  return (
    <section className="pgf-pop-section" aria-label="Aerodrome" data-testid="aerodrome-pop">
      <PopItem
        open
        head={
          <>
            <b className="pgf-air-type t-ad">AD</b>
            <span className="pgf-air-name">{title(a)}</span>
            {a.elevFt !== null && <span className="pgf-air-lim">{Math.round(a.elevFt)} ft</span>}
          </>
        }
      >
        <AdHoursDetail a={a} info={info} />
        <div className="pgf-air-text pgf-ad-src">
          <AipLink refText={a.source}>AIP Greece {a.source} (PDF)</AipLink>
          {charts.length > 0 && (
            <>
              {' · '}
              <VfrChartLinks charts={charts} />
            </>
          )}{' '}
          <span className="muted">· AIRAC {airac}</span>
        </div>
      </PopItem>
    </section>
  );
}
