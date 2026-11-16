// Pick a person (a passenger) by name, on Combobox; optionally create one from the typed name.
import { useMemo, useState } from 'react';
import { Combobox } from './Combobox';
import { Icon } from './Icon';

export interface PickablePerson {
  id: string;
  fullName: string;
  weightKg?: number | null;
}

type Opt<P> = { kind: 'person'; p: P } | { kind: 'new'; name: string };

/** People whose name contains the query (case-insensitive), not excluded, at most `limit`. */
export function matchPeople<P extends PickablePerson>(
  people: P[],
  query: string,
  exclude?: ReadonlySet<string>,
  limit = 8,
): P[] {
  const q = query.trim().toLowerCase();
  return people
    .filter((p) => !exclude?.has(p.id))
    .filter((p) => !q || p.fullName.toLowerCase().includes(q))
    .slice(0, limit);
}

export function PersonPicker<P extends PickablePerson>({
  people,
  exclude,
  onPick,
  onCreate,
  placeholder = 'Add passenger…',
  disabled,
  testId,
  ariaLabel,
  detail,
}: {
  people: P[];
  /** Ids not offered (already on board). */
  exclude?: ReadonlySet<string>;
  onPick: (p: P) => void;
  /** Offer "Create “<typed name>”" as the last option. */
  onCreate?: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  ariaLabel?: string;
  /** Right-hand detail of an option (default: the weight). */
  detail?: (p: P) => string;
}) {
  const [query, setQuery] = useState('');
  const options = useMemo<Opt<P>[]>(
    () => [
      ...matchPeople(people, query, exclude).map((p) => ({ kind: 'person' as const, p })),
      ...(onCreate && query.trim() ? [{ kind: 'new' as const, name: query.trim() }] : []),
    ],
    [people, query, exclude, onCreate],
  );
  const right = detail ?? ((p: P) => (p.weightKg != null ? `${p.weightKg} kg` : 'no weight'));
  return (
    <Combobox<Opt<P>>
      className="person-picker"
      text={query}
      onText={setQuery}
      options={options}
      optionKey={(o) => (o.kind === 'person' ? o.p.id : 'new')}
      renderOption={(o) =>
        o.kind === 'person' ? (
          <>
            <span className="nm-main">{o.p.fullName}</span>
            <span className="muted tnum">{right(o.p)}</span>
          </>
        ) : (
          <>
            <span className="nm-main">
              <Icon name="plus" size={14} /> Create “{o.name}”
            </span>
            <span className="muted">new passenger</span>
          </>
        )
      }
      onPick={(o) => {
        setQuery('');
        if (o.kind === 'person') onPick(o.p);
        else onCreate?.(o.name);
      }}
      placeholder={placeholder}
      disabled={disabled}
      testId={testId}
      ariaLabel={ariaLabel ?? placeholder}
    />
  );
}
