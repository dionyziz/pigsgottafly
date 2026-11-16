// A date 'YYYY-MM-DD', typed as digits (the dashes go in as the year and the month are complete:
// '20261116' → '2026-11-16'), pasted ('2026-11-16', '2026/11/16', '20261116'), or picked on a small
// month calendar (the button at the right; Alt+↓ from the input). A complete real date within
// [min, max] is committed as it is typed; anything else turns the field red on blur or Enter and
// leaves the value alone. Parsing: src/shared/typedInput.ts.
import { type KeyboardEvent, useEffect, useEffectEvent, useId, useRef, useState } from 'react';

import { localToday } from '../shared/date';
import { dateProblem, isRealDate, maskDate, parseDate } from '../shared/typedInput';

export interface DateFieldProps {
  /** 'YYYY-MM-DD', or '' when unset. */
  value: string;
  /** Called with 'YYYY-MM-DD', or '' when cleared. */
  onChange: (v: string) => void;
  /** Earliest and latest accepted dates, 'YYYY-MM-DD'. */
  min?: string;
  max?: string;
  name?: string;
  id?: string;
  ariaLabel?: string;
  testId?: string;
  /** Marked invalid from outside. */
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Classes of the <input>. */
  className?: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const utc = (s: string) => new Date(s + 'T00:00:00Z');
const addDaysIso = (s: string, n: number) => iso(new Date(utc(s).getTime() + n * 86400000));
function addMonthsIso(s: string, n: number): string {
  const d = utc(s);
  const y = d.getUTCFullYear(),
    m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))));
}

export function DateField({
  value,
  onChange,
  min,
  max,
  name,
  id,
  ariaLabel,
  testId,
  invalid,
  disabled,
  autoFocus,
  className,
}: DateFieldProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  // Red once the pilot left (or pressed Enter on) text that is not an acceptable date.
  const [bad, setBad] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLSpanElement>(null);

  const syncDraft = useEffectEvent(() => {
    if (!focused || parseDate(draft) !== value) {
      setDraft(value);
      setBad(false);
    }
  });
  useEffect(() => syncDraft(), [value]);

  // A click anywhere outside closes the calendar.
  useEffect(() => {
    if (!calendar) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setCalendar(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [calendar]);

  const ok = (s: string) => dateProblem(s, min, max) === null;
  const commit = (v: string) => {
    setDraft(v);
    setBad(false);
    if (v !== value) onChange(v);
  };
  const settle = (text: string) => {
    const v = parseDate(text);
    if (v !== null && ok(text)) commit(v);
    else setBad(true);
  };
  const problem = bad ? dateProblem(draft, min, max) : null;

  return (
    <span className="datefield" ref={box}>
      <input
        ref={input}
        className={['tnum', className, bad || invalid ? 'invalid' : ''].filter(Boolean).join(' ')}
        value={draft}
        name={name}
        id={id}
        placeholder="YYYY-MM-DD"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={10}
        aria-label={ariaLabel}
        aria-invalid={bad || invalid || undefined}
        title={problem ?? undefined}
        data-testid={testId}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          settle(e.target.value);
        }}
        onChange={(e) => {
          const el = e.target;
          const raw = el.value;
          const atEnd = el.selectionStart == null || el.selectionStart === raw.length;
          // Typing or pasting at the end lays the digits out with their dashes; deleting, or
          // editing in the middle, keeps the text as it is.
          const text = raw.length > draft.length && atEnd ? maskDate(raw) : raw;
          setDraft(text);
          setBad(false);
          const v = parseDate(text);
          if (v && text.length === 10 && ok(v) && v !== value) onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') settle(e.currentTarget.value);
          else if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault();
            setCalendar(true);
          } else if (e.key === 'Escape' && calendar) {
            e.stopPropagation();
            setCalendar(false);
          }
        }}
      />
      <button
        type="button"
        className="datefield-cal"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Choose a date"
        aria-haspopup="dialog"
        aria-expanded={calendar}
        title="Choose a date"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          setCalendar((c) => !c);
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
      </button>
      {calendar && (
        <Calendar
          value={isRealDate(value) ? value : ''}
          min={min}
          max={max}
          onPick={(v) => {
            commit(v);
            setCalendar(false);
            input.current?.focus();
          }}
          onClose={() => {
            setCalendar(false);
            input.current?.focus();
          }}
        />
      )}
    </span>
  );
}

/** A month of days; the arrows move a day or a week, PageUp/PageDown a month, Enter picks, Escape closes. */
function Calendar({
  value,
  min,
  max,
  onPick,
  onClose,
}: {
  value: string;
  min?: string;
  max?: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(() => value || localToday());
  const grid = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const d = utc(cursor);
  const y = d.getUTCFullYear(),
    m = d.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => iso(new Date(Date.UTC(y, m, i + 1)))),
  ];
  const out = (s: string) => (min != null && s < min) || (max != null && s > max);
  const now = localToday();

  // The day under the keyboard cursor holds the focus (from the moment the calendar opens).
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus();
  }, [cursor]);

  const onKey = (e: KeyboardEvent) => {
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDaysIso(cursor, -1),
      ArrowRight: () => addDaysIso(cursor, 1),
      ArrowUp: () => addDaysIso(cursor, -7),
      ArrowDown: () => addDaysIso(cursor, 7),
      PageUp: () => addMonthsIso(cursor, -1),
      PageDown: () => addMonthsIso(cursor, 1),
    };
    if (step[e.key]) {
      e.preventDefault();
      setCursor(step[e.key]());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="datefield-pop"
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={onKey}
      // inside the field's <label>: a click here must not go on to the input
      onClick={(e) => e.preventDefault()}
    >
      <div className="datefield-head">
        <button
          type="button"
          className="ghost sm"
          aria-label="Previous month"
          onClick={() => setCursor(addMonthsIso(cursor, -1))}
        >
          ‹
        </button>
        <span id={titleId} aria-live="polite">
          {MONTHS[m]} {y}
        </span>
        <button
          type="button"
          className="ghost sm"
          aria-label="Next month"
          onClick={() => setCursor(addMonthsIso(cursor, 1))}
        >
          ›
        </button>
      </div>
      <div className="datefield-grid" ref={grid} role="group" aria-labelledby={titleId}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="datefield-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((c, i) =>
          c == null ? (
            <span key={`x${i}`} />
          ) : (
            <button
              key={c}
              type="button"
              data-day={c}
              className={['ghost', c === value && 'sel', c === now && 'today'].filter(Boolean).join(' ')}
              tabIndex={c === cursor ? 0 : -1}
              disabled={out(c)}
              aria-label={c}
              aria-pressed={c === value}
              onClick={() => onPick(c)}
            >
              {+c.slice(8)}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
