// Small shared formatters so every screen renders bytes/percentages/timestamps the same way -
// deliberately not the full formatBytesHuman etc. from the web frontend's src/utils/format.ts,
// which isn't reachable from this independent package (see api/types.ts's own doc comment on why
// cli/ doesn't import from src/ or backend/src).

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatPercent(n: number | null | undefined): string {
  return n === null || n === undefined ? '-' : `${n.toFixed(0)}%`;
}

export function formatRelativeTime(ms: number | null | undefined): string {
  if (!ms) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
