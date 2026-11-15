// "Loading…" with a small airplane flying a loop beside it. `screen` centres it in the viewport.
export function Loading({ screen = false, label = 'Loading…' }: { screen?: boolean; label?: string }) {
  const body = (
    <span className="loading" role="status" aria-live="polite">
      <span className="loading-plane" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 15.5v-1.8l-7.8-4.9V3.4C13.2 2.6 12.6 2 12 2s-1.2.6-1.2 1.4v5.4L3 13.7v1.8l7.8-2.4v5.3l-2.2 1.6V21l3.4-1 3.4 1v-1.1l-2.2-1.6v-5.3z" /></svg>
      </span>
      <span>{label}</span>
    </span>
  );
  return screen ? <div className="loading-screen">{body}</div> : body;
}
