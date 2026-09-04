import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

/**
 * NmdDisk.device (from nmdctl status) is a bare name like "sdb1" - every other caller in this
 * codebase that needs a real path prepends /dev/ itself (see smart/realClient.ts's own
 * devicePath() and its doc comment about the exact same bug this fixes: lsblk failing with "not a
 * block device" on a bare name, confirmed live). Idempotent so it stays correct for callers that
 * already pass a full path (scanDevice()'s unassigned-device scan uses lsblk -p already).
 */
function devicePath(device: string): string {
  return device.startsWith('/dev/') ? device : `/dev/${device}`;
}

/**
 * smartctl's own rotation_rate field, straight from the drive's ATA IDENTIFY data (read via SAT
 * passthrough) rather than anything the kernel's block layer inferred - 0 explicitly means SSD; a
 * positive number is a real RPM; the field can also be absent entirely (some drives just don't
 * report it). `-n standby` avoids waking an already-spun-down HDD just to ask this. Returns
 * undefined (not null) so getDiskType() below can tell "field absent" apart from "explicitly 0" -
 * collapsing those into one signal would defeat the whole point of asking.
 */
async function smartctlRotationRate(device: string): Promise<number | undefined> {
  const parse = (stdout: string): number | undefined => {
    try {
      return (JSON.parse(stdout) as { rotation_rate?: number }).rotation_rate;
    } catch {
      return undefined;
    }
  };
  try {
    const { stdout } = await execFileAsync(config.smartctlBin, ['-n', 'standby', '--json', '-i', devicePath(device)], { timeout: 10_000 });
    return parse(stdout);
  } catch (err) {
    // Same bitmask-exit-code caveat as smart/realClient.ts's run() - a nonzero exit doesn't mean
    // the JSON on stdout is bad (e.g. -n standby skipping a sleeping disk).
    const stdout = (err as { stdout?: string }).stdout;
    return stdout ? parse(stdout) : undefined;
  }
}

// isSSD never changes at runtime for a given device (same reasoning routes/smart.ts's own
// disk-types endpoint already documented) - cached permanently per process rather than re-derived
// on every call, now that the USB cross-check below can add a real smartctl read on top of lsblk's
// own near-instant sysfs read. Naturally invalidated by a backend restart, which is also the only
// time a device letter can end up meaning a different physical disk anyway (see the project's own
// "device letters unstable across reboots" finding) - never safe to keep across one.
const cache = new Map<string, boolean | null>();

/**
 * lsblk's ROTA flag (0 = non-rotational/SSD, 1 = rotational/HDD) - the kernel's own signal, always
 * present regardless of what the drive itself reports over SMART, and normally reliable (present
 * and 0 on a real SSD, absent entirely on a real WD Blue HDD - confirmed live against this
 * project's own test rig).
 *
 * USB bridges are the one real exception found so far: many don't propagate the "non-rotational"
 * bit through their own SCSI translation at all, so the kernel's queue/rotational (what ROTA
 * reads) defaults to 1/HDD for an actual USB-attached SSD - confirmed live on this same rig (a
 * Kingston USB SSD reports ROTA=1 despite smartctl's own ATA IDENTIFY data correctly showing
 * rotation_rate=0, and despite lsblk correctly reporting the *disk's* own SMART-reported type via
 * that same smartctl path). When lsblk says HDD, this asks smartctl for a second opinion and
 * trusts an explicit rotation_rate of 0 there over lsblk's own value - smartctl reads the drive's
 * real IDENTIFY data via SAT passthrough, which the USB bridge's SCSI-translation layer doesn't get
 * a vote on. A missing rotation_rate field (some HDDs genuinely don't report it) still falls back
 * to trusting lsblk, matching this function's original (pre-USB-fix) behavior exactly.
 *
 * Returns null only if lsblk itself can't read the device at all (e.g. it's already gone).
 */
export async function getDiskType(device: string): Promise<boolean | null> {
  const cached = cache.get(device);
  if (cached !== undefined) return cached;

  const result = await (async (): Promise<boolean | null> => {
    let rota: string;
    try {
      const { stdout } = await execFileAsync('lsblk', ['-d', '-n', '-o', 'ROTA', devicePath(device)]);
      rota = stdout.trim();
    } catch {
      return null;
    }

    if (rota === '0') return true; // SSD
    if (rota !== '1') return null;

    // rota === '1' (HDD, per the kernel) - worth a second opinion before trusting it, since this
    // is exactly the case a USB bridge can get wrong.
    const rate = await smartctlRotationRate(device);
    return rate === 0 ? true : false; // explicit SSD signal from smartctl wins; anything else stays HDD
  })();

  // A device that couldn't be read at all (null) isn't cached - it may just not exist *yet* (a
  // disk mid-import, or a transient lsblk hiccup), and the next call should get a fresh look
  // rather than being stuck on null for the rest of this process's life.
  if (result !== null) cache.set(device, result);
  return result;
}

// Same never-changes-at-runtime reasoning and cache lifetime as getDiskType() above.
const transportCache = new Map<string, string | null>();

/**
 * lsblk's TRAN field (e.g. "sata", "usb", "nvme", "sas") - purely informational (nothing in this
 * app currently branches on it), surfaced so a disk that's USB-attached can be labeled as such:
 * worth knowing before physically touching a cable, and it's the same transport that makes
 * getDiskType() above need a second opinion from smartctl in the first place. Returns null if
 * lsblk can't read the device, or genuinely doesn't know its transport.
 */
export async function getDiskTransport(device: string): Promise<string | null> {
  const cached = transportCache.get(device);
  if (cached !== undefined) return cached;

  let tran: string | null;
  try {
    const { stdout } = await execFileAsync('lsblk', ['-d', '-n', '-o', 'TRAN', devicePath(device)]);
    tran = stdout.trim() || null;
  } catch {
    tran = null;
  }

  if (tran !== null) transportCache.set(device, tran);
  return tran;
}
