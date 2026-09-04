import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ShareService } from '../shares/index.js';

const execFileAsync = promisify(execFile);
const SHUTDOWN_TIMEOUT_MS = 15_000;
const SYSTEM_STATE_CHECK_TIMEOUT_MS = 3_000;

/**
 * Registers SIGTERM/SIGINT handlers that unmount every share's mergerfs/bind mount before this
 * process exits. Without this, a real host reboot/shutdown never runs it - and every reboot pays
 * for that, not just a real crash:
 *
 * nonraid.service's own ExecStop only knows about the raw array disk mounts (`nmdctl -u
 * unmount`/`stop`) - it has no idea a share's mergerfs mount is layered on top of them (see
 * ShareService.unmountAll's callers in routes/array.ts, which already have to unmount that layer
 * themselves before calling nmd.unmountDisks()). Left mounted, it holds the disk mounts busy,
 * `nmdctl -u stop` refuses in unattended mode ("Cannot stop array with mounted filesystems"), that
 * ExecStop line fails, systemd never reaches the next one (`rm -f
 * $STATE_DIRECTORY/array.running`), and the next boot's ExecStart finds that stale marker,
 * assumes an unclean shutdown, and forces a full correcting parity check - deterministically, on
 * every reboot, since nothing ever tore the share layer down first.
 *
 * This backend is ordered `After=nonraid.service` (tools/systemd/nonraid-webui.service), so
 * systemd stops it before nonraid.service's own ExecStop runs. Unmounting shares here in time
 * means the plain nmdctl unmount/stop that follows finds only the raw array disks left, succeeds,
 * and the marker gets removed as normal.
 *
 * Deliberately does NOT call nmd.stopArray() itself - nonraid.service's ExecStop already does
 * that right after this process exits; duplicating it here would just race the real one for no
 * benefit. Logs to the console (journalctl -u nonraid-webui), not the activity store - there's no
 * one left watching the in-app activity feed by the time this runs, and a store write isn't
 * guaranteed to land before the process exits.
 *
 * Best-effort and time-boxed: a hung unmount (e.g. an unresponsive FUSE mount) must never turn a
 * requested reboot into a hung one, so this always exits within SHUTDOWN_TIMEOUT_MS regardless of
 * how unmountAll() resolves.
 *
 * Only actually unmounts anything when isHostShuttingDown() below confirms the whole host is going
 * down - see its own doc comment for why a plain `systemctl restart nonraid-webui` (which sends
 * this process the exact same SIGTERM) must NOT trigger this. Confirmed live: every routine restart
 * (an update, a settings change that self-restarts, Restart=on-failure after a crash) was tearing
 * down and rebuilding every multi-disk share's mergerfs mount for no reason - closeSmbClients()
 * inside that unmount actively kicks connected clients, and the fresh mergerfs process afterward is
 * a new mount instance with new file handles, so any client that had a file/directory open through
 * it (confirmed live: a Proxmox host with a share in /etc/fstab) sees a stale file handle - despite
 * nothing about the share's actual configuration, or the array itself, ever changing.
 */
export function installShutdownHook(deps: { shares: ShareService }): void {
  let shuttingDown = false;

  const handleSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return; // a second signal mid-shutdown just waits for the first to finish
    shuttingDown = true;

    const exitOnce = (() => {
      let exited = false;
      return () => {
        if (exited) return;
        exited = true;
        process.exit(0);
      };
    })();

    setTimeout(() => {
      console.error(`Shutdown hook timed out after ${SHUTDOWN_TIMEOUT_MS}ms on ${signal} - exiting anyway.`);
      exitOnce();
    }, SHUTDOWN_TIMEOUT_MS);

    isHostShuttingDown()
      .then((real) => {
        if (!real) {
          console.log(`${signal} received but the host isn't shutting down (just this unit) - leaving shares mounted.`);
          return;
        }
        return deps.shares
          .unmountAll()
          .then(() => {
            console.log(`Unmounted shares on ${signal} - array disks are free for nonraid.service to stop cleanly.`);
          })
          .catch((err: Error) => {
            console.error(
              `Failed to unmount shares on ${signal}: ${err.message} - the array may fail to stop cleanly and force a parity check on next boot.`,
            );
          });
      })
      .finally(exitOnce);
  };

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
}

/**
 * True only when the whole host is actually going down (reboot/poweroff/halt), not just this one
 * unit being restarted - `systemctl restart nonraid-webui` sends this process the exact same
 * SIGTERM a real shutdown does, so the signal alone can't tell the two apart. `systemctl
 * is-system-running` reports "stopping" once systemd itself has started tearing the whole system
 * down (shutdown.target pulled in), and something else ("running", "degraded", ...) the rest of the
 * time - including a plain restart of just this unit, where nonraid.service and everything else
 * stays up and the array is never actually being stopped.
 *
 * Defaults to true (assume a real shutdown) on any error or timeout querying it - the failure mode
 * of skipping the unmount during a *real* shutdown (forced parity check next boot, see this file's
 * own top comment) is worse than the failure mode of running it unnecessarily during a plain
 * restart, so an inconclusive answer has to fail toward the safer, original behavior.
 */
async function isHostShuttingDown(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-system-running'], { timeout: SYSTEM_STATE_CHECK_TIMEOUT_MS });
    return stdout.trim() === 'stopping';
  } catch (err) {
    // is-system-running exits non-zero for every state except "running" - stdout (if any) still
    // carries the real state (e.g. "stopping", "degraded") on that path, so it's checked before
    // falling back to the safe default below.
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout === 'string' && stdout.trim().length > 0) {
      return stdout.trim() === 'stopping';
    }
    return true;
  }
}
