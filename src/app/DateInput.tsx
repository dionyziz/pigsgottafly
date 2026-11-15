// Date field that always reads and types YYYY-MM-DD (a native <input type="date"> shows the
// browser's locale format). The calendar button opens the native picker on a hidden date input.
import { useEffect, useRef, useState } from 'react';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const valid = (s: string) => ISO.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/** Loose typing → 'YYYY-MM-DD' when unambiguous ('20261116', '2026-11-16', '2026/11/16'); otherwise null. */
export function normaliseIsoDate(t: string): string | null {
  const s = t.trim();
  if (!s) return '';
  const m = /^(\d{4})[-/. ]?(\d{1,2})[-/. ]?(\d{1,2})$/.exec(s);
  if (!m) return null;
  const out = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return valid(out) ? out : null;
}

export function DateInput({ value, onChange, name, testId, ariaLabel, autoFocus }: {
  value: string;
  /** Called with 'YYYY-MM-DD', or '' when cleared. */
  onChange: (e: { target: { value: string } }) => void;
  name?: string;
  testId?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(value); setBad(false); }, [value]);

  const commit = (t: string) => {
    const v = normaliseIsoDate(t);
    if (v == null) { setBad(true); return; }
    setBad(false);
    setDraft(v);
    if (v !== value) onChange({ target: { value: v } });
  };

  return (
    <span className="date-input">
      <input
        name={name} value={draft} placeholder="YYYY-MM-DD" inputMode="numeric" autoComplete="off" spellCheck={false}
        aria-label={ariaLabel} aria-invalid={bad || undefined} data-testid={testId} autoFocus={autoFocus}
        className={bad ? 'invalid' : undefined}
        onChange={(e) => { setDraft(e.target.value); const v = normaliseIsoDate(e.target.value); if (v && v.length === 10 && v !== value) { setBad(false); onChange({ target: { value: v } }); } }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
      />
      <button type="button" className="date-input-cal" tabIndex={-1} aria-label="Choose a date" title="Choose a date"
        onClick={() => { const p = picker.current; if (!p) return; try { p.showPicker(); } catch { p.focus(); } }}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></svg>
      </button>
      <input ref={picker} type="date" className="date-input-native" tabIndex={-1} aria-hidden="true" value={valid(value) ? value : ''}
        onChange={(e) => { if (e.target.value) commit(e.target.value); }} />
    </span>
  );
}
