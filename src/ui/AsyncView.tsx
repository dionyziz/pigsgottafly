// Empty state, and the error / loading / empty / no-match switch of a loaded list.
import type { ReactNode } from 'react';
import { Loading } from './Loading';

export function EmptyState({
  title,
  children,
  action,
  testId,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="empty card" data-testid={testId}>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/**
 * Renders `children(data)` once data is there. Before that: the error (with Try again) or the
 * loading animation. With data: `empty` when `isEmpty(data)`, `noMatch` when `isNoMatch(data)`
 * (a search that finds nothing). Data that is already there stays on screen during a reload.
 */
export function AsyncView<T>({
  data,
  error,
  loading,
  reload,
  errorTitle = 'Could not load',
  isEmpty,
  empty,
  isNoMatch,
  noMatch,
  children,
}: {
  data: T | undefined;
  error?: Error | null;
  loading?: boolean;
  reload?: () => void;
  errorTitle?: string;
  isEmpty?: (d: T) => boolean;
  empty?: ReactNode;
  isNoMatch?: (d: T) => boolean;
  noMatch?: ReactNode;
  children: (d: T) => ReactNode;
}) {
  if (data === undefined) {
    if (error) {
      return (
        <EmptyState
          title={errorTitle}
          testId="async-error"
          action={
            reload ? (
              <button type="button" onClick={() => reload()}>
                Try again
              </button>
            ) : undefined
          }
        >
          {error.message}
        </EmptyState>
      );
    }
    return loading === false ? null : <Loading />;
  }
  if (empty !== undefined && isEmpty?.(data)) return <>{empty}</>;
  if (noMatch !== undefined && isNoMatch?.(data)) return <>{noMatch}</>;
  return <>{children(data)}</>;
}
