import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * NmdDisk.device (from nmdctl status) is a bare name like "sdb1" — every other caller in this
 * codebase that needs a real path prepends /dev/ itself (see smart/realClient.ts's own
 * devicePath() and its doc comment about the exact same bug this fixes: lsblk failing with "not a
 * block device" on a bare name, confirmed live). Idempotent so it stays correct for callers that
 * already pass a full path (scanDevice()'s unassigned-device scan uses lsblk -p already).
 */
function devicePath(device: string): string {
  return device.startsWith('/dev/') ? device : `/dev/${device}`;
}

/**
 * lsblk's ROTA flag (0 = non-rotational/SSD, 1 = rotational/HDD) — the kernel's own signal,
 * always present regardless of what the drive itself reports over SMART. Preferred over
 * smartctl's `rotation_rate` field, which some drives simply don't report at all (confirmed live
 * against this project's own test rig: present and 0 on a real SSD, absent entirely on a real
 * WD Blue HDD). Returns null only if the device can't be read at all (e.g. device already gone).
 */
export async function getDiskType(device: string): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync('lsblk', ['-d', '-n', '-o', 'ROTA', devicePath(device)]);
    const rota = stdout.trim();
    if (rota === '0') return true; // SSD
    if (rota === '1') return false; // HDD
    return null;
  } catch {
    return null;
  }
}
