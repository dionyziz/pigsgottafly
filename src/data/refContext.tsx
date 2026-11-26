// The reference data of the flight on screen (the cycle in effect on its date) for the components and hooks under
// it: the editor provides it; anything else (lobby, profile) gets today's. The exports take the flight's directly.
import { createContext, type ReactNode, use, useMemo } from 'react';

import { refOfFlight, refToday, type RefView } from './ref';

const RefContext = createContext<RefView | null>(null);

export function FlightRefProvider({ date, children }: { date: string | null | undefined; children: ReactNode }) {
  const view = useMemo(() => refOfFlight(date), [date]);
  return <RefContext value={view}>{children}</RefContext>;
}

export function useRefData(): RefView {
  return use(RefContext) ?? refToday();
}
