import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import { spawnWithPipedStdin } from './procUtil.js';

/**
 * Password-encrypting backup archives with `openssl enc` (AES-256, PBKDF2 key derivation) - the
 * tool settled on for this feature over `gpg` specifically because it's a plain subprocess call
 * with no daemon/agent/keyring involved, which matters for a backend spawning it unattended from
 * a scheduler tick (see the handoff doc's "Encryption tool" decision). The archive itself is
 * layered - `tar czf -` piped through `openssl enc` (encrypt) or the reverse (decrypt) - never a
 * new container format; the `.tar.gz` extension stays the same either way (see backupMeta.ts).
 *
 * The password is never passed as a CLI argument (visible to any local user via `ps`) - every
 * call here writes it to a private (mode 0600), single-use temp file and passes
 * `-pass file:<path>`, deleting that file the moment the openssl process exits, success or not.
 */
export const OPENSSL_CIPHER_ARGS = ['-aes-256-cbc', '-pbkdf2'] as const;
const STDERR_TAIL_MAX = 2000;

// Same "stable code, not a message match" contract as status.ts's own ARRAY_NOT_CONFIGURED (see
// api/request.ts's CodedError - any endpoint's JSON error body can carry a `code` field and every
// caller throws/catches it the same way). The frontend keys off this one code to know "show/keep
// showing a password field" apart from every other kind of restore-preview failure.
export const PASSWORD_REQUIRED_CODE = 'PASSWORD_REQUIRED';

// Both extend HttpError(400, ...) so every existing `err instanceof HttpError` branch in this app
// (routes/system.ts, rclone/service.ts's callers, ...) already reports these with the right
// status with no extra handling - passwordErrorCode() below is only for the one thing HttpError
// alone can't express: the PASSWORD_REQUIRED_CODE code in the JSON body.
export class PasswordRequiredError extends HttpError {
  constructor(message = 'This backup is encrypted - enter its password to continue.') {
    super(400, message);
    this.name = 'PasswordRequiredError';
  }
}

export class IncorrectPasswordError extends HttpError {
  constructor(message = 'Incorrect password, or the archive is corrupt.') {
    super(400, message);
    this.name = 'IncorrectPasswordError';
  }
}

/** PASSWORD_REQUIRED_CODE for both flavors of "this needs a (correct) password" - no password
 *  given for an archive whose sidecar/magic-bytes say it's encrypted, or one given that didn't
 *  work - `undefined` for anything else, so a route can spread `{ code: passwordErrorCode(err) }`
 *  straight into its JSON error body without a conditional of its own. */
export function passwordErrorCode(err: unknown): string | undefined {
  return err instanceof PasswordRequiredError || err instanceof IncorrectPasswordError ? PASSWORD_REQUIRED_CODE : undefined;
}

/** Exported for backupStream.ts's own streaming encrypt path (tar's stdout piped straight into
 *  openssl's stdin, rather than file-to-file the way encryptFileInPlace()/decryptFileToTemp() work
 *  here) - same private-temp-file-then-unlink handling either way. */
export async function withPasswordFile<T>(password: string, fn: (passwordFilePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nonraid-backup-pw-'));
  const file = path.join(dir, 'pw');
  try {
    const handle = await open(file, 'w', 0o600);
    try {
      await handle.writeFile(password, 'utf8');
    } finally {
      await handle.close();
    }
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Gzip's own two-byte magic (0x1f 0x8b) - what every unencrypted archive this app writes starts
 *  with, whatever openssl enc's own output never does. Only used where there's no `.meta.json`
 *  sidecar to trust in the first place - a raw browser upload has no established sidecar
 *  relationship the way the local/remote pickers do, so this is the upload route's own way of
 *  knowing whether to ask for a password before ever handing the file to `buildRestorePreview()`. */
export async function looksLikeGzip(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  } finally {
    await handle.close();
  }
}

function runOpensslPipe(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawnWithPipedStdin(config.opensslBin, args);
    let stderrTail = '';
    let bytes = 0;
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_MAX);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    input.pipe(child.stdin);
    child.stdout.pipe(output);
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      if (!child.killed) child.kill();
      reject(err);
    };
    child.on('error', (err) => fail(new Error(`Failed to start openssl: ${err.message}`)));
    input.on('error', (err) => fail(err as Error));
    output.on('error', (err) => fail(err as Error));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(bytes);
      else reject(new Error(`openssl exited with code ${code}: ${stderrTail.trim()}`));
    });
  });
}

/**
 * Pipes an already-on-disk plaintext file through `openssl enc` (encrypt) to `destPath` - used by
 * RcloneService, which always builds its archive into a local stagingDir file first (the same
 * plaintext copy that's about to be uploaded via rclone either way, so there's no separate
 * "streaming" path worth building for it - see backupStream.ts's writeConfigBackupToFile for the
 * streaming variant used by Local Backups' direct-to-destination write).
 */
export async function encryptFileInPlace(srcPath: string, destPath: string, password: string): Promise<void> {
  await withPasswordFile(password, (passwordFilePath) =>
    runOpensslPipe(createReadStream(srcPath), createWriteStream(destPath), ['enc', ...OPENSSL_CIPHER_ARGS, '-pass', `file:${passwordFilePath}`]),
  );
}

/**
 * Decrypts `srcPath` to a freshly-created private temp file, returning its path - the caller is
 * responsible for unlinking it once done (same "caller owns cleanup" convention as every other
 * staging path in this app). Any openssl failure - wrong password, truncated/corrupt archive,
 * openssl missing - surfaces as IncorrectPasswordError rather than whatever raw stderr openssl
 * printed: PBKDF2 + AES-CBC's own padding check means a wrong password overwhelmingly fails
 * cleanly at this step ("bad decrypt"), so there's no meaningful case here worth telling apart
 * from a genuinely wrong password for the caller's purposes.
 */
export async function decryptFileToTemp(srcPath: string, password: string): Promise<string> {
  const destPath = path.join(os.tmpdir(), `nonraid-decrypt-${randomUUID()}.tar.gz`);
  try {
    await withPasswordFile(password, (passwordFilePath) =>
      runOpensslPipe(createReadStream(srcPath), createWriteStream(destPath), ['enc', '-d', ...OPENSSL_CIPHER_ARGS, '-pass', `file:${passwordFilePath}`]),
    );
  } catch {
    await rm(destPath, { force: true }).catch(() => {});
    throw new IncorrectPasswordError();
  }
  return destPath;
}
