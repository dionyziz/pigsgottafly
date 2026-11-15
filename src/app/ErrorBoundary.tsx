// Keeps one failing part of a page (e.g. the map) from blanking the whole app.
import { Component, type ReactNode } from 'react';
import { isChunkLoadError, reloadForNewBuild } from './staleBuild';
import { Loading } from './Loading';

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null; reloading: boolean }> {
  static getDerivedStateFromError(error: Error) { return { error }; }
  override state = { error: null as Error | null, reloading: false };
  override componentDidCatch(error: Error) {
    // A new version was deployed while this page was open: load it instead of showing an error.
    if (isChunkLoadError(error) && reloadForNewBuild()) { this.setState({ reloading: true }); return; }
    console.error(error);
  }
  override render() {
    // a stale chunk: the page is reloading onto the new build; never flash an error meanwhile
    if (this.state.error && (this.state.reloading || isChunkLoadError(this.state.error))) return <Loading screen />;
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
