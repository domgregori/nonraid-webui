import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import { getDiskType } from './diskType.js';
import { runSudoMaybe } from './procUtil.js';

/**
 * NmdDisk.device (from nmdctl status) is a bare name like "sdd4" - every other caller in this
 * codebase that needs a real path prepends /dev/ itself (see smart/realClient.ts's own
 * devicePath()). Confirmed live: hdparm happily accepts a partition path (translates to the whole
 * disk internally), so the only real fix needed here is the /dev/ prefix, not whole-disk resolution.
 */
function devicePath(device: string): string {
  return device.startsWith('/dev/') ? device : `/dev/${device}`;
}

/** Puts the drive into standby immediately - hdparm's own documented spin-down command. */
export async function spinDown(device: string): Promise<void> {
  await runSudoMaybe(config.hdparmBin, ['-y', devicePath(device)]);
}

/**
 * hdparm has no dedicated "spin up now" command - ATA's CHECK POWER MODE (what `hdparm -C` uses)
 * is deliberately answerable without spinning up, so it can't be (ab)used for this the way it can
 * for a state *check*. Forcing a real spin-up means forcing a real read: a single direct-I/O sector
 * read bypasses the page cache (which could otherwise satisfy the read from a stale cached block
 * without ever touching the platters) - the same technique other array-management tools use for their own spin-up.
 */
export async function spinUp(device: string): Promise<void> {
  await runSudoMaybe('dd', [`if=${devicePath(device)}`, 'of=/dev/null', 'bs=512', 'count=1', 'iflag=direct']);
}

/**
 * hdparm -S's timeout encoding (confirmed against `man hdparm`): 0 disables it; 1-240 are 5-second
 * units (5s-20min); 241-251 are 1-11 units of 30 minutes (30min-5.5hr). Every preset this app
 * actually offers (Settings > Array) maps onto this exactly - anything else gets rounded/clamped.
 */
function minutesToHdparmCode(minutes: number): number {
  if (minutes <= 0) return 0;
  const seconds = minutes * 60;
  if (seconds <= 1200) return Math.round(seconds / 5);
  return Math.min(251, 240 + Math.round(minutes / 30));
}

/**
 * Programs the drive's own ATA standby timer - once set, the drive spins itself down after this
 * many idle minutes with no further involvement from this backend. `minutes <= 0` disables it
 * (hdparm's own "0 = timeouts disabled").
 */
export async function setSpinDownTimeout(device: string, minutes: number): Promise<void> {
  await runSudoMaybe(config.hdparmBin, ['-S', String(minutesToHdparmCode(minutes)), devicePath(device)]);
}

/**
 * Reapplies the configured idle timeout to every currently-assigned HDD array disk (parity and
 * data alike - both spin down the same way). Best-effort per disk: one drive not responding to
 * hdparm shouldn't stop the others from getting programmed, and shouldn't fail whatever caller
 * triggered this (a settings save, array start, or backend boot - see routes/settings.ts,
 * routes/array.ts, index.ts). Unlike the manual spin-down button, this never forces an immediate
 * standby transition, so it's safe to call even mid-resync - it only tells the drive firmware a
 * threshold, which the resync's own I/O keeps resetting until it actually finishes.
 */
export async function applySpinDownTimeout(nmd: NmdClient, minutes: number): Promise<void> {
  const status = await nmd.getStatus();
  const devices = status.disks.filter((d) => d.device && d.device !== 'none').map((d) => d.device);
  await Promise.all(
    devices.map(async (device) => {
      const isSSD = await getDiskType(device).catch(() => null);
      if (isSSD !== false) return; // only real HDDs - null (unknown) and SSD both skip
      await setSpinDownTimeout(device, minutes).catch(() => {});
    }),
  );
}
