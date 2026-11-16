// Route: the origin and destination aerodromes as explicit fields, kept in sync with the route's
// first and last points (the map edits the same points; drawing on the map still works). Picking an
// aerodrome replaces that end of the route (a new point, so only the leg touching it loses its
// per-leg overrides); on a route with one point, picking the destination adds it.
import { useEffect, useState } from 'react';
import { aerodromePoint as pointOf, type FlightDoc, type RefAerodrome, type RoutePoint } from '../../../shared';
import { AerodromeTextInput } from '../../../ui';
import { useEditor } from '../state';
import { Section } from './ui';

/** What the field shows for a route end: the aerodrome's code, else the point's name. */
export function endText(p: RoutePoint | undefined): string {
  return p ? p.name : '';
}

/** The route with its origin (end 'from') or destination ('to') set to an aerodrome. */
export function setRouteEnd(route: RoutePoint[], end: 'from' | 'to', a: RefAerodrome): RoutePoint[] {
  const p = pointOf(a);
  if (end === 'from') return route.length ? [p, ...route.slice(1)] : [p];
  if (route.length === 0) return route; // no origin yet: nothing to end
  if (route.length === 1) return [...route, p];
  return [...route.slice(0, -1), p];
}

function EndField({
  label,
  point,
  disabled,
  hint,
  testId,
  onPick,
}: {
  label: string;
  point: RoutePoint | undefined;
  disabled?: boolean;
  hint?: string;
  testId: string;
  onPick(a: RefAerodrome): void;
}) {
  const shown = endText(point);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  // the map, undo or another window moved this end: show it (unless the pilot is typing)
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, point?.uid, focused]);
  const custom = point && point.kind !== 'aerodrome';
  return (
    <label
      className="field"
      data-testid={testId}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(shown);
      }}
    >
      {label}
      {disabled ? (
        <input disabled placeholder={hint} />
      ) : (
        <AerodromeTextInput
          name={testId}
          value={text}
          placeholder="ICAO or name"
          status={!custom || focused}
          onChange={(v, a) => {
            setText(v);
            if (a && !(point?.kind === 'aerodrome' && point.refId === a.id)) onPick(a);
          }}
        />
      )}
      {custom && !focused && <span className="hint">Map point, not an aerodrome</span>}
    </label>
  );
}

export function RouteSection() {
  const { doc, update } = useEditor();
  const route = doc.route;
  const from = route[0];
  const to = route.length > 1 ? route[route.length - 1] : undefined;
  const set = (end: 'from' | 'to') => (a: RefAerodrome) =>
    update((d: FlightDoc) => ({ ...d, route: setRouteEnd(d.route, end, a) }), { coalesce: `route-${end}` });
  const between = Math.max(0, route.length - 2);
  const badge = (
    <span className="muted">
      {from ? `${from.name} → ${to ? to.name : '?'}${between ? ` · ${between} via` : ''}` : 'No route'}
    </span>
  );
  return (
    <Section id="route" title="Route" badge={badge}>
      <div className="ep-grid2" data-testid="route-ends" data-focus="route">
        <EndField label="Origin" point={from} testId="route-origin" onPick={set('from')} />
        <EndField
          label="Destination"
          point={to}
          testId="route-destination"
          onPick={set('to')}
          disabled={!from}
          hint="Set the origin first"
        />
      </div>
    </Section>
  );
}
