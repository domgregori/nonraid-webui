import type { ShareService } from '../shares/index.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

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
      console.error(`Shutdown hook timed out after ${SHUTDOWN_TIMEOUT_MS}ms unmounting shares on ${signal} - exiting anyway.`);
      exitOnce();
    }, SHUTDOWN_TIMEOUT_MS);

    deps.shares
      .unmountAll()
      .then(() => {
        console.log(`Unmounted shares on ${signal} - array disks are free for nonraid.service to stop cleanly.`);
      })
      .catch((err: Error) => {
        console.error(
          `Failed to unmount shares on ${signal}: ${err.message} - the array may fail to stop cleanly and force a parity check on next boot.`,
        );
      })
      .finally(exitOnce);
  };

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
}
