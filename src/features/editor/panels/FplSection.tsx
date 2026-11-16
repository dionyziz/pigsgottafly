// Flight plan: what only the pilot can say for the ICAO FPL: up to two alternate aerodromes
// (item 16), touch-and-go / intermediate-stop requests at the route's aerodromes (item 18 RMK/,
// timed at pattern speed) and free-text remarks (item 18). Everything else in the FPL comes from the
// aircraft, the profile, the manifest, the route and the navlog.
import { useEffect, useState } from 'react';

import { endpointAerodrome } from '../../../data/atc';
import { REF } from '../../../data/ref';
import {
  activeRequests,
  type AerodromeRequest,
  DEFAULT_STOP_MIN,
  MAX_STOP_MIN,
  requestAllowed,
  requestRemark,
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
  useEffect(() => {
    if (alternatesFrom(fields).join(' ') !== key) setFields(fieldsOf(alts));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

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
 * point menu); a request made shows its RMK/ text.
 */
function RequestsList() {
  const { doc, update } = useEditor();
  const route = doc.route;
  const ads = route.map((p, index) => ({ p, index })).filter(({ p }) => p.kind === 'aerodrome');
  if (!ads.length) return null;
  const active = activeRequests(route, doc.options);
  const byUid = new Map(active.map((a) => [a.point.uid, a.request]));
  const set = (uid: string, kind: AerodromeRequest['kind'] | null, stopMin?: number) =>
    update(
      (d) => ({
        ...d,
        options: { ...d.options, aerodromeRequests: setRequest(d.options.aerodromeRequests, uid, kind, stopMin) },
      }),
      kind === 'stop' ? { coalesce: `fpl-stop-${uid}` } : undefined,
    );
  const icao = (i: number) => (endpointAerodrome(route[i], REF.aerodromes)?.icao || route[i].name).toUpperCase();
  return (
    <div className="field ep-requests" data-testid="fpl-requests" data-focus="requests">
      <span>Touch-and-go and stops</span>
      <ul>
        {ads.map(({ p, index }) => {
          const r = byUid.get(p.uid);
          return (
            <li key={p.uid} data-testid={`fpl-request-${index}`}>
              <span className="ep-req-name">{p.name}</span>
              {requestAllowed(route, index, 'touch-and-go') && (
                <Check checked={r?.kind === 'touch-and-go'} onChange={(on) => set(p.uid, on ? 'touch-and-go' : null)}>
                  {index === 0 ? 'Touch-and-go first' : 'Touch-and-go'}
                </Check>
              )}
              {requestAllowed(route, index, 'stop') && (
                <span className="ep-req-stop">
                  <Check
                    checked={r?.kind === 'stop'}
                    onChange={(on) => set(p.uid, on ? 'stop' : null, r?.stopMin ?? DEFAULT_STOP_MIN)}
                  >
                    Stop
                  </Check>
                  {r?.kind === 'stop' && (
                    <NumberField
                      value={r.stopMin ?? DEFAULT_STOP_MIN}
                      min={1}
                      max={MAX_STOP_MIN}
                      integer
                      optional={false}
                      width={72}
                      unit="min"
                      ariaLabel={`Stop at ${p.name}, minutes`}
                      className="ep-num"
                      testId={`fpl-stop-min-${index}`}
                      onChange={(n) => {
                        if (n != null && n > 0) set(p.uid, 'stop', n);
                      }}
                    />
                  )}
                </span>
              )}
              {r && (
                <span className="ep-req-rmk mono" data-testid="fpl-request-rmk">
                  RMK/{requestRemark(r, icao(index), index)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
