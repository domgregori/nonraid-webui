export function formatBytesAsMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** GB below 1024, otherwise TB — matches how disk sizes are shown elsewhere in the app. */
export function formatBytesHuman(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1024) {
    const tb = gb / 1024;
    return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`;
  }
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
}

/** Byte-scale size for file listings — unlike formatBytesHuman this covers B/KB/MB too. */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatMemLabel(usedBytes: number, totalBytes: number): string {
  const usedGb = usedBytes / (1024 * 1024 * 1024);
  const totalGb = totalBytes / (1024 * 1024 * 1024);
  return `${usedGb.toFixed(1)} / ${Math.round(totalGb)} GB`;
}
