// Each warning links to where it is fixed (fix.ts); those fixed elsewhere come back here (back.ts).
import type { ReactNode } from 'react';
import { useParams } from 'react-router';

import { useWithBack } from '../../app/back';
import { type WarningLevel, WarningList } from '../../ui';
import { type Fix, type FixContext, fixLink, planningFix } from './fix';

export type ExportWarning = string | { text: string; fix?: Fix | null };

interface Entry {
  level: WarningLevel;
  text: string;
  fix: Fix | null;
}

/**
 * Nothing when there are no warnings. `fixes`: by warning text; warnings without one are mapped by
 * planningFix() (planning texts from src/calc) unless `classify` is false.
 */
export function ExportWarnings({
  warnings,
  fixes = {},
  aircraftId,
  classify = true,
  title,
  level = 'warn',
  className,
  testId,
}: {
  warnings: readonly ExportWarning[];
  fixes?: Record<string, Fix>;
  aircraftId?: string | null;
  classify?: boolean;
  title?: ReactNode;
  /** 'danger' when the warnings block the document (an incomplete flight plan). */
  level?: 'warn' | 'danger';
  className?: string;
  testId?: string;
}) {
  const { id } = useParams();
  const withBack = useWithBack();
  if (!warnings.length) return null;
  const ctx: FixContext = { flightId: id, aircraftId };
  const entries: Entry[] = warnings.map((w) => {
    const text = typeof w === 'string' ? w : w.text;
    const given = typeof w === 'string' ? undefined : w.fix;
    return { level, text, fix: given ?? fixes[text] ?? (classify ? planningFix(text) : null) };
  });
  return (
    <div
      className={`export-warnings ${level} no-print${className ? ' ' + className : ''}`}
      role="note"
      data-testid={testId}
    >
      {title && <strong className="export-warnings-title">{title}</strong>}
      <WarningList
        warnings={entries}
        fix={(e) => {
          const l = e.fix ? fixLink(e.fix, ctx) : null;
          return l && { ...l, to: withBack(l.to) };
        }}
      />
    </div>
  );
}
