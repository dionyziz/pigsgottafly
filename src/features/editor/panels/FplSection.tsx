// Flight plan: what only the pilot can say for the ICAO FPL: up to two alternate aerodromes
// (item 16), touch-and-go / intermediate-stop requests at the route's aerodromes (item 18 RMK/ in
// the club's words, and timing at pattern speed) and free-text remarks (item 18).
// Everything else in the FPL comes from the
// aircraft, the profile, the manifest, the route and the navlog.
import { useEffect, useState } from 'react';
import { AerodromePicker } from '../../profile/AerodromePicker';
import { useEditor } from '../state';
import { alternatesFrom, MAX_ALTERNATES } from './fplOptions';
import { Section } from './ui';
import { activeRequests, DEFAULT_STOP_MIN, MAX_STOP_MIN, requestAllowed, requestLabel, requestRemark, setRequest, type AerodromeRequest } from '../../../shared';
import { endpointAerodrome } from '../../../data/atc';
import { REF } from '../../../data/ref';

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
    if (codes.join(' ') !== key) update((d) => ({ ...d, options: { ...d.options, alternates: codes } }), { coalesce: `fpl-altn-${i}` });
  };

  const badge = <span className="muted">{alts.length ? `ALTN ${alts.join(' ')}` : 'No alternate'}</span>;
  return (
    <Section id="fpl" title="Flight plan" badge={badge}>
      <div className="ep-fpl" data-testid="fpl-options">
        {fields.map((f, i) => (
          <label className="field" key={i} data-testid={`fpl-alternate-${i + 1}`} data-focus={i === 0 ? 'alternates' : undefined}>
            {i === 0 ? 'Alternate aerodrome (item 16)' : 'Second alternate'}
            <AerodromePicker name={`alternate-${i + 1}`} value={f} onChange={(v) => setField(i, v)} placeholder="ICAO or name" />
          </label>
        ))}
        <RequestsList />
        <label className="field">Remarks (item 18)
          <textarea rows={2} value={remarks} data-testid="fpl-remarks" data-focus="remarks" placeholder="e.g. PHOTO FLIGHT"
            onChange={(e) => update((d) => ({ ...d, options: { ...d.options, remarks: e.target.value } }), { coalesce: 'fpl-rmk' })} />
          <span className="hint">Plain text goes to RMK/ after the requests; text after an indicator (STS/, PER/ …) goes to that field.</span>
        </label>
      </div>
    </Section>
  );
}

/**
 * The route's aerodromes, each with "Touch-and-go" and "Stop n min" (the same requests as the map
 * point menu); the requests made are listed with their RMK/ text and can be removed.
 */
function RequestsList() {
  const { doc, update } = useEditor();
  const route = doc.route;
  const ads = route.map((p, index) => ({ p, index })).filter(({ p }) => p.kind === 'aerodrome');
  if (!ads.length) return null;
  const active = activeRequests(route, doc.options);
  const byUid = new Map(active.map((a) => [a.point.uid, a.request]));
  const set = (uid: string, kind: AerodromeRequest['kind'] | null, stopMin?: number) =>
    update((d) => ({ ...d, options: { ...d.options, aerodromeRequests: setRequest(d.options.aerodromeRequests, uid, kind, stopMin) } }), kind === 'stop' ? { coalesce: `fpl-stop-${uid}` } : undefined);
  const icao = (i: number) => (endpointAerodrome(route[i], REF.aerodromes)?.icao || route[i].name).toUpperCase();
  return (
    <div className="field ep-requests" data-testid="fpl-requests" data-focus="requests">
      <span>Touch-and-go and stops <span className="muted">(item 18 RMK/)</span></span>
      <ul>
        {ads.map(({ p, index }) => {
          const r = byUid.get(p.uid);
          return (
            <li key={p.uid} data-testid={`fpl-request-${index}`}>
              <span className="ep-req-name">{p.name}</span>
              {requestAllowed(route, index, 'touch-and-go') && (
                <label><input type="checkbox" checked={r?.kind === 'touch-and-go'} onChange={(e) => set(p.uid, e.target.checked ? 'touch-and-go' : null)} /> {index === 0 ? 'Touch-and-go first' : 'Touch-and-go'}</label>
              )}
              {requestAllowed(route, index, 'stop') && (
                <label>
                  <input type="checkbox" checked={r?.kind === 'stop'} onChange={(e) => set(p.uid, e.target.checked ? 'stop' : null, r?.stopMin ?? DEFAULT_STOP_MIN)} /> Stop
                  {r?.kind === 'stop' && (
                    <input type="number" min={1} max={MAX_STOP_MIN} step={1} value={r.stopMin ?? DEFAULT_STOP_MIN} aria-label={`Stop at ${p.name}, minutes`} className="ep-req-min"
                      onChange={(e) => { const n = Number(e.target.value); if (n > 0) set(p.uid, 'stop', n); }} />
                  )}
                  {r?.kind === 'stop' ? ' min' : ''}
                </label>
              )}
              {r && <span className="hint">{requestLabel(r, index)}: RMK/{requestRemark(r, icao(index), index)}</span>}
            </li>
          );
        })}
      </ul>
      {active.length > 0 && <span className="hint">The legs into and out of an intermediate aerodrome with a request are timed at pattern speed and altitude; a stop adds its minutes on the ground.</span>}
    </div>
  );
}
