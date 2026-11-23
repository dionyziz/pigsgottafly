// Route: the origin and destination aerodromes as explicit fields, kept in sync with the route's
// first and last points (the map edits the same points; drawing on the map still works). Picking an
// aerodrome replaces that end of the route (a new point, so only the leg touching it loses its
// per-leg overrides); on a route with one point, picking the destination adds it.
// A local flight (the same aerodrome at both ends, nothing between) has no legs: the Local flight box
// locks the destination to the origin and asks for the estimated total time instead. Nothing else in
// the section moves when it is ticked (the time takes the free cell beside the box).
import { useEffect, useState } from 'react';

import { fmtHmm } from '../../../calc';
import {
  type FlightDoc,
  isLocalFlight,
  localDurationOf,
  MAX_LOCAL_DURATION_MIN,
  type RefAerodrome,
  type RoutePoint,
} from '../../../shared';
import { AerodromeTextInput, Check, DurationField } from '../../../ui';
import { makeLocal, setRouteEnd } from '../map/routeEdit';
import { useEditor } from '../state';
import { Section } from './ui';

/** What the field shows for a route end: the aerodrome's code, else the point's name. */
export function endText(p: RoutePoint | undefined): string {
  return p ? p.name : '';
}

function EndField({
  label,
  point,
  disabled,
  hint,
  placeholder = 'ICAO or name',
  testId,
  onPick,
}: {
  label: string;
  point: RoutePoint | undefined;
  disabled?: boolean;
  hint?: string;
  placeholder?: string;
  testId: string;
  onPick: (a: RefAerodrome) => void;
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
        <input disabled readOnly value={shown} placeholder={hint} />
      ) : (
        <AerodromeTextInput
          name={testId}
          value={text}
          placeholder={placeholder}
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
  const { doc, update, readOnly } = useEditor();
  const route = doc.route;
  const from = route[0];
  const to = route.length > 1 ? route[route.length - 1] : undefined;
  const set = (end: 'from' | 'to') => (a: RefAerodrome) =>
    update((d: FlightDoc) => ({ ...d, route: setRouteEnd(d.route, end, a) }), { coalesce: `route-${end}` });
  const local = isLocalFlight(route);
  const duration = localDurationOf(doc.options);
  const badge = (
    <span className="muted">
      {!from ? 'No route' : local ? `${from.name} local · ${fmtHmm(duration)}` : `${from.name} → ${to ? to.name : '?'}`}
    </span>
  );
  const canBeLocal = !readOnly && from?.kind === 'aerodrome';
  const toggleLocal = (on: boolean) =>
    update((d) => ({ ...d, route: on ? (makeLocal(d.route) ?? d.route) : d.route.slice(0, 1) }));
  return (
    <Section id="route" title="Route" badge={badge}>
      <div className="ep-grid2" data-testid="route-ends" data-focus="route">
        <EndField label="Origin" point={from} testId="route-origin" onPick={set('from')} />
        <EndField
          label="Destination"
          point={to}
          testId="route-destination"
          onPick={set('to')}
          disabled={!from || local}
          hint="Set the origin first"
        />
      </div>
      <div className="ep-local">
        <div>
          <Check
            checked={local}
            onChange={toggleLocal}
            disabled={!canBeLocal}
            title={from && from.kind !== 'aerodrome' ? 'A local flight starts at an aerodrome' : undefined}
            testId="route-local"
          >
            Local flight
          </Check>
        </div>
        {local && (
          <label className="field" data-focus="localDuration">
            Estimated total time
            <DurationField
              value={duration}
              max={MAX_LOCAL_DURATION_MIN}
              testId="local-duration"
              disabled={readOnly}
              onChange={(m) =>
                update((d) => ({ ...d, options: { ...d.options, localDurationMin: m } }), {
                  coalesce: 'local-duration',
                })
              }
            />
          </label>
        )}
      </div>
    </Section>
  );
}
