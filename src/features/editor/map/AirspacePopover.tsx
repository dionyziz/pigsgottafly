// Airspace hover tooltip and click popover on the route map (PLAN-v3 "Airspace on the map"):
// name, class and vertical limits on hover; on click the lateral definition, controlling unit with
// call sign and frequencies, AIP source, and the legs of the route that enter it at their altitude.
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { LegGeometry } from '../../../calc';
import { fmtAltitude } from './labels';
import { fmtVertical, legsThrough, shortClass, type AirspaceInfo, type LegEntry } from './airspace';

const TYPE_LABEL: Record<AirspaceInfo['type'], string> = { TMA: 'TMA', MTMA: 'Military TMA', CTR: 'Control zone', ATZ: 'Aerodrome traffic zone' };

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
  legs: LegGeometry[];
  altitudes: Record<string, { altFt: number }>;
  airac: string;
  onClose(): void;
}

export function AirspacePopover({ x, y, items, legs, altitudes, airac, onClose }: PopProps) {
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
  const alts = legs.map((l) => altitudes[l.key]?.altFt ?? NaN);
  return (
    <div ref={ref} className="pgf-air-pop" style={pos} role="dialog" aria-label="Airspace" data-testid="airspace-pop" onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className="pgf-air-x" onClick={onClose} aria-label="Close">×</button>
      {items.map((a) => {
        const isOpen = open === a.id;
        const entries = isOpen ? legsThrough(a, legs, alts) : [];
        return (
          <section key={a.id} className={'pgf-air-sec' + (isOpen ? ' is-open' : '')} data-testid="airspace-item" data-id={a.id}>
            <button type="button" className="pgf-air-h" onClick={() => setOpen(isOpen ? '' : a.id)} aria-expanded={isOpen}>
              <b className={'pgf-air-type t-' + a.type.toLowerCase()}>{a.type}</b>
              <span className="pgf-air-name">{title(a)}</span>
              <span className="pgf-air-lim">{shortClass(a.cls) && <i>{shortClass(a.cls)}</i>}{fmtVertical(a.lower, a.upper)}</span>
            </button>
            {isOpen && (
              <dl className="pgf-air-body">
                <dt>Type</dt><dd>{TYPE_LABEL[a.type]}{a.cls ? ` · class ${a.cls}` : ''}</dd>
                <dt>Vertical</dt><dd>{fmtVertical(a.lower, a.upper)} <span className="muted">({a.lower} to {a.upper})</span></dd>
                <dt>Lateral</dt><dd className="pgf-air-text">{a.lateral}</dd>
                {a.notes.map((n, i) => <Fragment key={i}><dt>{i === 0 ? 'Notes' : ''}</dt><dd>{n}</dd></Fragment>)}
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
                {a.remarks && <><dt>Remarks</dt><dd className="pgf-air-text">{a.remarks}</dd></>}
                {entries.length > 0 && <>
                  <dt>Route</dt>
                  <dd data-testid="airspace-legs">
                    <ul className="pgf-air-legs">{entries.map((e) => <LegRow key={e.index} e={e} a={a} />)}</ul>
                  </dd>
                </>}
                <dt>Source</dt><dd>AIP Greece {a.source} · AIRAC {airac}</dd>
              </dl>
            )}
          </section>
        );
      })}
    </div>
  );
}

function LegRow({ e, a }: { e: LegEntry; a: AirspaceInfo }) {
  const what = e.vertical === 'inside' ? 'enters' : e.vertical === 'above' ? 'passes above' : e.vertical === 'below' ? 'passes below' : 'crosses (no altitude)';
  const agl = /AGL/i.test(a.lower) && e.vertical !== 'unknown' ? ' (lower limit is above ground; compared with altitude)' : '';
  return (
    <li className={'v-' + e.vertical}>
      <span className="pgf-air-leg">Leg {e.index + 1} {e.from} → {e.to}</span>{' '}
      <span className="pgf-air-alt">{fmtAltitude(e.altFt)}</span>{' '}
      <span className="pgf-air-what">{what}</span>
      {agl && <span className="muted">{agl}</span>}
    </li>
  );
}
