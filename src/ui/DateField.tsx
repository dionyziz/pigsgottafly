// A date 'YYYY-MM-DD', typed as digits (the dashes go in as the year and the month are complete:
// '20261116' → '2026-11-16'), pasted ('2026-11-16', '2026/11/16', '20261116'), or picked on a small
// month calendar (the button at the right; Alt+↓ from the input; its title browses years, then
// months; it floats above the page, below the field or above it when there is no room below, so a
// dialog's scrolling body never clips it). A complete real date within [min, max] is committed as it is typed; anything else turns
// the field red on blur or Enter and leaves the value alone. Parsing: src/shared/typedInput.ts.
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

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
  const pop = useRef<HTMLDivElement>(null);

  const syncDraft = useEffectEvent(() => {
    if (!focused || parseDate(draft) !== value) {
      setDraft(value);
      setBad(false);
    }
  });
  useEffect(() => syncDraft(), [value]);

  useEffect(() => {
    if (!calendar) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current && !box.current.contains(t) && !pop.current?.contains(t)) setCalendar(false);
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
      {calendar &&
        createPortal(
          <Calendar
            anchor={box}
            pop={pop}
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
          />,
          document.body,
        )}
    </span>
  );
}

type View = 'day' | 'month' | 'year';
/** Years on one page of the year grid (5 rows of 4), starting at a multiple of it: 2000–2019. */
const YEARS = 20;
// Keyboard steps per view: [n] is n days, a plain n is n months.
const STEPS: Record<View, Record<string, number | [number]>> = {
  day: { ArrowLeft: [-1], ArrowRight: [1], ArrowUp: [-7], ArrowDown: [7], PageUp: -1, PageDown: 1 },
  month: { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 },
  year: { ArrowLeft: -12, ArrowRight: 12, ArrowUp: -48, ArrowDown: 48, PageUp: -12 * YEARS, PageDown: 12 * YEARS },
};
const HEAD: Record<View, [prev: string, next: string, page: number]> = {
  day: ['Previous month', 'Next month', 1],
  month: ['Previous year', 'Next year', 12],
  year: ['Previous years', 'Next years', 12 * YEARS],
};

/** Places the fixed popover at its field: below it, or above it when only there it fits; within the window. */
function place(anchor: HTMLElement, el: HTMLElement) {
  const GAP = 4,
    EDGE = 8;
  const r = anchor.getBoundingClientRect();
  const h = el.offsetHeight,
    w = el.offsetWidth;
  const vh = window.innerHeight,
    vw = window.innerWidth;
  let top = r.bottom + GAP;
  if (top + h > vh - EDGE) {
    const above = r.top - GAP - h;
    top = above >= EDGE ? above : Math.max(EDGE, vh - EDGE - h);
  }
  const left = Math.max(EDGE, Math.min(r.left, vw - EDGE - w));
  const t = `${Math.round(top)}px`,
    l = `${Math.round(left)}px`;
  if (el.style.top !== t) el.style.top = t;
  if (el.style.left !== l) el.style.left = l;
}

