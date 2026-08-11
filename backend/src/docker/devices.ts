import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface HostDevice {
  path: string;
  label: string;
}

/**
 * Most of /dev is irrelevant noise for container passthrough (loop*, tty*,
 * null, zero, random, ptmx, ...) — confirmed live against a real host: 186
 * top-level entries, almost none of them a sane passthrough target. The
 * devices actually worth offering live one level down in a handful of known
 * subdirectories, so this walks exactly those rather than dumping all of
 * /dev. USB (/dev/bus/usb/<bus>/<dev>) is deliberately excluded — those
 * numbers renumber on replug/reboot, making them a poor passthrough target
 * to suggest as if it were stable.
 */
const CURATED_SUBDIRS: { dir: string; label: (name: string) => string }[] = [
  { dir: '/dev/dri', label: (n) => `GPU — ${n}` },
  { dir: '/dev/snd', label: (n) => `Audio — ${n}` },
  { dir: '/dev/serial/by-id', label: (n) => `Serial — ${n}` },
];

async function listDeviceNodes(dir: string, label: (name: string) => string): Promise<HostDevice[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: HostDevice[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue; // one level only (e.g. skip dri/by-path)
    const full = path.join(dir, entry.name);
    try {
      // stat() follows symlinks, so serial/by-id's stable-name symlinks to
      // the real /dev/ttyUSBx node resolve and classify correctly here too.
      const st = await stat(full);
      if (st.isCharacterDevice() || st.isBlockDevice()) {
        results.push({ path: full, label: label(entry.name) });
      }
    } catch {
      // broken symlink or a race with device removal — skip it
    }
  }
  return results;
}

export async function listAvailableDevices(): Promise<HostDevice[]> {
  const lists = await Promise.all(CURATED_SUBDIRS.map((c) => listDeviceNodes(c.dir, c.label)));
  return lists.flat().sort((a, b) => a.path.localeCompare(b.path));
}
