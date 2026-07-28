import { readFileSync, statfsSync } from 'node:fs';

export interface DiscoveredDataDisk {
  slot: number;
  device: string;
  fsType: string;
  sizeGb: number;
  usedPct: number;
}

interface RealMount {
  device: string;
  mountpoint: string;
  fstype: string;
}

const MAX_DATA_SLOT = 28;
const MOUNT_PREFIX = process.env.MOCK_DISK_MOUNT_PREFIX ?? '/mnt/disk';

function readProcMounts(): RealMount[] {
  try {
    return readFileSync('/proc/mounts', 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [device, mountpoint, fstype] = line.split(' ');
        return { device: device ?? '', mountpoint: mountpoint ?? '', fstype: fstype ?? '' };
      });
  } catch {
    return []; // not on Linux, or /proc unavailable — fine, discovery just finds nothing
  }
}

/**
 * Finds real mounted filesystems at <MOUNT_PREFIX><slot>) for slot 1..28 (nmdctl's
 * data-disk slot range) and reports their actual size/usage/fstype — used so
 * MockNmdClient can report genuinely real numbers when run on a dev VM with a
 * real NonRAID array mounted at exactly these paths, instead of disconnected
 * fictional TB-scale ones. Returns [] when nothing's mounted there (e.g. a
 * plain dev machine), so callers can fall back to fully fictional mock data.
 */
export function discoverRealDataDisks(): DiscoveredDataDisk[] {
  const mounts = readProcMounts();
  const disks: DiscoveredDataDisk[] = [];

  for (let slot = 1; slot <= MAX_DATA_SLOT; slot++) {
    const mountpoint = `${MOUNT_PREFIX}${slot}`;
    const mount = mounts.find((m) => m.mountpoint === mountpoint);
    if (!mount) continue;

    try {
      const stats = statfsSync(mountpoint);
      const totalBytes = stats.blocks * stats.bsize;
      const freeBytes = stats.bfree * stats.bsize;
      if (totalBytes <= 0) continue;
      const usedBytes = totalBytes - freeBytes;
      disks.push({
        slot,
        device: mount.device,
        fsType: mount.fstype,
        // Keep one decimal — real test disks here are 512MB (0.5GB); rounding to a
        // whole GB would show "1 GB" for a disk that's actually half that size.
        sizeGb: Math.round((totalBytes / (1024 * 1024 * 1024)) * 10) / 10,
        usedPct: Math.round((usedBytes / totalBytes) * 100),
      });
    } catch {
      // statfs failed (race with unmount, etc) — skip this one, not fatal
    }
  }

  return disks;
}
