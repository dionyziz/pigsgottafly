// Aerodrome type-ahead over the AIRAC reference list (ICAO or name). The text field keeps what the
// pilot typed; picking a suggestion fills in the aerodrome id (ICAO where there is one). The caller
// resolves the text with resolveAerodrome() before saving.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AERODROMES, aerodrome } from '../../data/ref';
import type { RefAerodrome } from '../../shared';
import '../lobby/lists.css';

/** The aerodrome a typed text names: exact id/ICAO, else a unique name match. */
export function resolveAerodrome(text: string): RefAerodrome | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const exact = aerodrome(t);
  if (exact) return exact;
  const u = t.toUpperCase();
  const byName = AERODROMES.filter((a) => a.name.toUpperCase() === u);
  return byName.length === 1 ? byName[0] : undefined;
}

/** Suggestions for a query: ICAO prefix matches first, then name matches. */
export function searchAerodromes(q: string, limit = 8): RefAerodrome[] {
  const u = q.trim().toUpperCase();
  if (!u) return [];
  const score = (a: RefAerodrome) => {
    const code = (a.icao || a.id).toUpperCase();
    if (code === u) return 0;
    if (code.startsWith(u)) return 1;
    if (a.name.toUpperCase().split(/[\s/,-]+/).some((w) => w.startsWith(u))) return 2;
    if (a.name.toUpperCase().includes(u)) return 3;
    return 9;
  };
  return AERODROMES.map((a) => [score(a), a] as const)
    .filter(([s]) => s < 9)
    .sort((x, y) => x[0] - y[0] || (x[1].icao ? 0 : 1) - (y[1].icao ? 0 : 1) || x[1].name.localeCompare(y[1].name))
    .slice(0, limit)
    .map(([, a]) => a);
}

export function AerodromePicker({ name, value, onChange, required, placeholder = 'ICAO or name, e.g. LGTT', autoFocus }: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  useEffect(() => cancelClose, []);
  const hits = useMemo(() => searchAerodromes(value), [value]);
  const resolved = resolveAerodrome(value);
  const showList = open && hits.length > 0 && !(resolved && hits.length === 1 && (hits[0].icao || hits[0].id) === value.toUpperCase());

  const pick = (a: RefAerodrome) => { onChange(a.icao || a.id); setOpen(false); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active] ?? hits[0]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="combo">
      <input name={name} value={value} required={required} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus}
        role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
        className={value.trim() && !resolved && !open ? 'invalid' : undefined}
        onChange={(e) => { cancelClose(); onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => { cancelClose(); setOpen(true); }} onBlur={() => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 120); }} onKeyDown={onKey} />
      {showList && (
        <ul className="combo-list" id={listId} role="listbox">
          {hits.map((a, i) => (
            <li key={a.id} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(a); }} onMouseEnter={() => setActive(i)}>
              <span className="code">{a.icao || '—'}</span><span className="nm">{a.name}</span>
            </li>
          ))}
        </ul>
      )}
      {value.trim() ? (
        resolved ? <div className="combo-hint ok">{resolved.name}{resolved.elevFt != null ? ` · elevation ${resolved.elevFt} ft` : ''}</div>
          : !open && <div className="combo-hint bad">Not an aerodrome in the current AIP</div>
      ) : null}
    </div>
  );
}
