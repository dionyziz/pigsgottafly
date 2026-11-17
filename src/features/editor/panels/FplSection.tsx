// Flight plan: what only the pilot can say for the ICAO FPL: up to two alternate aerodromes
// (item 16), touch-and-go / intermediate-stop requests at the route's aerodromes (item 18 RMK/,
// timed at pattern speed) and free-text remarks (item 18). Everything else in the FPL comes from the
// aircraft, the profile, the manifest, the route and the navlog.
import { useEffect, useEffectEvent, useState } from 'react';

import {
  activeRequests,
  type AerodromeRequest,
  DEFAULT_STOP_MIN,
  MAX_STOP_MIN,
  removeRequest,
  requestAllowed,
  setRequest,
} from '../../../shared';
import { AerodromeTextInput, Check, NumberField } from '../../../ui';
import { useEditor } from '../state';
import { alternatesFrom, MAX_ALTERNATES } from './fplOptions';
import { Section } from './ui';

const fieldsOf = (alts: string[]) => Array.from({ length: MAX_ALTERNATES }, (_, i) => alts[i] ?? '');

export function FplSection() {
  const { doc, update } = useEditor();
  const alts = doc.options.alternates ?? [];
  const remarks = doc.options.remarks ?? '';
  // The fields keep what is typed; the flight stores the resolved codes. Undo/redo or another
  // window changing the alternates resets the fields.
  const [fields, setFields] = useState(() => fieldsOf(alts));
  const key = alts.join(' ');
  const syncFields = useEffectEvent(() => {
    if (alternatesFrom(fields).join(' ') !== key) setFields(fieldsOf(alts));
  });
  useEffect(() => syncFields(), [key]);

  const setField = (i: number, v: string) => {
    const next = fields.map((f, j) => (j === i ? v : f));
    setFields(next);
    const codes = alternatesFrom(next);
    if (codes.join(' ') !== key)
      update((d) => ({ ...d, options: { ...d.options, alternates: codes } }), { coalesce: `fpl-altn-${i}` });
  };

  const badge = <span className="muted">{alts.length ? `ALTN ${alts.join(' ')}` : 'No alternate'}</span>;
  return (
    <Section id="fpl" title="Flight plan" badge={badge}>
      <div className="ep-fpl" data-testid="fpl-options">
        <div className="ep-grid2">
          {fields.map((f, i) => (
            <label
              className="field"
              key={i}
              data-testid={`fpl-alternate-${i + 1}`}
              data-focus={i === 0 ? 'alternates' : undefined}
            >
              Alternate {i + 1}
              <AerodromeTextInput
                name={`alternate-${i + 1}`}
                value={f}
                onChange={(v) => setField(i, v)}
                placeholder="ICAO or name"
              />
            </label>
          ))}
        </div>
        <RequestsList />
        <label className="field">
          Remarks (item 18)
          <textarea
            rows={2}
            value={remarks}
            data-testid="fpl-remarks"
            data-focus="remarks"
            placeholder="e.g. PHOTO FLIGHT"
            onChange={(e) =>
              update((d) => ({ ...d, options: { ...d.options, remarks: e.target.value } }), { coalesce: 'fpl-rmk' })
            }
          />
        </label>
      </div>
    </Section>
  );
}

/**
 * The route's aerodromes, each with "Touch-and-go" and "Stop n min" (the same requests as the map
 * point menu); an intermediate aerodrome may have both. Columns line up across the rows, and the
 * minutes field keeps its place while Stop is off, so ticking a box moves nothing.
 */
function RequestsList() {
  const { doc, update } = useEditor();
  const route = doc.route;
  const ads = route.map((p, index) => ({ p, index })).filter(({ p }) => p.kind === 'aerodrome');
  if (!ads.length) return null;
  const active = activeRequests(route, doc.options);
  const reqOf = (uid: string, kind: AerodromeRequest['kind']) =>
    active.find((a) => a.point.uid === uid && a.request.kind === kind)?.request;
  const set = (uid: string, kind: AerodromeRequest['kind'], on: boolean, stopMin?: number) =>
    update(
      (d) => ({
        ...d,
        options: {
          ...d.options,
          aerodromeRequests: on
            ? setRequest(d.options.aerodromeRequests, uid, kind, stopMin)
            : removeRequest(d.options.aerodromeRequests, uid, kind),
        },
      }),
      kind === 'stop' && on ? { coalesce: `fpl-stop-${uid}` } : undefined,
    );
  return (
    <div className="field ep-requests" data-testid="fpl-requests" data-focus="requests">
      <span>Touch-and-go and stops</span>
      <ul>
        {ads.map(({ p, index }) => {
          const tng = reqOf(p.uid, 'touch-and-go');
          const stop = reqOf(p.uid, 'stop');
          return (
            <li key={p.uid} data-testid={`fpl-request-${index}`}>
              <span className="ep-req-name">{p.name}</span>
              {requestAllowed(route, index, 'touch-and-go') ? (
                <Check checked={!!tng} testId={`fpl-tng-${index}`} onChange={(on) => set(p.uid, 'touch-and-go', on)}>
                  {index === 0 ? 'Touch-and-go first' : 'Touch-and-go'}
                </Check>
              ) : (
                <span />
              )}
              {requestAllowed(route, index, 'stop') ? (
                <span className="ep-req-stop">
                  <Check
                    checked={!!stop}
                    testId={`fpl-stop-${index}`}
                    onChange={(on) => set(p.uid, 'stop', on, stop?.stopMin ?? DEFAULT_STOP_MIN)}
                  >
                    Stop
                  </Check>
                  <span className={stop ? undefined : 'ep-req-off'}>
                    <NumberField
                      value={stop?.stopMin ?? DEFAULT_STOP_MIN}
                      min={1}
                      max={MAX_STOP_MIN}
                      integer
                      optional={false}
                      width={80}
                      unit="min"
                      ariaLabel={`Stop at ${p.name}, minutes`}
                      className="ep-num"
                      testId={`fpl-stop-min-${index}`}
                      onChange={(n) => {
                        if (stop && n != null && n > 0) set(p.uid, 'stop', true, n);
                      }}
                    />
                  </span>
                </span>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
