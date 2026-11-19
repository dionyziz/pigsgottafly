// The navlog leg under the pointer, highlighted on the map (marching dashes along it). The setter
// has its own context so the navlog rows that set it do not re-render when it changes.
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

/** Index of the hovered leg (route point i → i + 1), null = none. */
export const useHoveredLeg = () => use(LegContext);
export const useSetHoveredLeg = () => use(SetLegContext);
