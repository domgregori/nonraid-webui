// Decrypts a config backup archive (.nrb, or the older .tar.gz name the same feature used before
// that extension existed) downloaded from Settings > Backups with encryption on, or from a
// "Download encrypted backup now" link. Exists so an admin can still get at their own backup
// without the webui running - the array being down, the host not booting, or the backup being
// opened on a different machine entirely are exactly the situations this matters for. Merged in
// from the standalone tools/decrypt-backup.sh, which this replaces - same openssl invocation, same
// flag/output-naming behavior, just one fewer thing to remember exists.
//
// The archive itself is nothing exotic: `tar czf` piped through `openssl enc -aes-256-cbc
// -pbkdf2` (see backend/src/system/backupCrypto.ts) - this shells out to the same real openssl
// binary the backend does, rather than reimplementing AES/PBKDF2 in Node's own crypto module,
// which would risk a subtly incompatible KDF. An unencrypted archive (or one already decrypted) is
// detected by gzip's own magic bytes and passed through unchanged (same check as
// backupCrypto.ts's looksLikeGzip), so this is safe to point at any backup archive without knowing
// ahead of time whether it's encrypted.
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import prompts from 'prompts';
import { runAction } from '../output.js';

interface DecryptBackupOptions {
  output?: string;
  extract?: boolean;
}

async function looksLikeGzip(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  } finally {
    await handle.close();
  }
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderrTail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000);
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'ENOENT' ? new Error(`${bin} is required but not on PATH.`) : new Error(`Failed to start ${bin}: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrTail.trim() || `${bin} exited with code ${code}`));
    });
  });
}

// Same suffix-swap the bash version used: strip a trailing .nrb or .tar.gz, then add back
// -extracted or .tar.gz. If that would produce the same path as the input (e.g. the archive was
// already named foo.tar.gz), append a second .tar.gz rather than silently pointing at the source
// file itself.
function defaultOutputPath(archive: string, extract: boolean): string {
  const stripped = archive.replace(/\.nrb$/, '').replace(/\.tar\.gz$/, '');
  if (extract) return `${stripped}-extracted`;
  const withExt = `${stripped}.tar.gz`;
  return withExt === archive ? `${archive}.tar.gz` : withExt;
}

export function registerDecryptBackupCommand(program: Command): void {
  program
    .command('decrypt-backup <archive>')
    .description('decrypt a local config backup archive (.nrb) - works without the webui running, no login needed')
    .option('-o, --output <path>', 'output path (default: derived from the archive name)')
    .option('-x, --extract', 'extract straight into a directory instead of leaving a .tar.gz')
    .action(runAction(decryptBackupCommand));
}

async function decryptBackupCommand(archive: string, opts: DecryptBackupOptions): Promise<void> {
  const extract = !!opts.extract;
  const output = opts.output ?? defaultOutputPath(archive, extract);

  let plain: boolean;
  try {
    plain = await looksLikeGzip(archive);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`No such file: ${archive}`);
    throw err;
  }

  let plainTarPath: string;
  let tmpDir: string | null = null;

  if (plain) {
    console.log("This archive isn't encrypted - nothing to decrypt.");
    plainTarPath = archive;
  } else {
    const password =
      process.env.NRB_PASSWORD ??
      (
        await prompts({ type: 'password', name: 'password', message: `Password for ${archive}` }, { onCancel: () => process.exit(130) })
      ).password;
    if (!password) throw new Error('A password is required.');

    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nonraid-decrypt-'));
    const passwordFile = path.join(tmpDir, 'pw');
    await writeFile(passwordFile, password, { mode: 0o600 });

    plainTarPath = extract ? path.join(tmpDir, 'plain.tar.gz') : output;
    try {
      await run('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-pass', `file:${passwordFile}`, '-in', archive, '-out', plainTarPath]);
    } catch {
      // openssl enc -d writes as it decrypts and only detects a wrong password/corrupt archive
      // via the padding check at the very end - a failed run still leaves a partial/garbage file
      // at -out. Remove it explicitly (not just tmpDir, which doesn't cover the non-extract case
      // where plainTarPath *is* the user's requested `output` path) rather than leaving that
      // behind looking like a real result.
      await rm(plainTarPath, { force: true }).catch(() => {});
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new Error('Decryption failed - wrong password, or the archive is corrupt.');
    }
  }

  try {
    if (extract) {
      await mkdir(output, { recursive: true });
      await run('tar', ['-xzf', plainTarPath, '-C', output]);
      console.log(`Extracted to ${output}`);
    } else {
      if (plainTarPath !== output) await copyFile(plainTarPath, output);
      console.log(`Wrote ${output}`);
    }
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
