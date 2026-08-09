interface ProgressBarProps {
  pct?: number;
  color: string;
  height?: number;
  className?: string;
  /** Unknown duration/progress (e.g. a benchmark run with no total to measure against) — an
   *  animated sweep instead of a stalled bar sitting at some arbitrary width. `pct` is ignored. */
  indeterminate?: boolean;
}

export function ProgressBar({ pct = 0, color, height, className, indeterminate }: ProgressBarProps) {
  return (
    <div className={`progress-track${className ? ` ${className}` : ''}`} style={height ? { height } : undefined}>
      <div
        className={`progress-track__fill${indeterminate ? ' progress-track__fill--indeterminate' : ''}`}
        style={indeterminate ? { background: color } : { width: `${pct}%`, background: color }}
      />
    </div>
  );
}
