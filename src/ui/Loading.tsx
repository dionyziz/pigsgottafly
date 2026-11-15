// "Loading…" with a small airplane flying a loop beside it. Always a block (a div):
//   screen  centred in the viewport (route-level loads)
//   inline  a padded block in the page flow (lists, panels)
//   sm      compact, for a panel row or a table cell
export type LoadingVariant = 'screen' | 'inline' | 'sm';

/** The airplane and the label (an inline element). */
export function LoadingMark({ label = 'Loading…', sm = false }: { label?: string; sm?: boolean }) {
  return (
    <span className={'loading' + (sm ? ' sm' : '')} role="status" aria-live="polite">
      <span className="loading-plane" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 15.5v-1.8l-7.8-4.9V3.4C13.2 2.6 12.6 2 12 2s-1.2.6-1.2 1.4v5.4L3 13.7v1.8l7.8-2.4v5.3l-2.2 1.6V21l3.4-1 3.4 1v-1.1l-2.2-1.6v-5.3z" /></svg>
      </span>
      <span>{label}</span>
    </span>
  );
}

export function Loading({ variant = 'inline', label, testId }: { variant?: LoadingVariant; label?: string; testId?: string }) {
  const cls = variant === 'screen' ? 'loading-screen' : variant === 'sm' ? 'loading-block sm' : 'loading-block';
  return <div className={cls} data-testid={testId}><LoadingMark label={label} sm={variant === 'sm'} /></div>;
}
