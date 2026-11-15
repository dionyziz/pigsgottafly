// NOTAM hover tooltip and click popover on the route map (PLAN-v3 "Map interaction for weather and
// NOTAMs"): ID, validity and limits on hover; on click the decoded content, the reasons it is shown
// (or hidden), the affected leg, the raw ICAO text and the source and fetch time.
import { XIcon } from '../../../app/XIcon';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Notam } from '../../../shared/briefing';
import { fmtNotamTime, notamLimits, notamSubject, notamValidity, notamWhere } from '../../../data/notams';

export function NotamTip({ x, y, items }: { x: number; y: number; items: Notam[] }) {
  const shown = items.slice(0, 4);
  return (
    <div className="pgf-air-tip" style={{ left: x + 16, top: y + 14 }} data-testid="notam-tip">
      {shown.map((n) => (
        <div key={n.key} className="pgf-air-tip-row">
          <b className={'pgf-air-type t-notam' + (n.relevant ? '' : ' is-hidden')}>NOTAM</b>
          <span className="pgf-air-tip-name">{n.key} · {notamSubject(n)}</span>
          <span className="pgf-air-tip-lim">{notamLimits(n)}</span>
        </div>
      ))}
      {shown.map((n) => <div key={n.key + 'v'} className="pgf-air-tip-more">{n.key}: {notamValidity(n)}</div>)}
      {items.length > shown.length && <div className="pgf-air-tip-more">+{items.length - shown.length} more</div>}
      <div className="pgf-air-tip-more">Click for details</div>
    </div>
  );
}

interface PopProps {
  x: number;
  y: number;
  items: Notam[];
  /** Leg names by index ('LGTT → KARYSTOS'). */
  legName(i: number): string;
  source: string;
  fetched: number | null;
  onOpen(key: string): void;
  onClose(): void;
}

export function NotamPopover({ x, y, items, legName, source, fetched, onOpen, onClose }: PopProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 12, top: y + 12 });
  const [open, setOpen] = useState(items[0]?.key ?? '');
  const [raw, setRaw] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const W = parent.clientWidth, H = parent.clientHeight, w = el.offsetWidth, h = el.offsetHeight;
    let left = x + 12, top = y + 12;
    if (left + w > W - 8) left = Math.max(8, x - 12 - w);
    if (top + h > H - 8) top = Math.max(8, H - 8 - h);
    setPos({ left, top });
  }, [x, y, open, raw]);
  return (
    <div ref={ref} className="pgf-air-pop" style={pos} role="dialog" aria-label="NOTAM" data-testid="notam-pop" onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className="pgf-air-x" onClick={onClose} aria-label="Close"><XIcon /></button>
      {items.map((n) => {
        const isOpen = open === n.key;
        return (
          <section key={n.key} className={'pgf-air-sec' + (isOpen ? ' is-open' : '')} data-testid="notam-item" data-key={n.key}>
            <button type="button" className="pgf-air-h" aria-expanded={isOpen}
              onClick={() => { const k = isOpen ? '' : n.key; setOpen(k); setRaw(false); if (k) onOpen(k); }}>
              <b className={'pgf-air-type t-notam' + (n.relevant ? '' : ' is-hidden')}>NOTAM</b>
              <span className="pgf-air-name">{n.key} · {notamWhere(n)}</span>
              <span className="pgf-air-lim">{notamLimits(n)}</span>
            </button>
            {isOpen && (
              <dl className="pgf-air-body">
                <dt>Subject</dt><dd>{notamSubject(n)} <span className="muted">({n.qcode})</span></dd>
                <dt>Valid</dt><dd>{notamValidity(n)}{n.schedule ? <><br />{n.schedule}</> : null}</dd>
                <dt>Vertical</dt><dd>{notamLimits(n)}</dd>
                {n.legIndex !== null && <><dt>Leg</dt><dd>{n.legIndex + 1}: {legName(n.legIndex)}</dd></>}
                <dt>{n.relevant ? 'Shown' : 'Hidden'}</dt><dd className="pgf-air-text">{n.reasons.join(' · ') || '—'}</dd>
                <dt>Text</dt><dd className="pgf-notam-text">{n.text}</dd>
                <dt>ICAO</dt>
                <dd>
                  <button type="button" className="linkish" onClick={() => setRaw((v) => !v)} aria-expanded={raw}>{raw ? 'Hide' : 'Show'} the NOTAM as issued</button>
                  {raw && <pre className="pgf-notam-raw">{n.raw}</pre>}
                </dd>
                <dt>Source</dt><dd className="pgf-air-text">{source}{fetched ? `, fetched ${fmtNotamTime(fetched)}` : ''}</dd>
              </dl>
            )}
          </section>
        );
      })}
    </div>
  );
}
