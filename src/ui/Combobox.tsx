// Type-ahead: a text input with a listbox of options under it. The caller owns the text and the
// options; the combobox owns the open state, the active option and the keys:
//   ↓ opens / next, ↑ previous, Enter picks the active option, Escape closes (and does not close
//   the dialog around it), Tab closes. A click on an option picks it; blur closes after a moment
//   (so the click lands).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';

export interface ComboKeyState {
  open: boolean;
  active: number;
  count: number;
}
export interface ComboKeyResult {
  open: boolean;
  active: number;
  pick?: number;
  handled: boolean;
}

/** Key handling of a combobox, without the DOM (unit-tested). */
export function comboKey(s: ComboKeyState, key: string): ComboKeyResult {
  const showing = s.open && s.count > 0;
  const clamp = (i: number) => Math.max(0, Math.min(s.count - 1, i));
  switch (key) {
    case 'ArrowDown':
      if (!showing) return { open: true, active: 0, handled: s.count > 0 };
      return { open: true, active: s.active >= s.count - 1 ? 0 : s.active + 1, handled: true };
    case 'ArrowUp':
      if (!showing) return { open: s.open, active: s.active, handled: false };
      return { open: true, active: s.active <= 0 ? s.count - 1 : s.active - 1, handled: true };
    case 'Home':
    case 'End':
      if (!showing) return { open: s.open, active: s.active, handled: false };
      return { open: true, active: key === 'Home' ? 0 : s.count - 1, handled: true };
    case 'Enter':
      if (!showing) return { open: s.open, active: s.active, handled: false };
      return { open: false, active: 0, pick: clamp(s.active), handled: true };
    case 'Escape':
      return { open: false, active: 0, handled: showing };
    case 'Tab':
      return { open: false, active: 0, handled: false };
    default:
      return { open: s.open, active: s.active, handled: false };
  }
}

export interface ComboboxProps<T> {
  /** The text in the input. */
  text: string;
  onText: (s: string) => void;
  options: T[];
  optionKey: (o: T) => string;
  renderOption: (o: T) => ReactNode;
  onPick: (o: T) => void;
  /** Keep the list closed even with options (e.g. the text already names the only option). */
  suppress?: boolean;
  name?: string;
  id?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  testId?: string;
  /** Classes of the <input> (e.g. 'invalid', 'upper'). */
  inputClassName?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Called with the open state, for status lines that hide while the list is open. */
  onOpenChange?: (open: boolean) => void;
  /** Rendered under the input (a status line). */
  children?: ReactNode;
}

export function Combobox<T>({
  text,
  onText,
  options,
  optionKey,
  renderOption,
  onPick,
  suppress,
  name,
  id,
  placeholder,
  required,
  autoFocus,
  disabled,
  ariaLabel,
  testId,
  inputClassName,
  className,
  inputRef,
  onFocus,
  onBlur,
  onOpenChange,
  children,
}: ComboboxProps<T>) {
  const [open, setOpenState] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  useEffect(() => cancelClose, []);
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  const showList = open && !suppress && options.length > 0;
  const act = Math.min(active, Math.max(0, options.length - 1));

  const pick = (o: T) => {
    onPick(o);
    setOpen(false);
    setActive(0);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const r = comboKey({ open: open && !suppress, active: act, count: options.length }, e.key);
    if (r.handled) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (r.pick != null && options[r.pick]) {
      pick(options[r.pick]);
      return;
    }
    if (r.open !== open) setOpen(r.open);
    setActive(r.active);
  };

  return (
    <div className={'combo' + (className ? ' ' + className : '')}>
      <input
        ref={inputRef}
        name={name}
        id={id}
        value={text}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={showList ? `${listId}-${act}` : undefined}
        className={inputClassName}
        data-testid={testId}
        onChange={(e) => {
          cancelClose();
          onText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => {
          cancelClose();
          setOpen(true);
          onFocus?.();
        }}
        onBlur={() => {
          cancelClose();
          closeTimer.current = setTimeout(() => setOpen(false), 120);
          onBlur?.();
        }}
        onKeyDown={onKey}
      />
      {showList && (
        <ul className="combo-list" id={listId} role="listbox">
          {options.map((o, i) => (
            <li
              key={optionKey(o)}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === act}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {renderOption(o)}
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}
