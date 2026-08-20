import path from 'node:path';
import { config } from '../config.js';
import type { BackupDestination } from '../settings/types.js';

/**
 * Turns the structured "Boot Disk / Disk N / Custom…" picker (BackupSchedule.destination) into the
 * actual absolute path BackupScheduler writes into - same shape/reasoning as lxc/storagePath.ts's
 * resolveLxcPath() for the analogous Docker/LXC storage-location picker. 'boot' resolves to a
 * folder next to this app's own persisted state (settings.json's directory) rather than anywhere
 * under /mnt, since the whole point of that option is "not on the array" - array disks already
 * have 'array' for that. Doesn't validate the disk actually exists/is mounted (same as
 * resolveLxcPath) - BackupScheduler.runNow() already checks the resolved directory is writable
 * before using it.
 */
export function resolveBackupDestDir(destination: BackupDestination): string {
  if (destination.mode === 'boot') return path.join(path.dirname(path.dirname(config.settingsConfigPath)), 'backups');
  if (destination.mode === 'array') {
    if (destination.diskSlot === null) throw new Error('diskSlot is required when destination.mode is "array".');
    return `/mnt/disk${destination.diskSlot}/backups`;
  }
  return destination.customPath;
}
