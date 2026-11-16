// Aerodrome hover tooltip and click popover on the route map: name, elevation and the hours on the
// flight's date (with handling) on hover; on click the hours, ATS, handling, customs, the NOTAMs that
// change them (by NOTAM id) and the AIP text (AerodromeHours.tsx), and a link to the aerodrome's AIP PDF.
import { AipLink } from '../../../app/AipLink';
import type { RefAerodrome } from '../../../shared/ref';
import { AdHoursDetail, adHandlingLine, adHoursLine, type AdDayInfo } from '../AerodromeHours';
import { MapPopover, MapTip, PopItem } from './MapPopover';

const title = (a: RefAerodrome) => (a.icao ? `${a.icao} · ${a.name}` : a.name);

export function AerodromeTip({ x, y, a, info }: { x: number; y: number; a: RefAerodrome; info: AdDayInfo }) {
  const closed = info.ad?.runs.every((r) => r.status === 'closed');
  return (
    <MapTip x={x} y={y} testId="aerodrome-tip">
      <div className="pgf-air-tip-row">
        <b className="pgf-air-type t-ad">AD</b>
        <span className="pgf-air-tip-name">{title(a)}</span>
        {a.elevFt !== null && <span className="pgf-air-tip-lim">{Math.round(a.elevFt)} ft</span>}
      </div>
      <span className={'pgf-ad-tip-line' + (closed ? ' is-danger' : '')} data-testid="aerodrome-tip-hours">
        {adHoursLine(info)}
      </span>
      {info.handling && <span className="pgf-ad-tip-line">{adHandlingLine(info)}</span>}
      <div className="pgf-air-tip-more">Click for details</div>
    </MapTip>
  );
}

export function AerodromePopover({
  x,
  y,
  a,
  info,
  airac,
  onClose,
}: {
  x: number;
  y: number;
  a: RefAerodrome;
  info: AdDayInfo;
  airac: string;
  onClose(): void;
}) {
  return (
    <MapPopover x={x} y={y} label="Aerodrome" testId="aerodrome-pop" onClose={onClose}>
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
          <AipLink refText={a.source}>AIP Greece {a.source} (PDF)</AipLink>{' '}
          <span className="muted">· AIRAC {airac}</span>
        </div>
      </PopItem>
    </MapPopover>
  );
}
