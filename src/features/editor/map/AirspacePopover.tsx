// Airspace hover tooltip and click popover on the route map (PLAN-v3 "Airspace on the map"): what the
// airspace or area is, independent of the route: name, class and vertical limits on hover; on click its
// type, limits, lateral limits in short, activity, units and frequencies, remarks and the AIP section
// (a link to the AIP PDF).
import { AipLink } from '../../../app/AipLink';
import { Fragment } from 'react';
import { fmtVertical, isArea, shortClass, type AirspaceInfo } from './airspace';
import { MapPopover, MapTip, PopItem, useAccordion } from './MapPopover';

const TYPE_LABEL: Record<AirspaceInfo['type'], string> = {
  TMA: 'TMA', MTMA: 'Military TMA', CTR: 'Control zone', ATZ: 'Aerodrome traffic zone',
  P: 'Prohibited area', R: 'Restricted area', D: 'Danger area', MIL: 'Military exercise / training area', ACT: 'Local flying area',
};

function title(a: AirspaceInfo): string {
  return a.sector ? `${a.name} · ${a.sector}` : a.name;
}

const Limits = ({ a }: { a: AirspaceInfo }) => <>{shortClass(a.cls) && <i>{shortClass(a.cls)}</i>}{fmtVertical(a.lower, a.upper)}</>;

export function AirspaceTip({ x, y, items }: { x: number; y: number; items: AirspaceInfo[] }) {
  const shown = items.slice(0, 4);
  return (
    <MapTip x={x} y={y} testId="airspace-tip">
      {shown.map((a) => (
        <div key={a.id} className="pgf-air-tip-row">
          <b className={'pgf-air-type t-' + a.type.toLowerCase()}>{a.type}</b>
          <span className="pgf-air-tip-name">{title(a)}</span>
          <span className="pgf-air-tip-lim"><Limits a={a} /></span>
        </div>
      ))}
      {items.length > shown.length && <div className="pgf-air-tip-more">+{items.length - shown.length} more</div>}
      <div className="pgf-air-tip-more">Click for details</div>
    </MapTip>
  );
}

export function AirspacePopover({ x, y, items, airac, onClose }: { x: number; y: number; items: AirspaceInfo[]; airac: string; onClose(): void }) {
  const acc = useAccordion(items[0]?.id);
  return (
    <MapPopover x={x} y={y} label="Airspace" testId="airspace-pop" onClose={onClose}>
      {items.map((a) => {
        const isOpen = acc.isOpen(a.id);
        const area = isArea(a.type);
        return (
          <PopItem key={a.id} open={isOpen} onToggle={() => acc.toggle(a.id)} testId="airspace-item" data={{ id: a.id }} head={<>
            <b className={'pgf-air-type t-' + a.type.toLowerCase()}>{a.type}</b>
            <span className="pgf-air-name">{title(a)}</span>
            {/* the summary of a closed item (an open one lists class and limits below) */}
            {!isOpen && <span className="pgf-air-lim"><Limits a={a} /></span>}
          </>}>
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
          </PopItem>
        );
      })}
    </MapPopover>
  );
}
