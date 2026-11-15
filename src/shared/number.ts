// Parsing of numbers typed by the pilot: a decimal comma, the typographic minus (U+2212), an
// exponent; anything else is not a number. Shared by every number field (src/ui/NumberField).

/** '' → null, a number, or NaN for anything that is not one ('4x', '1.2.3', 'Infinity'). */
export function parseDecimal(s: string): number | null {
  const t = s.trim().replace(',', '.').replace(/−/g, '-');
  if (!t) return null;
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

export interface NumberRules {
  min?: number;
  max?: number;
  /** Whole numbers only. */
  integer?: boolean;
  /** An empty field is null (default true); otherwise it is not a valid value. */
  allowEmpty?: boolean;
}

export type NumberDraft =
  | { kind: 'ok'; value: number | null }
  /** A number outside [min, max]; `clamped` is the nearest allowed value, `message` names the limit. */
  | { kind: 'range'; value: number; clamped: number; message: string }
  | { kind: 'bad'; message: string };

/** Classifies what is typed in a number field against its rules. */
export function parseNumber(s: string, { min, max, integer, allowEmpty = true }: NumberRules = {}): NumberDraft {
  const n = parseDecimal(s);
  if (n === null) return allowEmpty ? { kind: 'ok', value: null } : { kind: 'bad', message: 'Required' };
  if (Number.isNaN(n)) return { kind: 'bad', message: 'Not a number' };
  if (integer && !Number.isInteger(n)) return { kind: 'bad', message: 'Whole number' };
  if (min != null && n < min) return { kind: 'range', value: n, clamped: min, message: `Min ${min}` };
  if (max != null && n > max) return { kind: 'range', value: n, clamped: max, message: `Max ${max}` };
  return { kind: 'ok', value: n };
}
