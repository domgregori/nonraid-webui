import { runSudoMaybe } from './procUtil.js';

export type LogSourceId = 'webui' | 'kernel' | 'nfs' | 'smb' | 'ssh' | 'docker' | 'lxc' | 'smart';

export interface LogSourceDef {
  id: LogSourceId;
  label: string;
  /** journalctl selector args, e.g. ['-u', 'nonraid-webui'] or ['-k'] for the kernel ring buffer. */
  args: string[];
}

// Unit names mirror SERVICE_DEFS in services.ts (nfs/smb/ssh/docker/lxc) rather than inventing a
// second mapping - same units the Services section already starts/stops/monitors. `kernel` reads
// via journald's kernel ring buffer (`-k`) instead of raw `dmesg`: it survives reboots (this rig
// has persistent journal storage, confirmed via systemd-journal-flush.service) and supports
// `--since`, which a wrapping ring buffer does not. `smart` is included because SMART daemon
// output is directly relevant to diagnosing this appliance's disks; broader "every unit on the
// box" sources (cron, systemd internals, etc.) are deliberately left out as noise.
export const LOG_SOURCE_DEFS: LogSourceDef[] = [
  { id: 'webui', label: 'nonraid-webui', args: ['-u', 'nonraid-webui'] },
  { id: 'kernel', label: 'Kernel / Driver', args: ['-k'] },
  { id: 'nfs', label: 'NFS', args: ['-u', 'nfs-server'] },
  { id: 'smb', label: 'SMB', args: ['-u', 'smbd', '-u', 'nmbd', '-u', 'winbind'] },
  { id: 'ssh', label: 'SSH', args: ['-u', 'ssh'] },
  { id: 'docker', label: 'Docker', args: ['-u', 'docker'] },
  { id: 'lxc', label: 'LXC', args: ['-u', 'lxc'] },
  { id: 'smart', label: 'SMART', args: ['-u', 'smartmontools'] },
];

export const WINDOW_DEFS: Record<string, number | null> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  all: null,
};

const DEFAULT_TAIL = 500;
const MAX_TAIL = 20_000;

export function clampTail(tail: number | undefined): number {
  if (tail === undefined || !Number.isInteger(tail) || tail <= 0) return DEFAULT_TAIL;
  return Math.min(tail, MAX_TAIL);
}

export function windowMsFor(windowId: string | undefined): number | null {
  if (windowId === undefined) return null;
  return (windowId in WINDOW_DEFS ? WINDOW_DEFS[windowId] : null) ?? null;
}

/** journalctl's --since/--until want "YYYY-MM-DD HH:MM:SS" in local time, not ISO 8601. */
function formatSince(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const LEADING_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})\s/;

/** Mirrors nextSinceFromLogText in docker/realClient.ts: pull the timestamp off the last log
 *  line to use as the next poll's cursor, rather than "now" - avoids a gap between the last
 *  line's real time and whenever this request happened to complete. */
function nextSinceFromLogText(text: string, fallback: number | null): number | null {
  const lines = text.split('\n').filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = LEADING_TIMESTAMP_RE.exec(lines[i] ?? '');
    if (match) {
      const ms = Date.parse(match[1] ?? '');
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return fallback;
}

export interface LogQueryOptions {
  tail?: number;
  windowMs?: number | null;
  /** Epoch ms cursor for a live-tail poll - supersedes tail/windowMs, same rationale as Docker's
   *  getContainerLogs: a poll wants everything new since last time, not just the last N lines. */
  sinceCursor?: number;
}

export async function queryLog(source: LogSourceDef, opts: LogQueryOptions, useSudo: boolean): Promise<{ logs: string; nextSince: number | null }> {
  const args = ['--no-pager', '-q', '-o', 'short-iso', ...source.args];
  if (opts.sinceCursor !== undefined) {
    args.push('--since', `@${Math.floor(opts.sinceCursor / 1000)}`);
  } else {
    if (opts.windowMs) args.push('--since', formatSince(new Date(Date.now() - opts.windowMs)));
    args.push('-n', String(clampTail(opts.tail)));
  }

  const { stdout } = await runSudoMaybe('journalctl', args, useSudo);
  const text = stdout.replace(/\n$/, '');
  return { logs: text, nextSince: nextSinceFromLogText(text, opts.sinceCursor ?? null) };
}
