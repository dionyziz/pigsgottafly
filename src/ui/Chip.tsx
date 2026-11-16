// Status chip: a pill with a tone. Variants: mono (codes), count (a number badge), sm.
import type { ReactNode } from 'react';

export type ChipTone = 'warn' | 'danger' | 'ok' | 'info' | 'accent';

export function Chip({
  tone,
  mono,
  count,
  sm,
  title,
  testId,
  className,
  children,
}: {
  tone?: ChipTone;
  /** Monospaced content (ICAO, registration). */
  mono?: boolean;
  /** A count badge: round, tabular figures. */
  count?: boolean;
  sm?: boolean;
  title?: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  const cls = ['chip', tone, mono && 'mono', count && 'count', sm && 'sm', className].filter(Boolean).join(' ');
  return (
    <span className={cls} title={title} data-testid={testId}>
      {children}
    </span>
  );
}
