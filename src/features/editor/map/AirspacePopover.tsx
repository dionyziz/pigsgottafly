// Airspace hover tooltip and click popover on the route map (PLAN-v3 "Airspace on the map"): what the
// airspace or area is, independent of the route: name, class and vertical limits on hover; on click its
// type, limits, lateral limits in short, activity, units and frequencies, remarks, the AIP VFR chart(s)
// showing it and the AIP section (links to the AIP PDFs).
import { Fragment, useEffect, useEffectEvent, useState } from 'react';

import { AipLink, VfrChartLinks } from '../../../app/AipLink';
import { type AirspaceInfo, fmtVertical, isArea, shortClass } from './airspace';
import { MapPopover, PopItem, useAccordion } from './MapPopover';
import type { VfrChart } from './vfrCharts';

const TYPE_LABEL: Record<AirspaceInfo['type'], string> = {
  TMA: 'TMA',
  MTMA: 'Military TMA',
  CTR: 'Control zone',
  ATZ: 'Aerodrome traffic zone',
  P: 'Prohibited area',
  R: 'Restricted area',
  D: 'Danger area',
  MIL: 'Military exercise / training area',
  ACT: 'Local flying area',
};

function title(a: AirspaceInfo): string {
  return a.sector ? `${a.name} · ${a.sector}` : a.name;
}

const Limits = ({ a }: { a: AirspaceInfo }) => (
  <>
    {shortClass(a.cls) && <i>{shortClass(a.cls)}</i>}
    {fmtVertical(a.lower, a.upper)}
  </>
);

/** The airspaces under the pointer, in the map's hover box (MapHoverTip). */
export function AirspaceTipRows({ items }: { items: AirspaceInfo[] }) {
  const shown = items.slice(0, 4);
  return (
    <div className="pgf-tip-section" data-testid="airspace-tip">
      {shown.map((a) => (
        <div key={a.id} className="pgf-air-tip-row">
          <b className={'pgf-air-type t-' + a.type.toLowerCase()}>{a.type}</b>
          <span className="pgf-air-tip-name">{title(a)}</span>
          <span className="pgf-air-tip-lim">
            <Limits a={a} />
          </span>
        </div>
      ))}
      {items.length > shown.length && <div className="pgf-air-tip-more">+{items.length - shown.length} more</div>}
    </div>
  );
}

export function AirspacePopover({
  x,
  y,
  items,
  airac,
  chartsFor,
  onClose,
  onFocus,
}: {
  x: number;
  y: number;
  items: AirspaceInfo[];
  airac: string;
  /** The AIP VFR charts showing an airspace. */
  chartsFor?: (a: AirspaceInfo) => VfrChart[];
  onClose: () => void;
  /** The airspace to outline on the map: the one under the pointer, else the open one. */
  onFocus?: (id: string | null) => void;
}) {
  const acc = useAccordion(items[0]?.id);
  const [hovered, setHovered] = useState<string | null>(null);
  const focused = hovered ?? (acc.open || null);
  const focus = useEffectEvent((id: string | null) => onFocus?.(id));
  useEffect(() => focus(focused), [focused]);
  return (
    <MapPopover x={x} y={y} label="Airspace" testId="airspace-pop" onClose={onClose}>
      {items.map((a) => {
        const isOpen = acc.isOpen(a.id);
        const area = isArea(a.type);
        const charts = isOpen ? (chartsFor?.(a) ?? []) : [];
        return (
          <PopItem
            key={a.id}
            open={isOpen}
            onToggle={() => acc.toggle(a.id)}
            testId="airspace-item"
            data={{ id: a.id }}
            onHover={(on) => setHovered((h) => (on ? a.id : h === a.id ? null : h))}
            head={
              <>
                <b className={'pgf-air-type t-' + a.type.toLowerCase()}>{a.type}</b>
                <span className="pgf-air-name">{title(a)}</span>
                {/* the summary of a closed item (an open one lists class and limits below) */}
                {!isOpen && (
                  <span className="pgf-air-lim">
                    <Limits a={a} />
                  </span>
                )}
              </>
            }
          >
            <dl className="pgf-air-body">
              <dt>Type</dt>
              <dd>
                {TYPE_LABEL[a.type]}
                {a.cls ? ` · class ${a.cls}` : ''}
              </dd>
              <dt>Vertical</dt>
              <dd data-testid="airspace-vertical">{fmtVertical(a.lower, a.upper)}</dd>
              <dt>Lateral</dt>
              <dd className="pgf-air-text">{a.lateral}</dd>
              {a.activity && (
                <>
                  <dt>Active</dt>
                  <dd className="pgf-air-pre">{a.activity}</dd>
                </>
              )}
              {a.notes.map((n, i) => (
                <Fragment key={i}>
                  <dt>{i === 0 ? 'Notes' : ''}</dt>
                  <dd>{n}</dd>
                </Fragment>
              ))}
              {(a.units.length > 0 || !area) && (
                <>
                  <dt>Units</dt>
                  <dd>
                    {a.units.length === 0 ? (
                      <span className="muted">None published</span>
                    ) : (
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
                </>
              )}
              {a.remarks && (
                <>
                  <dt>Remarks</dt>
                  <dd className="pgf-air-text pgf-air-pre">{a.remarks}</dd>
                </>
              )}
              {charts.length > 0 && (
                <>
                  <dt>{charts.length > 1 ? 'Charts' : 'Chart'}</dt>
                  <dd>
                    <VfrChartLinks charts={charts} />
                  </dd>
                </>
              )}
              <dt>Source</dt>
              <dd>
                <AipLink refText={a.source} /> <span className="muted">· AIRAC {airac}</span>
              </dd>
            </dl>
          </PopItem>
        );
      })}
    </MapPopover>
  );
}
