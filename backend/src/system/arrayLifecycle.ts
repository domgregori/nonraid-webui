import type { ActivityStore } from '../activity/index.js';
import type { LxcClient } from '../lxc/index.js';
import type { NmdClient } from '../nmd/index.js';
import type { ShareService } from '../shares/index.js';
import { runSudoMaybe } from './procUtil.js';

export interface StoppedContainers {
  dockerStopped: boolean;
  stoppedLxcNames: string[];
}

/**
 * Unmounts the raw array disk filesystems, retrying once with Docker and every running LXC
 * container stopped if the plain attempt fails - the common case being Docker's own data root
 * relocated onto an array disk (see docker/storagePath.ts and lxc/storagePath.ts for the same
 * class of conflict). Shared by every caller that needs array disks to actually come down:
 * /array/stop, /array/reload-driver, and the disk queue's own add-disk flow - runAddDiskItem()'s
 * stopArray() call has the exact same busy-disk failure mode as a manual Stop Array click, it just
 * never had this retry until Docker was found left down after a queue-driven parity/data disk add.
 *
 * Deliberately does NOT call shares.unmountAll() itself - callers do that first, each with their
 * own strictness (a share-unmount failure is fatal for the interactive /array/stop, but best-effort
 * for the recovery-oriented /array/reload-driver) - collapsing that distinction here would erase a
 * documented, deliberate difference between the two.
 */
export async function unmountArrayWithContainerRetry(
  deps: { nmd: NmdClient; shares: ShareService; lxc: LxcClient; activity: ActivityStore },
  stopContainers: boolean,
): Promise<StoppedContainers> {
  const stopped: StoppedContainers = { dockerStopped: false, stoppedLxcNames: [] };
  try {
    await deps.nmd.unmountDisks();
  } catch (err) {
    if (!stopContainers) throw err;

    deps.activity.log('Stopping Docker and running LXC containers to allow the array to stop', 'amber').catch(() => {});
    await runSudoMaybe('systemctl', ['stop', 'docker.socket', 'docker.service']).catch(() => {});
    stopped.dockerStopped = true;

    const containers = await deps.lxc.listContainers().catch(() => []);
    for (const c of containers) {
      if (c.state !== 'running') continue;
      await deps.lxc.stopContainer(c.name).catch(() => {});
      stopped.stoppedLxcNames.push(c.name);
    }

    await deps.shares.unmountAll().catch(() => {});
    await deps.nmd.unmountDisks(); // still busy after stopping containers - let this one throw for real
  }
  return stopped;
}

/** Undoes exactly what unmountArrayWithContainerRetry() stopped - used on a failed retry, where
 *  the array is still running and there's no reason for Docker/LXC to stay down. */
export async function restoreStoppedContainers(lxc: LxcClient, stopped: StoppedContainers): Promise<void> {
  if (stopped.dockerStopped) await runSudoMaybe('systemctl', ['start', 'docker']).catch(() => {});
  for (const name of stopped.stoppedLxcNames) {
    await lxc.startContainer(name).catch(() => {});
  }
}

/**
 * Best-effort: brings Docker's daemon back if it's not already running, and starts every LXC
 * container with autostart set that isn't already running. Unconditional rather than tracking
 * "did this specific caller stop them" - idempotent either way (starting an already-running
 * docker.service or LXC container is a no-op), and self-heals a Docker/LXC left down by an
 * earlier, unrelated stop (e.g. a prior failed retry, or a queue-driven disk add). LXC has no
 * daemon-level autostart of its own to lean on here - each container's `lxc.start.auto` is
 * normally only honored by lxc's systemd unit at a real host boot, not when this app starts/stops
 * containers mid-session - so it's applied explicitly here instead. Shared by /array/start and the
 * disk queue's own add-disk flow.
 */
export async function restoreDockerAndAutostartLxc(deps: { lxc: LxcClient; activity: ActivityStore }): Promise<void> {
  await runSudoMaybe('systemctl', ['start', 'docker']).catch(() => {});
  try {
    const containers = await deps.lxc.listContainers();
    const started: string[] = [];
    for (const c of containers) {
      if (!c.autostart || c.state === 'running') continue;
      await deps.lxc.startContainer(c.name).catch(() => {});
      started.push(c.name);
    }
    if (started.length > 0) {
      deps.activity.log(`Started autostart LXC container(s): ${started.join(', ')}`, 'blue').catch(() => {});
    }
  } catch {
    // best-effort - a failure listing/starting LXC containers shouldn't fail the array coming back up
  }
}

/**
 * After mountDisks() reports success, nmdctl's own mount step can still silently skip a disk
 * whose filesystem it didn't mount as expected - a skip, unlike a real per-disk mount error,
 * doesn't affect nmdctl's exit code, so a try/catch around mountDisks() never sees it. Re-checks
 * live status and logs a warning naming any data disk that has a detected filesystem but still
 * isn't mounted, so it doesn't go unnoticed - this exact situation left three disks
 * DISK_OK/"unmounted" through several array starts, each reporting clean success, and separately
 * left disk1 unmounted (array itself still STARTED) after a queue-driven disk add that never
 * called mountDisks() at all - see mountArrayDisksBestEffort() below. Disks with no filesystem at
 * all are skipped - that's the normal state for a genuinely blank new disk awaiting Format, not a
 * problem worth flagging.
 */
async function warnUnmountedDataDisks(nmd: NmdClient, activity: ActivityStore): Promise<void> {
  try {
    const status = await nmd.getStatus();
    const stuck = status.disks.filter((d) => d.type === 'data' && d.filesystem?.type && d.filesystem.mountpoint === 'unmounted');
    if (stuck.length === 0) return;
    const names = stuck.map((d) => `Disk ${d.slot} (${d.filesystem!.type})`).join(', ');
    activity.log(`${names} still not mounted after mounting disks - try Mount Disk from the Disks page.`, 'amber').catch(() => {});
  } catch {
    // best-effort - a status-fetch failure here shouldn't compound whatever's already happening
  }
}

/**
 * nmdctl start (or a queue-driven addDisk()+startArray()) only activates the array's md device -
 * it doesn't mount each disk's own filesystem or bring shares back up on top of them. Mounts,
 * warns about anything nmdctl silently skipped, then remounts shares - best-effort throughout,
 * since the array itself did come up even if a disk fails to mount. Shared by /array/start,
 * /array/shrink, /array/reload-driver, and the disk queue's own add-disk flow, which used to skip
 * this step entirely and leave the array STARTED with its own newly-added disk still unmounted.
 */
export async function mountArrayDisksBestEffort(
  deps: { nmd: NmdClient; shares: ShareService; activity: ActivityStore },
  contextLabel: string,
): Promise<void> {
  try {
    await deps.nmd.mountDisks();
    await warnUnmountedDataDisks(deps.nmd, deps.activity);
    await deps.shares.remountAll();
  } catch (err) {
    deps.activity.log(`${contextLabel}, but mounting disks failed: ${(err as Error).message}`, 'amber').catch(() => {});
  }
}
