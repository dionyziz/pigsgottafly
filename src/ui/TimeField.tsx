// A clock time 'HH:MM', typed (with or without the colon: '0930', '930', '9:30', '9') or picked from
// a list of the day's times every 15 minutes that opens under it, like Google Calendar's. The list
// opens on focus and click, scrolled to the value (or the nearest time) and highlighted; typing moves
// the highlight to the nearest time. ↓/↑ move, Enter picks (what was typed, unless the arrows chose),
// Escape closes. The typed text is made 'HH:MM' on blur or Enter; text that is not a time stays as
// typed, red, and the value is left alone. A complete time ('09:30', '0930') is committed as typed. Parsing: src/shared/typedInput.ts.
import { type ReactNode, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';

import { nearestSlot, parseTime, timeSlots } from '../shared/typedInput';

/** Typed text that is a whole time, not the start of a longer one. */
const COMPLETE = /^(\d{1,2}\s*[:.h]\s*\d{2}|\d{4})z?$/i;

export interface TimeFieldProps {
  /** 'HH:MM', or '' when unset. */
  value: string;
  /** Called with 'HH:MM', or '' when cleared. */
  onChange: (v: string) => void;
  /** Minutes between the times in the list (default 15). */
  step?: number;
  /** Shown beside each time in the list (e.g. the local time of a UTC time). */
  optionNote?: (hhmm: string) => ReactNode;
  name?: string;
  id?: string;
  ariaLabel?: string;
  testId?: string;
  placeholder?: string;
  /** Marked invalid from outside (a missing required time). */
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Classes of the <input>. */
  className?: string;
  /** ?focus= deep-link key, on the input (data-focus). */
  focusKey?: string;
}

export function TimeField({
  value,
  onChange,
  step = 15,
  optionNote,
  name,
  id,
  ariaLabel,
  testId,
  placeholder = 'HH:MM',
  invalid,
  disabled,
  autoFocus,
  className,
  focusKey,
}: TimeFieldProps) {
  const slots = useMemo(() => timeSlots(step), [step]);
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // 'list': the highlight was moved with the arrows, so Enter picks it; 'typed': Enter takes the text.
  const [chose, setChose] = useState<'typed' | 'list'>('typed');
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  // A new value from outside (undo, another tab) replaces the text unless it is what is typed.
  const syncDraft = useEffectEvent(() => {
    if (!focused || parseTime(draft) !== value) setDraft(value);
  });
  useEffect(() => syncDraft(), [value]);

  const parsed = parseTime(draft);
  const bad = parsed === null;

  const show = (text: string) => {
    setOpen(true);
    setActive(nearestSlot(slots, parseTime(text) ?? ''));
    setChose('typed');
  };
  const commit = (v: string) => {
    setDraft(v);
    if (v !== value) onChange(v);
  };
  const settle = () => {
    if (parsed !== null) commit(parsed);
  };

  // Keep the highlighted time in view: centred when the list opens, nearest edge as it moves.
  const centred = useRef(false);
  useEffect(() => {
    if (!open) {
      centred.current = false;
      return;
    }
    const list = listRef.current;
    const el = active >= 0 ? (list?.children[active] as HTMLElement | undefined) : undefined;
    if (!list || !el) return;
    if (!centred.current) {
      list.scrollTop = el.offsetTop - (list.clientHeight - el.offsetHeight) / 2;
      centred.current = true;
    } else if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
  }, [open, active, listId]);

  const move = (to: number) => {
    setOpen(true);
    setActive(((to % slots.length) + slots.length) % slots.length);
    setChose('list');
  };

  return (
    <span className="timefield">
      <input
        className={['tnum', className, bad || invalid ? 'invalid' : ''].filter(Boolean).join(' ')}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        name={name}
        id={id}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        role="combobox"
        aria-label={ariaLabel}
        aria-invalid={bad || invalid || undefined}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        data-testid={testId}
        data-focus={focusKey}
        onFocus={() => {
          setFocused(true);
          show(draft);
        }}
        onClick={() => {
          if (!open) show(draft);
        }}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
          settle();
        }}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          show(text);
          // A complete time ('09:30', '9:30', '0930') counts at once; shorter digits wait for blur.
          const v = parseTime(text);
          if (v && v !== value && COMPLETE.test(text.trim())) onChange(v);
        }}
        onKeyDown={(e) => {
          const k = e.key;
          if (k === 'ArrowDown' || k === 'ArrowUp') {
            e.preventDefault();
            const d = k === 'ArrowDown' ? 1 : -1;
            if (!open) show(draft);
            else move(active < 0 ? (d > 0 ? 0 : slots.length - 1) : active + d);
          } else if ((k === 'PageDown' || k === 'PageUp') && open) {
            e.preventDefault();
            move(Math.max(0, Math.min(slots.length - 1, (active < 0 ? 0 : active) + (k === 'PageDown' ? 4 : -4))));
          } else if ((k === 'Home' || k === 'End') && open && chose === 'list') {
            e.preventDefault();
            move(k === 'Home' ? 0 : slots.length - 1);
          } else if (k === 'Enter') {
            if (open && chose === 'list' && active >= 0) commit(slots[active]);
            else settle();
            if (open) e.preventDefault();
            setOpen(false);
          } else if (k === 'Escape') {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          } else if (k === 'Tab') setOpen(false);
        }}
      />
      {open && (
        <ul
          className="combo-list timefield-list"
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel ? `${ariaLabel}: times` : 'Times'}
        >
          {slots.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={s === value ? 'current' : undefined}
              onMouseDown={(e) => {
                // keep the focus in the input; pick at once
                e.preventDefault();
                commit(s);
                setOpen(false);
              }}
              // the field's <label> would forward this click to the input (and reopen the list)
              onClick={(e) => e.preventDefault()}
              onMouseEnter={() => {
                setActive(i);
                setChose('list');
              }}
            >
              <span className="tnum">{s}</span>
              {optionNote && <span className="timefield-note tnum">{optionNote(s)}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
