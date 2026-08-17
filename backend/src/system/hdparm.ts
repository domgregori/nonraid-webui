import { config } from '../config.js';
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
