// Moved: the aerodrome type-ahead is src/ui/AerodromeInput (AerodromeInput takes the aerodrome,
// AerodromeTextInput the text), the search in src/data/ref. Re-exported here for the old imports.
import type { RefAerodrome } from '../../shared';
import { AerodromeTextInput } from '../../ui';

export { resolveAerodrome, searchAerodromes } from '../../data/ref';

/** Text-controlled aerodrome type-ahead (the caller resolves the text with resolveAerodrome()). */
export function AerodromePicker({ name, value, onChange, required, placeholder, autoFocus }: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return <AerodromeTextInput name={name} value={value} onChange={(t: string, _a?: RefAerodrome) => onChange(t)} required={required} placeholder={placeholder} autoFocus={autoFocus} />;
}
