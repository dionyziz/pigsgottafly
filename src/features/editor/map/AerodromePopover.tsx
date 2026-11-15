// Aerodrome hover tooltip and click popover on the route map: name, elevation and the hours on the
// flight's date (with handling) on hover; on click the hours, ATS, handling, customs, the NOTAMs that
// change them (by NOTAM id) and the AIP text (AerodromeHours.tsx).
import { XIcon } from '../../../app/XIcon';
import { useLayoutEffect, useRef, useState } from 'react';
import type { RefAerodrome } from '../../../shared/ref';
import { AdHoursDetail, adHandlingLine, adHoursLine, type AdDayInfo } from '../AerodromeHours';

const title = (a: RefAerodrome) => (a.icao ? `${a.icao} · ${a.name}` : a.name);

export function AerodromeTip({ x, y, a, info }: { x: number; y: number; a: RefAerodrome; info: AdDayInfo }) {
  const closed = info.ad?.runs.every((r) => r.status === 'closed');
  return (
    <div className="pgf-air-tip" style={{ left: x + 16, top: y + 14 }} data-testid="aerodrome-tip">
      <div className="pgf-air-tip-row">
        <b className="pgf-air-type t-ad">AD</b>
        <span className="pgf-air-tip-name">{title(a)}</span>
        {a.elevFt !== null && <span className="pgf-air-tip-lim">{Math.round(a.elevFt)} ft</span>}
      </div>
      <span className={'pgf-ad-tip-line' + (closed ? ' is-danger' : '')} data-testid="aerodrome-tip-hours">{adHoursLine(info)}</span>
      {info.handling && <span className="pgf-ad-tip-line">{adHandlingLine(info)}</span>}
      <div className="pgf-air-tip-more">Click for details</div>
    </div>
  );
}

export function AerodromePopover({ x, y, a, info, airac, onClose }: { x: number; y: number; a: RefAerodrome; info: AdDayInfo; airac: string; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 12, top: y + 12 });
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const W = parent.clientWidth, H = parent.clientHeight, w = el.offsetWidth, h = el.offsetHeight;
    let left = x + 12, top = y + 12;
    if (left + w > W - 8) left = Math.max(8, x - 12 - w);
    if (top + h > H - 8) top = Math.max(8, H - 8 - h);
    setPos({ left, top });
  }, [x, y, info]);
  return (
    <div ref={ref} className="pgf-air-pop" style={pos} role="dialog" aria-label="Aerodrome" data-testid="aerodrome-pop" onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className="pgf-air-x" onClick={onClose} aria-label="Close"><XIcon /></button>
      <section className="pgf-air-sec is-open">
        <div className="pgf-air-h">
          <b className="pgf-air-type t-ad">AD</b>
          <span className="pgf-air-name">{title(a)}</span>
          {a.elevFt !== null && <span className="pgf-air-lim">{Math.round(a.elevFt)} ft</span>}
        </div>
        <AdHoursDetail a={a} info={info} />
        <div className="pgf-air-text pgf-ad-src">AIP Greece {a.source} · AIRAC {airac}</div>
      </section>
    </div>
  );
}
