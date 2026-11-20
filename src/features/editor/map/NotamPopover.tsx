// NOTAM hover tooltip and click popover on the route map (PLAN-v3 "Map interaction for weather and
// NOTAMs"): ID, validity and limits on hover; on click the decoded content, the affected leg and the
// raw ICAO text.
import { Fragment, useEffect, useEffectEvent, useState } from 'react';

import { notamLimits, notamSubject, notamValidity, notamWhere } from '../../../data/notams';
import type { Notam } from '../../../shared/briefing';
import { PopItem, useAccordion } from './MapPopover';

const Badge = ({ n }: { n: Notam }) => (
  <b className={'pgf-air-type t-notam' + (n.relevant ? '' : ' is-hidden')}>NOTAM</b>
);

/** The NOTAM areas under the pointer, in the map's hover box (MapHoverTip). */
export function NotamTipRows({ items }: { items: Notam[] }) {
  const shown = items.slice(0, 4);
  return (
    <div className="pgf-tip-section" data-testid="notam-tip">
      {shown.map((n) => (
        <Fragment key={n.key}>
          <div className="pgf-air-tip-row">
            <Badge n={n} />
            <span className="pgf-air-tip-name">
              {n.key} · {notamSubject(n)}
            </span>
            <span className="pgf-air-tip-lim">{notamLimits(n)}</span>
          </div>
          <div className="pgf-air-tip-more">{notamValidity(n)}</div>
        </Fragment>
      ))}
      {items.length > shown.length && <div className="pgf-air-tip-more">+{items.length - shown.length} more</div>}
    </div>
  );
}

interface PopProps {
  items: Notam[];
  /** Leg names by index ('LGTT → KARYSTOS'). */
  legName: (i: number) => string;
  onOpen: (key: string) => void;
  /** The NOTAM to outline on the map: the one under the pointer, else the open one. */
  onFocus?: (key: string | null) => void;
}

export function NotamDetails({ items, legName, onOpen, onFocus }: PopProps) {
  const acc = useAccordion(items[0]?.key);
  const [raw, setRaw] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const focused = hovered ?? (acc.open || null);
  const focus = useEffectEvent((key: string | null) => onFocus?.(key));
  useEffect(() => focus(focused), [focused]);
  useEffect(() => () => focus(null), []);
  const toggle = (key: string) => {
    const opening = !acc.isOpen(key);
    acc.toggle(key);
    setRaw(false);
    if (opening) onOpen(key);
  };
  return (
    <section className="pgf-pop-section" aria-label="NOTAM" data-testid="notam-pop">
      {items.map((n) => (
        <PopItem
          key={n.key}
          open={acc.isOpen(n.key)}
          onToggle={() => toggle(n.key)}
          onHover={(on) => setHovered((h) => (on ? n.key : h === n.key ? null : h))}
          testId="notam-item"
          data={{ key: n.key }}
          head={
            <>
              <Badge n={n} />
              <span className="pgf-air-name">
                {n.key} · {notamWhere(n)}
              </span>
              <span className="pgf-air-lim">{notamLimits(n)}</span>
            </>
          }
        >
          <dl className="pgf-air-body">
            <dt>Subject</dt>
            <dd>
              {notamSubject(n)} <span className="muted">({n.qcode})</span>
            </dd>
            <dt>Valid</dt>
            <dd>
              {notamValidity(n)}
              {n.schedule ? (
                <>
                  <br />
                  {n.schedule}
                </>
              ) : null}
            </dd>
            <dt>Vertical</dt>
            <dd>{notamLimits(n)}</dd>
            {n.legIndex !== null && (
              <>
                <dt>Leg</dt>
                <dd>
                  {n.legIndex + 1}: {legName(n.legIndex)}
                </dd>
              </>
            )}
            <dt>Text</dt>
            <dd className="pgf-notam-text">{n.text}</dd>
            <dt>ICAO</dt>
            <dd>
              <button type="button" className="linkish" onClick={() => setRaw((v) => !v)} aria-expanded={raw}>
                {raw ? 'Hide' : 'Show'}
              </button>
              {raw && <pre className="pgf-notam-raw">{n.raw}</pre>}
            </dd>
          </dl>
        </PopItem>
      ))}
    </section>
  );
}
