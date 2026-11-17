// Form controls of the aircraft page: an editable point table, NumInput (NumberField where an empty
// field commits 0 unless optional) and Section (CardSection with the page's class).
import { type ReactNode, useId, useState } from 'react';

import { moveAt } from '../../shared/list';
import { CardSection, DragHandle, NumberField, RowRemove, useSortable } from '../../ui';

export interface NumInputProps {
  value: number | null;
  onChange: (v: number | null) => void;
  /** Allow an empty value (null). Otherwise an empty field commits 0. */
  optional?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  invalid?: boolean;
  width?: number | string;
  ariaLabel?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  /** 0 means "not set": show an empty field (with the placeholder) instead of 0. */
  zeroAsEmpty?: boolean;
  /** A heading: three digits, 0 shown as 360. */
  heading?: boolean;
}

/** The aircraft page's number input: src/ui/NumberField; an empty field commits 0 unless optional. */
export function NumInput({ optional, placeholder, ...p }: NumInputProps) {
  return (
    <NumberField
      {...p}
      optional={!!optional}
      emptyValue={optional ? undefined : 0}
      placeholder={placeholder ?? (optional ? '—' : undefined)}
    />
  );
}

/** Section card with a header and an anchor id. */
export function Section({
  id,
  title,
  intro,
  actions,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <CardSection id={id} title={title} intro={intro} actions={actions} className="ac-section">
      {children}
    </CardSection>
  );
}

/**
 * Editable table of [x, y] points (envelope vertices, compass card rows). Rows can be added,
 * removed and reordered (drag handle, or Alt+↑/↓), or, with `sortBy`, are always shown in that
 * order (kept still while a field of the table has focus); `extra` renders an additional read-only
 * cell per row. `name` names the inputs `<name>.<row>.x` / `.y`, so the save bar's issues can focus them.
 */
export function PointTable({
  points,
  onChange,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
  xProps,
  yProps,
  extra,
  extraLabel,
  addPoint,
  caption,
  minRows = 0,
  name,
  sortBy,
}: {
  points: [number, number][];
  onChange: (p: [number, number][]) => void;
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  xProps?: Partial<NumInputProps>;
  yProps?: Partial<NumInputProps>;
  extra?: (p: [number, number], i: number) => ReactNode;
  extraLabel?: string;
  addPoint?: (points: [number, number][]) => [number, number];
  caption?: string;
  minRows?: number;
  name?: string;
  /** Sort key of a point: rows shown in increasing order, not reorderable. */
  sortBy?: (p: [number, number]) => number;
}) {
  const id = useId();
  const set = (i: number, k: 0 | 1, v: number | null) =>
    onChange(points.map((p, j) => (j === i ? (k === 0 ? [v ?? 0, p[1]] : [p[0], v ?? 0]) : p)));
  const sort = useSortable({
    count: points.length,
    onMove: (from, to) => onChange(moveAt(points, from, to)),
    disabled: !!sortBy,
  });
  // sorted order, frozen while editing so a row does not move under the cursor
  const [frozen, setFrozen] = useState<number[] | null>(null);
  const sortedOrder = () =>
    points.map((_, i) => i).sort((a, b) => (sortBy ? sortBy(points[a]) - sortBy(points[b]) : 0) || a - b);
  const order = !sortBy
    ? points.map((_, i) => i)
    : frozen
      ? [...frozen.filter((i) => i < points.length), ...points.map((_, i) => i).filter((i) => !frozen.includes(i))]
      : sortedOrder();
  const add = () =>
    onChange([
      ...points,
      addPoint ? addPoint(points) : points.length ? ([...points[points.length - 1]] as [number, number]) : [0, 0],
    ]);
  return (
    <div
      className="pt-table"
      onFocus={() => {
        if (sortBy && !frozen) setFrozen(sortedOrder());
      }}
      onBlur={(e) => {
        if (sortBy && !e.currentTarget.contains(e.relatedTarget)) setFrozen(null);
      }}
    >
      <table aria-describedby={caption ? id : undefined}>
        <thead>
          <tr>
            {!sortBy && <th className="drag" />}
            {!sortBy && <th className="idx">#</th>}
            <th className="num">
              {xLabel}
              {xUnit && <span className="u"> {xUnit}</span>}
            </th>
            <th className="num">
              {yLabel}
              {yUnit && <span className="u"> {yUnit}</span>}
            </th>
            {extra && <th className="num">{extraLabel}</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {order.map((i, row) => {
            const p = points[i];
            return (
              <tr key={i} {...(sortBy ? {} : sort.itemProps(i))}>
                {!sortBy && (
                  <td className="drag">
                    <DragHandle {...sort.handleProps(i)} label={`Move point ${i + 1}`} />
                  </td>
                )}
                {!sortBy && <td className="muted idx">{row + 1}</td>}
                <td className="num">
                  <NumInput
                    value={p[0]}
                    onChange={(v) => set(i, 0, v)}
                    ariaLabel={`${xLabel} ${i + 1}`}
                    name={name && `${name}.${i}.x`}
                    {...xProps}
                  />
                </td>
                <td className="num">
                  <NumInput
                    value={p[1]}
                    onChange={(v) => set(i, 1, v)}
                    ariaLabel={`${yLabel} ${i + 1}`}
                    name={name && `${name}.${i}.y`}
                    {...yProps}
                  />
                </td>
                {extra && <td className="extra num">{extra(p, i)}</td>}
                <td className="row-tools">
                  <RowRemove
                    onClick={() => onChange(points.filter((_, j) => j !== i))}
                    disabled={points.length <= minRows}
                    label={`Remove point ${i + 1}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row pt-foot">
        <button type="button" className="ghost sm" onClick={add}>
          + Add point
        </button>
        {caption && (
          <span className="hint" id={id}>
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
