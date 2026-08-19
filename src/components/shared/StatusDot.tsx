interface StatusDotProps {
  color: string;
  size?: number;
  className?: string;
}

export function StatusDot({ color, size = 7, className }: StatusDotProps) {
  return (
    <span
      className={className}
      style={{ display: 'inline-block', width: size, height: size, borderRadius: 999, background: color }}
    />
  );
}
