// Keeps one failing part of a page (e.g. the map) from blanking the whole app.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reloadForNewBuild, staleReloadPending, staleReloadPendingFor } from './staleBuild';
import { Loading } from '../ui/Loading';
import { reportError } from './errorReporter';

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null; reloading: boolean }> {
  static getDerivedStateFromError(error: Error) { return { error }; }
  override state = { error: null as Error | null, reloading: false };
  private timer: ReturnType<typeof setTimeout> | undefined;
  override componentWillUnmount() { clearTimeout(this.timer); }
  override componentDidCatch(error: Error, info?: ErrorInfo) {
    // A new version was deployed while this page was open: load it instead of showing an error.
    if (isChunkLoadError(error) && reloadForNewBuild()) { this.setState({ reloading: true }); return; }
    // A stale-build reload is on its way (any error now is most likely its fallout): keep showing the
    // loading screen; should the reload not land, show the error once the window has passed.
    if (staleReloadPending()) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.forceUpdate(), staleReloadPendingFor() + 50);
      return;
    }
    console.error(error);
    reportError(error, 'react', info?.componentStack ?? undefined);
  }
  override render() {
    // a stale chunk: the page is reloading onto the new build; never flash an error meanwhile
    if (this.state.error && (this.state.reloading || isChunkLoadError(this.state.error) || staleReloadPending())) return <Loading variant="screen" />;
    if (this.state.error) {
      return (
        <div className="center-screen" role="alert">
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <b>{this.props.label ?? 'Something went wrong'}</b>
            <span className="muted">{this.state.error.message}</span>
            <button onClick={() => this.setState({ error: null })}>Try again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
