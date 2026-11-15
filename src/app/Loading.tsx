// Moved to src/ui/Loading (variants screen, inline, sm; always a div). This shim keeps the old API:
// <Loading /> inline (a span, for use inside text), <Loading screen /> centred in the viewport.
import { Loading as UiLoading, LoadingMark } from '../ui/Loading';

export function Loading({ screen = false, label = 'Loading…' }: { screen?: boolean; label?: string }) {
  return screen ? <UiLoading variant="screen" label={label} /> : <LoadingMark label={label} />;
}
