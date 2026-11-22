// When, for the hangar: relative times and the cards' "Updated … by …". The entries themselves in
// words are src/shared/aircraftHistory.ts (the server writes the same lines as revision summaries).
import { editorName } from '../../shared/aircraftHistory';
import { localDayTime } from '../../shared/date';
import type { AircraftEditor } from '../../shared/sharing';

/** 'just now', '5 min ago', '3 h ago', 'yesterday', '4 days ago', else the local date. */
export function relativeTime(ms: number, now = Date.now()): string {
  const min = Math.floor((now - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  return `on ${localDayTime(ms)?.day ?? ''}`;
}

/** The hangar card's line: 'Updated 5 min ago by you'. */
export function updatedText(at: number, by: AircraftEditor | null | undefined, myId: string, now = Date.now()) {
  return `Updated ${relativeTime(at, now)}${by ? ` by ${editorName(by, myId)}` : ''}`;
}
