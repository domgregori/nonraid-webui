import { createContext, useContext, useState } from 'react';

export interface ChartHoverContextValue {
  hoverTs: number | null;
  setHoverTs: (ts: number | null) => void;
}

// Default no-op implementation — a <TimeSeriesChart> used outside a <ChartHoverProvider> still
// works standalone, it just doesn't sync with any other chart (setHoverTs is a real setState here
// too, so the chart's own crosshair/tooltip still works, just unshared).
export const ChartHoverContext = createContext<ChartHoverContextValue | null>(null);

/** Standalone fallback (own local state) when there's no provider — see the module doc comment. */
export function useChartHover(): ChartHoverContextValue {
  const ctx = useContext(ChartHoverContext);
  const [localHoverTs, setLocalHoverTs] = useState<number | null>(null);
  if (ctx) return ctx;
  return { hoverTs: localHoverTs, setHoverTs: setLocalHoverTs };
}
