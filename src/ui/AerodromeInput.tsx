// Aerodrome type-ahead over the AIRAC reference list (ICAO or name), on Combobox. Under the field a
// resolved aerodrome reads "full name · elevation" in green; a text that names none reads red.
//   AerodromeInput      controlled by the aerodrome itself (RefAerodrome | null); the typed text is
//                       an internal draft, and every change that resolves (or stops resolving)
//                       calls onChange.
//   AerodromeTextInput  controlled by the text (the caller resolves it with resolveAerodrome()).
import { useEffect, useMemo, useState } from 'react';
import { resolveAerodrome, searchAerodromes } from '../data/ref';
import type { RefAerodrome } from '../shared/ref';
import { Combobox } from './Combobox';

const code = (a: RefAerodrome) => a.icao || a.id;

interface CommonProps {
  name?: string;
  id?: string;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  testId?: string;
  /** Show the green/red line under the field (default true). */
  status?: boolean;
  /** Marked invalid by the caller (e.g. required and empty on submit). */
  invalid?: boolean;
}

export function AerodromeTextInput({ value, onChange, name, id, required, placeholder = 'ICAO or name, e.g. LGTT', autoFocus, disabled, ariaLabel, testId, status = true, invalid }: CommonProps & {
  value: string;
  onChange: (text: string, resolved: RefAerodrome | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => searchAerodromes(value), [value]);
  const resolved = resolveAerodrome(value);
  const exactOnly = !!resolved && hits.length === 1 && code(hits[0]) === value.trim().toUpperCase();
  const unknown = !!value.trim() && !resolved;
  return (
    <Combobox<RefAerodrome>
      text={value}
      onText={(t) => onChange(t, resolveAerodrome(t))}
      options={hits}
      optionKey={(a) => a.id}
      renderOption={(a) => <><span className="code">{a.icao || '—'}</span><span className="nm">{a.name}</span></>}
      onPick={(a) => onChange(code(a), a)}
      suppress={exactOnly}
      name={name} id={id} required={required} placeholder={placeholder} autoFocus={autoFocus} disabled={disabled} ariaLabel={ariaLabel} testId={testId}
      inputClassName={(unknown && !open) || invalid ? 'invalid' : undefined}
      onOpenChange={setOpen}
    >
      {status && value.trim() ? (
        resolved ? <div className="combo-hint ok" data-testid="aerodrome-status">{resolved.name}{resolved.elevFt != null ? ` · elevation ${resolved.elevFt} ft` : ''}</div>
          : !open && <div className="combo-hint bad" data-testid="aerodrome-status">Not an aerodrome in the current AIP</div>
      ) : null}
    </Combobox>
  );
}

export function AerodromeInput({ value, onChange, ...rest }: CommonProps & {
  value: RefAerodrome | null;
  onChange: (a: RefAerodrome | null) => void;
}) {
  const [draft, setDraft] = useState(() => (value ? code(value) : ''));
  // A new value from outside (another field, undo) replaces the draft unless the draft names it.
  useEffect(() => {
    if ((resolveAerodrome(draft)?.id ?? null) !== (value?.id ?? null)) setDraft(value ? code(value) : '');
  }, [value?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AerodromeTextInput {...rest} value={draft} onChange={(t, a) => {
      setDraft(t);
      if ((a?.id ?? null) !== (value?.id ?? null)) onChange(a ?? null);
    }} />
  );
}
