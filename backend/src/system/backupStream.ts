import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import type { Response } from 'express';
import type { ActivityStore } from '../activity/store.js';
import { config } from '../config.js';
import { ARCHIVE_EXT } from './backupCatalog.js';
import { OPENSSL_CIPHER_ARGS, withPasswordFile } from './backupCrypto.js';
import { spawnMaybeSudo, spawnWithPipedStdin } from './procUtil.js';

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
export function streamBootDiskImage(device: string, res: Response, activity: ActivityStore): void {
  const child = spawnMaybeSudo('dd', [`if=${device}`, 'bs=4M', 'status=none']);
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
 * Streams a config backup archive of `paths` (already filtered to existing ones by the caller)
 * straight to the response - plain gzip, or (when `password` is given) that same tar piped through
 * `openssl enc` first, same "plaintext never touches disk, only the wire" property
 * writeConfigBackupToFile's encrypted path already has. `--ignore-failed-read` tolerates a path
 * disappearing or losing permission between the caller's existence check and tar actually reading
 * it.
 */
export function streamConfigBackup(paths: string[], res: Response, activity: ActivityStore, password?: string): void {
  if (password) {
    withPasswordFile(password, (passwordFilePath) => streamEncryptedConfigBackup(paths, res, activity, passwordFilePath)).catch((err) => {
      if (!res.headersSent) res.status(500).json({ error: `Failed to start encrypted config backup: ${(err as Error).message}` });
    });
    return;
  }
  const child = spawnMaybeSudo('tar', ['--ignore-failed-read', '-czf', '-', ...paths]);
  const filename = `nonraid-config-backup-${Date.now()}${ARCHIVE_EXT}`;
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

/** Encrypted sibling of streamConfigBackup's plain path - same two-child-process wiring
 *  (tar -> openssl) as writeEncryptedConfigBackup, but openssl's stdout goes to `res` instead of a
 *  file, and headers only go out once openssl actually spawns (its stdout is what feeds `res`,
 *  same "commit to the download once the thing writing to res has actually started" rule the plain
 *  path applies to tar). */
function streamEncryptedConfigBackup(paths: string[], res: Response, activity: ActivityStore, passwordFilePath: string): Promise<void> {
  return new Promise((resolve) => {
    const tar = spawnMaybeSudo('tar', ['--ignore-failed-read', '-czf', '-', ...paths]);
    const openssl = spawnWithPipedStdin(config.opensslBin, ['enc', ...OPENSSL_CIPHER_ARGS, '-pass', `file:${passwordFilePath}`]);
    const filename = `nonraid-config-backup-${Date.now()}${ARCHIVE_EXT}`;
    let headersSent = false;
    let tarStderrTail = '';
    let opensslStderrTail = '';
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    // The browser cancelling mid-download closes `res` without either child process knowing -
    // kill both and resolve so withPasswordFile's own cleanup (the private password temp file)
    // still runs, same reasoning as streamBootDiskImage's own res 'close' handler. Guarded on
    // `!res.writableEnded` because 'close' also fires after a *successful* transfer (once
    // openssl's piped stdout ends the response and the connection itself closes/gets reused) -
    // without the guard, a normal completion could race openssl's own 'close' event and settle
    // first, silently swallowing the real success/failure log below.
    res.on('close', () => {
      if (res.writableEnded) return;
      if (!tar.killed) tar.kill();
      if (!openssl.killed) openssl.kill();
      finish();
    });

    tar.stderr.on('data', (chunk: Buffer) => {
      tarStderrTail = (tarStderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_MAX);
    });
    openssl.stderr.on('data', (chunk: Buffer) => {
      opensslStderrTail = (opensslStderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_MAX);
    });
    tar.stdout.pipe(openssl.stdin);

    openssl.on('spawn', () => {
      headersSent = true;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      openssl.stdout.pipe(res);
    });

    const fail = (message: string) => {
      if (headersSent) res.destroy();
      else res.status(500).json({ error: message });
      activity.log(`Config backup failed (encrypted): ${message}`, 'amber').catch(() => {});
      if (!tar.killed) tar.kill();
      if (!openssl.killed) openssl.kill();
      finish();
    };

    tar.on('error', (err) => fail(`Failed to start config backup: ${err.message}`));
    openssl.on('error', (err) => fail(`Failed to start openssl: ${err.message}`));

    let tarDone: number | null = null;
    let opensslDone: number | null = null;
    let tarSignal: NodeJS.Signals | null = null;
    let opensslSignal: NodeJS.Signals | null = null;
    const maybeFinish = () => {
      if (settled || tarDone === null || opensslDone === null) return;
      if (tarDone !== 0) {
        fail(`tar ${describeExit(tarDone, tarSignal)}: ${tarStderrTail.trim()}`);
      } else if (opensslDone !== 0) {
        fail(`openssl ${describeExit(opensslDone, opensslSignal)}: ${opensslStderrTail.trim()}`);
      } else {
        activity.log(`Config backup completed (${paths.length} paths, encrypted)`, 'blue').catch(() => {});
        finish();
      }
    };
    tar.on('close', (code, signal) => {
      tarDone = code ?? -1;
      tarSignal = signal;
      maybeFinish();
    });
    openssl.on('close', (code, signal) => {
      opensslDone = code ?? -1;
      opensslSignal = signal;
      maybeFinish();
    });

    activity.log('Config backup started (encrypted)', 'blue').catch(() => {});
  });
}

// resolveConfigBackupPaths() moved to backupCatalog.ts, now derived from the same category list
// the restore side uses for its per-category selection - re-exported here so existing callers
// (routes/system.ts, BackupScheduler) don't need an import path change.
export { resolveConfigBackupPaths } from './backupCatalog.js';

/**
 * Non-streaming sibling of streamConfigBackup - writes the same gzip-compressed tar to a file on
 * disk instead of an HTTP response, for BackupScheduler's unattended runs. Resolves with the byte
 * count written, rejects with a message built the same way streamConfigBackup's error paths are.
 *
 * When `password` is set, tar's stdout is piped through a second `openssl enc` child process
 * before it ever reaches `destPath` - the plaintext tar stream never touches disk at any point,
 * only the ciphertext does (see backupCrypto.ts's own doc comment on why openssl was picked and
 * how the password itself is kept off the process's own command line). `destPath`'s own name/
 * extension is unaffected either way - see backupMeta.ts for how a `.meta.json` sidecar is what
 * actually records whether a given archive is encrypted, not its filename.
 */
export function writeConfigBackupToFile(paths: string[], destPath: string, password?: string): Promise<number> {
  if (!password) return writePlainConfigBackup(paths, destPath);
  return withPasswordFile(password, (passwordFilePath) => writeEncryptedConfigBackup(paths, destPath, passwordFilePath));
}

function writePlainConfigBackup(paths: string[], destPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawnMaybeSudo('tar', ['--ignore-failed-read', '-czf', '-', ...paths]);
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

function writeEncryptedConfigBackup(paths: string[], destPath: string, passwordFilePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tar = spawnMaybeSudo('tar', ['--ignore-failed-read', '-czf', '-', ...paths]);
    const openssl = spawnWithPipedStdin(config.opensslBin, ['enc', ...OPENSSL_CIPHER_ARGS, '-pass', `file:${passwordFilePath}`]);
    const out = createWriteStream(destPath);
    let tarStderrTail = '';
    let opensslStderrTail = '';
    let bytes = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      if (!tar.killed) tar.kill();
      if (!openssl.killed) openssl.kill();
      reject(err);
    };

    tar.stderr.on('data', (chunk: Buffer) => {
      tarStderrTail = (tarStderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_MAX);
    });
    openssl.stderr.on('data', (chunk: Buffer) => {
      opensslStderrTail = (opensslStderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_MAX);
    });
    openssl.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    tar.stdout.pipe(openssl.stdin);
    openssl.stdout.pipe(out);

    tar.on('error', (err) => fail(new Error(`Failed to start config backup: ${err.message}`)));
    openssl.on('error', (err) => fail(new Error(`Failed to start openssl: ${err.message}`)));
    out.on('error', (err) => fail(new Error(`Failed to write config backup file: ${err.message}`)));

    let tarDone: number | null = null;
    let opensslDone: number | null = null;
    const maybeFinish = () => {
      if (settled || tarDone === null || opensslDone === null) return;
      settled = true;
      if (tarDone !== 0) {
        reject(new Error(`tar exited with code ${tarDone}: ${tarStderrTail.trim()}`));
      } else if (opensslDone !== 0) {
        reject(new Error(`openssl exited with code ${opensslDone}: ${opensslStderrTail.trim()}`));
      } else {
        resolve(bytes);
      }
    };
    tar.on('close', (code) => {
      tarDone = code ?? -1;
      maybeFinish();
    });
    openssl.on('close', (code) => {
      opensslDone = code ?? -1;
      maybeFinish();
    });
  });
}
