// Airspace hover tooltip and click popover on the route map (PLAN-v3 "Airspace on the map"): what the
// airspace or area is, independent of the route: name, class and vertical limits on hover; on click its
// type, limits, lateral limits in short, activity, units and frequencies, remarks and the AIP section
// (a link to the AIP PDF).
import { XIcon } from '../../../app/XIcon';
import { AipLink } from '../../../app/AipLink';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { fmtVertical, isArea, shortClass, type AirspaceInfo } from './airspace';

const TYPE_LABEL: Record<AirspaceInfo['type'], string> = {
  TMA: 'TMA', MTMA: 'Military TMA', CTR: 'Control zone', ATZ: 'Aerodrome traffic zone',
  P: 'Prohibited area', R: 'Restricted area', D: 'Danger area', MIL: 'Military exercise / training area', ACT: 'Local flying area',
};

function title(a: AirspaceInfo): string {
  return a.sector ? `${a.name} · ${a.sector}` : a.name;
}

export function AirspaceTip({ x, y, items }: { x: number; y: number; items: AirspaceInfo[] }) {
  const shown = items.slice(0, 4);
  return (
    <div className="pgf-air-tip" style={{ left: x + 16, top: y + 14 }} data-testid="airspace-tip">
      {shown.map((a) => (
        <div key={a.id} className="pgf-air-tip-row">
          <b className={'pgf-air-type t-' + a.type.toLowerCase()}>{a.type}</b>
          <span className="pgf-air-tip-name">{title(a)}</span>
          <span className="pgf-air-tip-lim">{shortClass(a.cls) && <i>{shortClass(a.cls)}</i>}{fmtVertical(a.lower, a.upper)}</span>
        </div>
      ))}
      {items.length > shown.length && <div className="pgf-air-tip-more">+{items.length - shown.length} more</div>}
      <div className="pgf-air-tip-more">Click for details</div>
    </div>
  );
}

interface PopProps {
  x: number;
  y: number;
  items: AirspaceInfo[];
  airac: string;
  onClose(): void;
}

export function AirspacePopover({ x, y, items, airac, onClose }: PopProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 12, top: y + 12 });
  const [open, setOpen] = useState(items[0]?.id ?? '');
  // keep the popover inside the map
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const W = parent.clientWidth, H = parent.clientHeight, w = el.offsetWidth, h = el.offsetHeight;
    let left = x + 12, top = y + 12;
    if (left + w > W - 8) left = Math.max(8, x - 12 - w);
    if (top + h > H - 8) top = Math.max(8, H - 8 - h);
    setPos({ left, top });
  }, [x, y, open]);
  return (
    <div ref={ref} className="pgf-air-pop" style={pos} role="dialog" aria-label="Airspace" data-testid="airspace-pop" onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className="pgf-air-x" onClick={onClose} aria-label="Close"><XIcon /></button>
      {items.map((a) => {
        const isOpen = open === a.id;
        const area = isArea(a.type);
        return (
          <section key={a.id} className={'pgf-air-sec' + (isOpen ? ' is-open' : '')} data-testid="airspace-item" data-id={a.id}>
            <button type="button" className="pgf-air-h" onClick={() => setOpen(isOpen ? '' : a.id)} aria-expanded={isOpen}>
              <b className={'pgf-air-type t-' + a.type.toLowerCase()}>{a.type}</b>
              <span className="pgf-air-name">{title(a)}</span>
              {/* the summary of a closed item (an open one lists class and limits below) */}
              {!isOpen && <span className="pgf-air-lim">{shortClass(a.cls) && <i>{shortClass(a.cls)}</i>}{fmtVertical(a.lower, a.upper)}</span>}
            </button>
            {isOpen && (
              <dl className="pgf-air-body">
                <dt>Type</dt><dd>{TYPE_LABEL[a.type]}{a.cls ? ` · class ${a.cls}` : ''}</dd>
                <dt>Vertical</dt><dd data-testid="airspace-vertical">{fmtVertical(a.lower, a.upper)}</dd>
                <dt>Lateral</dt><dd className="pgf-air-text">{a.lateral}</dd>
                {a.activity && <><dt>Active</dt><dd className="pgf-air-pre">{a.activity}</dd></>}
                {a.notes.map((n, i) => <Fragment key={i}><dt>{i === 0 ? 'Notes' : ''}</dt><dd>{n}</dd></Fragment>)}
                {(a.units.length > 0 || !area) && <>
                  <dt>Units</dt>
                  <dd>
                    {a.units.length === 0 ? <span className="muted">None published</span> : (
                      <ul className="pgf-air-units">
                        {a.units.map((u) => (
                          <li key={u.callsign}>
                            <span className="pgf-air-cs">{u.callsign}</span>
                            {u.freqs.length > 0 && <span className="pgf-air-fq">{u.freqs.join(' · ')}</span>}
                            {u.hours && <span className="muted"> · {u.hours}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </>}
                {a.remarks && <><dt>Remarks</dt><dd className="pgf-air-text pgf-air-pre">{a.remarks}</dd></>}
                <dt>Source</dt><dd><AipLink refText={a.source} /> <span className="muted">· AIRAC {airac}</span></dd>
              </dl>
            )}
          </section>
        );
      })}
    </div>
  );
}