function Calendar({
  anchor,
  pop,
  value,
  min,
  max,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  pop: RefObject<HTMLDivElement | null>;
  value: string;
  min?: string;
  max?: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(() => value || localToday());
  const [view, setView] = useState<View>('day');
  const grid = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const d = utc(cursor);
  const y = d.getUTCFullYear(),
    m = d.getUTCMonth();
  const now = localToday();
  /** The whole span [a, b] is outside [min, max]. */
  const out = (a: string, b = a) => (min != null && b < min) || (max != null && a > max);

  // Placed before paint, and again on every frame while open: the field moves as the page or a
  // dialog's body scrolls, the window resizes or the content around it changes.
  useLayoutEffect(() => {
    if (anchor.current && pop.current) place(anchor.current, pop.current);
  });
  useEffect(() => {
    let frame = 0;
    const again = () => {
      if (anchor.current && pop.current) place(anchor.current, pop.current);
      frame = requestAnimationFrame(again);
    };
    frame = requestAnimationFrame(again);
    return () => cancelAnimationFrame(frame);
  }, [anchor, pop]);

  // The cell under the keyboard cursor holds the focus (from the moment the calendar opens).
  useEffect(() => {
    const at = { day: cursor, month: cursor.slice(0, 7), year: cursor.slice(0, 4) }[view];
    grid.current?.querySelector<HTMLButtonElement>(`[data-${view}="${at}"]`)?.focus();
  }, [cursor, view]);

  const move = (n: number | [number]) =>
    setCursor(typeof n === 'number' ? addMonthsIso(cursor, n) : addDaysIso(cursor, n[0]));

  const onKey = (e: KeyboardEvent) => {
    const n = STEPS[view][e.key];
    if (n !== undefined) {
      e.preventDefault();
      move(n);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (view === 'year') setView('month');
      else if (view === 'month') setView('day');
      else onClose();
    }
  };

  /** A month or a year cell: picking it narrows the cursor to it and opens the next level down. */
  const cell = (k: string, label: string, text: string, span: [string, string], to: string, next: View) => (
    <button
      key={k}
      type="button"
      {...{ [`data-${view}`]: k }}
      className={['ghost', value.startsWith(k) && 'sel', now.startsWith(k) && 'today'].filter(Boolean).join(' ')}
      tabIndex={cursor.startsWith(k) ? 0 : -1}
      disabled={out(...span)}
      aria-label={label}
      aria-pressed={value.startsWith(k)}
      onClick={() => {
        setCursor(to);
        setView(next);
      }}
    >
      {text}
    </button>
  );

  const from = Math.floor(y / YEARS) * YEARS;
  let title: string;
  let cells;
  if (view === 'day') {
    title = `${MONTHS[m]} ${y}`;
    const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday first
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const list: (string | null)[] = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, i) => iso(new Date(Date.UTC(y, m, i + 1)))),
    ];
    cells = [
      ...WEEKDAYS.map((w) => (
        <span key={w} className="datefield-wd" aria-hidden="true">
          {w}
        </span>
      )),
      ...list.map((c, i) =>
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
      ),
    ];
  } else if (view === 'month') {
    title = String(y);
    cells = MONTHS.map((name, i) => {
      const k = `${y}-${pad2(i + 1)}`;
      const last = iso(new Date(Date.UTC(y, i + 1, 0)));
      return cell(k, `${name} ${y}`, name.slice(0, 3), [`${k}-01`, last], addMonthsIso(cursor, i - m), 'day');
    });
  } else {
    title = `${from} – ${from + YEARS - 1}`;
    cells = Array.from({ length: YEARS }, (_, i) => {
      const k = String(from + i);
      return cell(k, k, k, [`${k}-01-01`, `${k}-12-31`], addMonthsIso(cursor, (from + i - y) * 12), 'month');
    });
  }
  const [prevLabel, nextLabel, page] = HEAD[view];

  return (
    <div
      ref={pop}
      className="datefield-pop"
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={onKey}
      // the field's <label> is its React parent: a click here must not go on to the input
      onClick={(e) => e.preventDefault()}
    >
      <div className="datefield-head">
        <button type="button" className="ghost sm" aria-label={prevLabel} onClick={() => move(-page)}>
          ‹
        </button>
        {view === 'year' ? (
          <span id={titleId} className="datefield-title" aria-live="polite">
            {title}
          </span>
        ) : (
          <button
            type="button"
            id={titleId}
            className="ghost sm datefield-title"
            aria-live="polite"
            onClick={() => setView('year')}
          >
            {title}
          </button>
        )}
        <button type="button" className="ghost sm" aria-label={nextLabel} onClick={() => move(page)}>
          ›
        </button>
      </div>
      <div className={`datefield-grid ${view}`} ref={grid} role="group" aria-labelledby={titleId}>
        {cells}
      </div>
    </div>
  );
}
