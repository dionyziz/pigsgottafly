// Keeps one failing part of a page (e.g. the map) from blanking the whole app.
import { Component, type ReactNode } from 'react';
import { isChunkLoadError, reloadForNewBuild } from './staleBuild';

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error) {
    // A new version was deployed while this page was open: load it instead of showing an error.
    if (isChunkLoadError(error) && reloadForNewBuild()) return;
    console.error(error);
  }
  override render() {
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
