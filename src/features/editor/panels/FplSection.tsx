// Flight plan: what only the pilot can say for the ICAO FPL: up to two alternate aerodromes
// (item 16) and free-text remarks (item 18 RMK/). Everything else in the FPL comes from the
// aircraft, the profile, the manifest, the route and the navlog.
import { useEffect, useState } from 'react';
import { AerodromePicker } from '../../profile/AerodromePicker';
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
    if (codes.join(' ') !== key) update((d) => ({ ...d, options: { ...d.options, alternates: codes } }), { coalesce: `fpl-altn-${i}` });
  };

  const badge = <span className="muted">{alts.length ? `ALTN ${alts.join(' ')}` : 'No alternate'}</span>;
  return (
    <Section id="fpl" title="Flight plan" badge={badge}>
      <div className="ep-fpl" data-testid="fpl-options">
        {fields.map((f, i) => (
          <label className="field" key={i} data-testid={`fpl-alternate-${i + 1}`}>
            {i === 0 ? 'Alternate aerodrome (item 16)' : 'Second alternate'}
            <AerodromePicker name={`alternate-${i + 1}`} value={f} onChange={(v) => setField(i, v)} placeholder="ICAO or name" />
          </label>
        ))}
        <label className="field">Remarks (item 18 RMK/)
          <textarea rows={2} value={remarks} data-testid="fpl-remarks" placeholder="e.g. PHOTO FLIGHT"
            onChange={(e) => update((d) => ({ ...d, options: { ...d.options, remarks: e.target.value } }), { coalesce: 'fpl-rmk' })} />
          <span className="hint">Added before the PIC phone and the route points. Greek is transliterated and the text upper-cased.</span>
        </label>
      </div>
    </Section>
  );
}
