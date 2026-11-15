// Form controls for the aircraft page: an editable point table. NumInput, Field, IssueList, Check
// and Section moved to src/ui (NumberField, Field, IssueList, Check, CardSection) and are
// re-exported here for the old imports.
import { useId, type ReactNode } from 'react';
import { parseDecimal } from '../../shared/number';
import { CardSection, NumberField } from '../../ui';

export { Check, Field, IssueList } from '../../ui';

/** Parses a number typed with '.' or ','; '' -> null; NaN for garbage. */
export const parseNum = parseDecimal;

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
}

/** The aircraft page's number input: src/ui/NumberField; an empty field commits 0 unless optional. */
export function NumInput({ optional, placeholder, ...p }: NumInputProps) {
  return <NumberField {...p} optional={!!optional} emptyValue={optional ? undefined : 0} placeholder={placeholder ?? (optional ? '—' : undefined)} />;
}

/** Section card with a header and an anchor id. */
export function Section({ id, title, intro, actions, children }: { id: string; title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <CardSection id={id} title={title} intro={intro} actions={actions} className="ac-section">{children}</CardSection>;
}

/**
 * Editable table of [x, y] points (envelope vertices, compass card rows). Rows can be added,
 * removed and moved; `extra` renders an additional read-only cell per row.
 */
export function PointTable({ points, onChange, xLabel, yLabel, xUnit, yUnit, xProps, yProps, extra, extraLabel, addPoint, caption, minRows = 0 }: {
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
}) {
  const id = useId();
  const set = (i: number, k: 0 | 1, v: number | null) => onChange(points.map((p, j) => (j === i ? (k === 0 ? [v ?? 0, p[1]] : [p[0], v ?? 0]) : p)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= points.length) return;
    const n = points.slice();
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  const add = () => onChange([...points, addPoint ? addPoint(points) : (points.length ? [...points[points.length - 1]] as [number, number] : [0, 0])]);
  return (
    <div className="pt-table">
      <table aria-describedby={caption ? id : undefined}>
        <thead><tr><th>#</th><th>{xLabel}{xUnit && <span className="u"> {xUnit}</span>}</th><th>{yLabel}{yUnit && <span className="u"> {yUnit}</span>}</th>{extra && <th>{extraLabel}</th>}<th /></tr></thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td className="muted idx">{i + 1}</td>
              <td><NumInput value={p[0]} onChange={(v) => set(i, 0, v)} ariaLabel={`${xLabel} ${i + 1}`} {...xProps} /></td>
              <td><NumInput value={p[1]} onChange={(v) => set(i, 1, v)} ariaLabel={`${yLabel} ${i + 1}`} {...yProps} /></td>
              {extra && <td className="extra">{extra(p, i)}</td>}
              <td className="row-tools">
                <button type="button" className="icon sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" title="Move up">↑</button>
                <button type="button" className="icon sm" onClick={() => move(i, 1)} disabled={i === points.length - 1} aria-label="Move down" title="Move down">↓</button>
                <button type="button" className="icon sm danger" onClick={() => onChange(points.filter((_, j) => j !== i))} disabled={points.length <= minRows} aria-label="Remove row" title="Remove">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row pt-foot">
        <button type="button" className="ghost sm" onClick={add}>+ Add point</button>
        {caption && <span className="hint" id={id}>{caption}</span>}
      </div>
    </div>
  );
}
