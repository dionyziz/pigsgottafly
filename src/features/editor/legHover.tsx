// The setter has its own context so the navlog rows that set it do not re-render when it changes.
import { createContext, type ReactNode, use, useState } from 'react';

const LegContext = createContext<number | null>(null);
const SetLegContext = createContext<(i: number | null) => void>(() => {});

export function LegHoverProvider({ children }: { children: ReactNode }) {
  const [leg, setLeg] = useState<number | null>(null);
  return (
    <SetLegContext value={setLeg}>
      <LegContext value={leg}>{children}</LegContext>
    </SetLegContext>
  );
}

/** Leg i is route point i → i + 1; null = none. */
export const useHoveredLeg = () => use(LegContext);
export const useSetHoveredLeg = () => use(SetLegContext);
