import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import { getDiskType } from './diskType.js';
import { runSudoMaybe } from './procUtil.js';

const execFileAsync = promisify(execFile);

function devicePath(device: string): string {
  return device.startsWith('/dev/') ? device : `/dev/${device}`;
}

/**
 * Resolves a partition device to its whole-disk parent (e.g. "sdb1" -> "/dev/sdb") - hd-idle's -a
 * flag targets a whole disk, not a partition, and isn't documented to resolve one on its own the
 * way hdparm's own commands are (see hdparm.ts's devicePath() comment). Reuses the same lsblk
 * PKNAME trick as nmd/realClient.ts's own isDeviceOrSiblingMounted() - empty PKNAME means `device`
 * is already a whole disk.
 */
async function wholeDiskPath(device: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('lsblk', ['-n', '-p', '-o', 'PKNAME', devicePath(device)]);
    const parent = stdout.trim();
    return parent || devicePath(device);
  } catch {
    return devicePath(device);
  }
}

/**
 * Programs the automatic idle-timeout spin-down via hd-idle (a small Debian daemon,
 * https://github.com/adelolmo/hd-idle) rather than hdparm's own ATA standby timer -
 * deliberately, not an oversight. hdparm -S (this app's original approach) programs a timer on
 * the drive itself, and that timer resets on *any* command the drive receives - including a plain
 * SMART read. This app's own background health/temperature polling (ActivityWatcher, every ~30s)
 * does exactly that, at an interval shorter than any spin-down timeout worth setting - confirmed
 * live: the drive's own countdown never survived long enough to reach standby, no matter what
 * timeout was configured. This is a well-known limitation of hardware-timer-based spin-down
 * running alongside any kind of concurrent SMART monitoring, not specific to this app.
 *
 * hd-idle instead watches real block-layer I/O via /proc/diskstats - confirmed live that a full
 * `smartctl -a` read leaves those counters completely unchanged (SMART commands go through a
 * separate ATA-passthrough ioctl path, never the normal block layer read/write path this app's own
 * user-facing disk activity goes through), so this app's own monitoring is invisible to it. It
 * decides idle purely from genuine disk activity and issues the spin-down command itself once
 * that's actually been idle long enough - immune to the exact problem above by construction, not
 * by tuning. The manual "spin down now"/"wake up" actions (spinDown()/spinUp() in hdparm.ts) are
 * unaffected by any of this - hd-idle only owns the automatic, idle-triggered case.
 *
 * Only ever configures real HDDs (getDiskType() - itself already correct for a USB-attached SSD,
 * see its own doc comment on why that needed fixing) with `minutes > 0`; every other disk gets no
 * `-a` entry at all, so it falls under hd-idle's own global `-i 0` (never spin down) instead of
 * inheriting anything. Regenerates the whole config file and restarts the service every time
 * (settings save, array start, backend boot - see this function's own callers) rather than trying
 * to diff it, since device letters aren't stable across reboots (a disk that resolves to /dev/sdb
 * today may not tomorrow) and the previous file's own content can't be trusted to still be correct.
 */
export async function applySpinDownTimeout(nmd: NmdClient, minutes: number): Promise<void> {
  const status = await nmd.getStatus();
  const devices = status.disks.filter((d) => d.device && d.device !== 'none').map((d) => d.device);

  const entries: string[] = [];
  if (minutes > 0) {
    for (const device of devices) {
      const isSSD = await getDiskType(device).catch(() => null);
      if (isSSD !== false) continue; // only real HDDs - null (unknown) and SSD both skip
      const disk = await wholeDiskPath(device);
      entries.push('-a', disk, '-i', String(minutes * 60));
    }
  }

  if (entries.length === 0) {
    // Nothing to spin down - stop the daemon entirely rather than leave it running for no reason.
    // Best-effort: it may not even be installed/running yet (fresh install, or spin-down never
    // configured), which isn't a real failure worth surfacing to whatever caller triggered this.
    await runSudoMaybe('systemctl', ['stop', config.hdIdleServiceName]).catch(() => {});
    return;
  }

  const contents =
    `# Managed by nonraid-webui - regenerated on every settings save, array start, and backend\n` +
    `# boot (see backend/src/system/hdIdle.ts). Don't edit by hand, it won't survive the next one.\n` +
    `START_HD_IDLE=false\n` +
    `HD_IDLE_OPTS="-i 0 ${entries.join(' ')}"\n`;
  await writeFile(config.hdIdleConfigPath, contents, 'utf8');

  await runSudoMaybe('systemctl', ['enable', config.hdIdleServiceName]).catch(() => {});
  // restart (not just enable --now) so an already-running instance actually picks up the new
  // config - systemd doesn't re-read an EnvironmentFile for a unit that's already up.
  await runSudoMaybe('systemctl', ['restart', config.hdIdleServiceName]);
}
