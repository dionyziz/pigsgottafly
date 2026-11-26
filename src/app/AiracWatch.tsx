// A page left open across the date a shipped AIRAC cycle takes effect still shows the cycle it loaded with
// (src/data/ref picks it once, on load): offer the reload when the new cycle starts and whenever the pilot
// comes back to the tab until they take it.
import { useEffect } from 'react';

import { AIRAC, airacInEffect, NEXT_AIRAC_AT } from '../data/ref';
import { useToast } from './toast';

/** setTimeout's longest delay (about 24.8 days); a later cycle start is checked on the next visit instead. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export function AiracWatch() {
  const toast = useToast();
  useEffect(() => {
    const check = () => {
      const now = airacInEffect();
      if (now.id === AIRAC.id) return;
      toast(`${now.name} is in effect: reload for the new AIP data.`, {
        label: 'Reload',
        onClick: () => window.location.reload(),
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const wait = NEXT_AIRAC_AT === null ? null : NEXT_AIRAC_AT - Date.now();
    const timer = wait !== null && wait > 0 && wait < MAX_TIMER_MS ? setTimeout(check, wait + 1000) : null;
    check();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearTimeout(timer);
    };
  }, [toast]);
  return null;
}
