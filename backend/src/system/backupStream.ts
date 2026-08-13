import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import type { Response } from 'express';
import type { ActivityStore } from '../activity/store.js';
import { spawnMaybeSudo } from './procUtil.js';

const STDERR_TAIL_MAX = 4000;

/** A closed 'code' with no 'signal' means a clean exit; anything else means it was killed. */
function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `terminated by ${signal} (browser likely cancelled the download)`;
  return `exited with code ${code}`;
}

/**
 * Streams a gzip-compressed raw byte copy of `device` straight to the response - never buffers
 * the image in memory or on disk. This is a live read of a mounted, in-use device, not a
 * filesystem-consistent snapshot; the caller (route) is responsible for surfacing that caveat to
 * the user before triggering this.
 */
export function streamBootDiskImage(device: string, useSudo: boolean, res: Response, activity: ActivityStore): void {
  const child = spawnMaybeSudo('dd', [`if=${device}`, 'bs=4M', 'status=none'], useSudo);
  const filename = `boot-disk-${path.basename(device)}-${Date.now()}.img.gz`;
  let headersSent = false;
  let bytes = 0;
  let stderrTail = '';

  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_MAX);
  });

  // The browser cancelling mid-download (closing the tab, navigating away) closes `res` without
  // dd ever knowing - without this, dd keeps reading the full device into a pipe nothing drains,
  // wasting device I/O for however long it takes to finish. Kill it the moment the client's gone.
  res.on('close', () => {
    if (!child.killed) child.kill();
  });

  // Only commit to the download once dd has actually started - an ENOENT/permission failure
  // fires as an 'error' event before this, letting a clean JSON error go out instead.
  child.on('spawn', () => {
    headersSent = true;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const gzip = createGzip();
    gzip.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    child.stdout.pipe(gzip).pipe(res);
  });

  child.on('error', (err) => {
    if (headersSent) {
      res.destroy();
    } else {
      res.status(500).json({ error: `Failed to start boot disk image backup: ${err.message}` });
    }
    activity.log(`Boot disk image backup failed: ${err.message}`, 'amber').catch(() => {});
  });

  child.on('close', (code, signal) => {
    if (code === 0) {
      activity.log(`Boot disk image backup completed (${(bytes / 1024 ** 3).toFixed(2)} GB written)`, 'blue').catch(() => {});
      return;
    }
    // Non-zero/signalled close after headers went out means the browser already has a truncated
    // file - nothing better to do than end the response; the activity log is the only place this
    // failure can still be surfaced.
    if (headersSent) res.destroy();
    else res.status(500).json({ error: `dd ${describeExit(code, signal)}: ${stderrTail.trim()}` });
    activity.log(`Boot disk image backup failed (dd ${describeExit(code, signal)}): ${stderrTail.trim() || 'no output'}`, 'amber').catch(
      () => {},
    );
  });

  activity.log(`Boot disk image backup started (${device})`, 'blue').catch(() => {});
}

/**
 * Streams a gzip-compressed tar of `paths` (already filtered to existing ones by the caller)
 * straight to the response. `--ignore-failed-read` tolerates a path disappearing or losing
 * permission between the caller's existence check and tar actually reading it.
 */
export function streamConfigBackup(paths: string[], useSudo: boolean, res: Response, activity: ActivityStore): void {
  const child = spawnMaybeSudo('tar', ['--ignore-failed-read', '-czf', '-', ...paths], useSudo);
  const filename = `nonraid-config-backup-${Date.now()}.tar.gz`;
  let headersSent = false;
  let stderrTail = '';

  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_MAX);
  });

  res.on('close', () => {
    if (!child.killed) child.kill();
  });

  child.on('spawn', () => {
    headersSent = true;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    child.stdout.pipe(res);
  });

  child.on('error', (err) => {
    if (headersSent) {
      res.destroy();
    } else {
      res.status(500).json({ error: `Failed to start config backup: ${err.message}` });
    }
    activity.log(`Config backup failed: ${err.message}`, 'amber').catch(() => {});
  });

  child.on('close', (code, signal) => {
    if (code === 0) {
      activity.log(`Config backup completed (${paths.length} paths)`, 'blue').catch(() => {});
      return;
    }
    if (headersSent) res.destroy();
    else res.status(500).json({ error: `tar ${describeExit(code, signal)}: ${stderrTail.trim()}` });
    activity.log(`Config backup failed (tar ${describeExit(code, signal)}): ${stderrTail.trim() || 'no output'}`, 'amber').catch(() => {});
  });

  activity.log('Config backup started', 'blue').catch(() => {});
}

// resolveConfigBackupPaths() moved to backupCatalog.ts, now derived from the same category list
// the restore side uses for its per-category selection - re-exported here so existing callers
// (routes/system.ts, BackupScheduler) don't need an import path change.
export { resolveConfigBackupPaths } from './backupCatalog.js';

/**
 * Non-streaming sibling of streamConfigBackup - writes the same gzip-compressed tar to a file on
 * disk instead of an HTTP response, for BackupScheduler's unattended runs. Resolves with the byte
 * count written, rejects with a message built the same way streamConfigBackup's error paths are.
 */
export function writeConfigBackupToFile(paths: string[], useSudo: boolean, destPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawnMaybeSudo('tar', ['--ignore-failed-read', '-czf', '-', ...paths], useSudo);
    const out = createWriteStream(destPath);
    let stderrTail = '';
    let bytes = 0;

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_MAX);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    child.stdout.pipe(out);

    child.on('error', (err) => reject(new Error(`Failed to start config backup: ${err.message}`)));
    out.on('error', (err) => {
      if (!child.killed) child.kill();
      reject(new Error(`Failed to write config backup file: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve(bytes);
      } else {
        reject(new Error(`tar ${describeExit(code, signal)}: ${stderrTail.trim()}`));
      }
    });
  });
}
