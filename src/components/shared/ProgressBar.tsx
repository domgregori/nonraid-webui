interface ProgressBarProps {
  pct: number;
  color: string;
  height?: number;
  className?: string;
}

export function ProgressBar({ pct, color, height, className }: ProgressBarProps) {
  return (
    <div className={`progress-track${className ? ` ${className}` : ''}`} style={height ? { height } : undefined}>
      <div className="progress-track__fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
