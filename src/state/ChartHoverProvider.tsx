import { useMemo, useState, type ReactNode } from 'react';
import { ChartHoverContext } from './ChartHoverContext';

/** Wraps a group of <TimeSeriesChart>s (e.g. the History page's 6 cards) so hovering any one of
 *  them shows the crosshair/tooltip at the matching timestamp on all of them - each chart still
 *  converts the shared timestamp to its own pixel position via its own x-axis mapping, so this
 *  works correctly even across charts with different widths or (in principle) different time
 *  ranges. */
export function ChartHoverProvider({ children }: { children: ReactNode }) {
  const [hoverTs, setHoverTs] = useState<number | null>(null);
  const value = useMemo(() => ({ hoverTs, setHoverTs }), [hoverTs]);
  return <ChartHoverContext.Provider value={value}>{children}</ChartHoverContext.Provider>;
}
