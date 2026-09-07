import { spawnWithPipedStdin } from '../system/procUtil.js';
import { config } from '../config.js';

/**
 * One secret, from exactly one of three sources: a typed passphrase (piped over stdin, never an
 * argv string so it's never visible in `ps`, never written to disk), the shared array keyfile
 * (`--key-file <path>`, read directly by cryptsetup itself off its own on-disk path), or an
 * ad-hoc keyfile's raw bytes supplied for one call only (`--key-file -`, piped over stdin exactly
 * like a passphrase is - see `keyfileContents`'s own doc comment for why this is never written to
 * a temp path). Every function below that needs to authenticate against an existing LUKS device
 * takes this shape rather than several separate optional parameters, so a caller can't
 * accidentally supply more than one or none.
 */
export type LuksSecret = { passphrase: string } | { keyfilePath: string } | { keyfileContents: Buffer };

function isKeyfilePath(secret: LuksSecret): secret is { keyfilePath: string } {
  return 'keyfilePath' in secret;
}

function isKeyfileContents(secret: LuksSecret): secret is { keyfileContents: Buffer } {
  return 'keyfileContents' in secret;
}

/**
 * Runs `cryptsetup <args>`, writing `stdinInput` to its stdin and closing it immediately after -
 * a newline-terminated string, one line per prompt cryptsetup will issue in order, for a typed
 * passphrase; a raw `Buffer` for an ad-hoc keyfile's exact bytes (paired with `--key-file -` in
 * the caller's own `args`, never line-terminated the way a passphrase is, since a real keyfile
 * isn't newline-convention text - see `luksOpen()`'s own `keyfileContents` branch). This is the
 * only mechanism this module uses to hand cryptsetup secret material - verified live against the
 * project's own real-hardware rig (cryptsetup 2.7.5): luksFormat/luksOpen/luksAddKey/luksRemoveKey
 * all read a non-interactive passphrase this way with `--batch-mode` (where a new secret is being
 * set) and no confirmation re-prompt, and `luksOpen --key-file -` reads an uploaded keyfile's
 * bytes the same way. Never pass secret material as an argv element - it would be visible to any
 * local user via `ps` - and never write it to a file on disk first.
 */
function runCryptsetup(args: string[], stdinInput: string | Buffer, timeoutMs: number = config.luksTimeoutMs): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnWithPipedStdin(config.cryptsetupBin, args);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`cryptsetup ${args[0] ?? ''} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start cryptsetup: ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `cryptsetup ${args[0] ?? ''} exited with code ${code}`));
    });

    child.stdin.on('error', () => {
      // A child that exits before consuming stdin (e.g. it rejected the args before ever
      // prompting) would otherwise surface as an unhandled EPIPE on this write - the real failure
      // reason is always the process's own stderr/exit code, already handled by the 'close'
      // handler above, so this is deliberately silent.
    });
    child.stdin.write(stdinInput);
    child.stdin.end();
  });
}

/** Initializes a new LUKS2 container on `device`, destroying any previous content. Only ever
 *  called on a raw partition this app itself just confirmed is blank/reformattable (see
 *  luks/service.ts's formatDiskAsLuks) - cryptsetup's own refusal-on-existing-signature safety net
 *  is bypassed by `--batch-mode` the same way mkfs.xfs's `force` path already bypasses its own. */
export async function luksFormat(device: string, passphrase: string): Promise<void> {
  await runCryptsetup(['luksFormat', '--batch-mode', '--type', 'luks2', device], `${passphrase}\n`);
}

/** Opens `device`, mapping it to `/dev/mapper/<mapName>` - `mapName` should match nmdctl's own
 *  disk_name for the slot (e.g. `nmd1p1`) so a subsequent `nmdctl mount`/`status` sees the same
 *  mapping nmdctl's own keyfile-based open would have created. The `keyfileContents` branch
 *  (`--key-file -`) is how a one-off, admin-uploaded keyfile unlocks a disk - the caller (see
 *  luks/service.ts's unlockDisk()) receives those bytes as a Buffer already held in memory (never
 *  a path on disk) and hands them straight to this same stdin-piping mechanism a typed passphrase
 *  already uses, exactly as instructed: pipe over stdin, don't stage a temp file. Verified live
 *  against the rig's real cryptsetup (2.7.5): `luksOpen --key-file - <device> <name>` reads the
 *  full, unmodified stdin buffer as key material with no line/newline handling (unlike passphrase
 *  mode) and no default truncation observed for a realistic keyfile size. */
export async function luksOpen(device: string, mapName: string, secret: LuksSecret): Promise<void> {
  if (isKeyfilePath(secret)) {
    await runCryptsetup(['luksOpen', '--key-file', secret.keyfilePath, device, mapName], '');
  } else if (isKeyfileContents(secret)) {
    await runCryptsetup(['luksOpen', '--key-file', '-', device, mapName], secret.keyfileContents);
  } else {
    await runCryptsetup(['luksOpen', device, mapName], `${secret.passphrase}\n`);
  }
}

/** Closes an active mapping by name (the reverse of luksOpen) - no secret needed, matching
 *  `cryptsetup luksClose`'s own signature. */
export async function luksClose(mapName: string): Promise<void> {
  await runCryptsetup(['luksClose', mapName], '');
}

/** Adds a new passphrase-typed key slot to `device`, authorized by an already-valid `existing`
 *  secret. Used for the mandatory recovery slot at format time, and for adding a new day-to-day
 *  passphrase when switching stored -> manual unlock mode. */
export async function luksAddKey(device: string, existing: LuksSecret, newPassphrase: string): Promise<void> {
  if (isKeyfilePath(existing)) {
    await runCryptsetup(['luksAddKey', '--batch-mode', '--key-file', existing.keyfilePath, device], `${newPassphrase}\n`);
  } else if (isKeyfileContents(existing)) {
    // Not a real call path today (only luksOpen()'s one-off unlock accepts an ad-hoc keyfile's
    // bytes) - a clear error here rather than silently misreading `existing` if that ever changes.
    throw new Error('luksAddKey: an ad-hoc keyfile-contents secret is not supported here.');
  } else {
    await runCryptsetup(['luksAddKey', '--batch-mode', device], `${existing.passphrase}\n${newPassphrase}\n`);
  }
}

/** Adds the shared array keyfile itself as a new key slot, authorized by an already-valid
 *  passphrase - the "switch to stored unlock mode" primitive for one disk. `--new-keyfile` reads
 *  the new key material as raw bytes from `keyfilePath` rather than a typed line of stdin, which is
 *  the correct shape here (the new secret *is* the keyfile's contents, not something to type).
 *  Verified live against the rig's real cryptsetup: `luksAddKey -q --new-keyfile <path> <device>`
 *  with the existing passphrase piped over stdin. */
export async function luksAddKeyfile(device: string, existingPassphrase: string, keyfilePath: string): Promise<void> {
  await runCryptsetup(['luksAddKey', '--batch-mode', '--new-keyfile', keyfilePath, device], `${existingPassphrase}\n`);
}

/**
 * Removes whichever key slot `secret` unlocks - cryptsetup identifies the slot to delete by
 * testing which one the given secret opens, regardless of whether that secret came from stdin or
 * `--key-file`, so this is safe to call with either a passphrase or the shared keyfile without
 * needing to track slot numbers. Verified live against the rig's real cryptsetup in both
 * directions: a stdin-piped passphrase removes exactly that passphrase's own slot (confirmed a
 * sibling passphrase slot survives untouched), and `--key-file <path>` removes exactly the
 * keyfile's own slot (confirmed a sibling passphrase slot survives and still opens the device
 * afterward) - each leaves every other slot intact.
 */
export async function luksRemoveKey(device: string, secret: LuksSecret): Promise<void> {
  if (isKeyfilePath(secret)) {
    await runCryptsetup(['luksRemoveKey', device, '--key-file', secret.keyfilePath], '');
  } else if (isKeyfileContents(secret)) {
    // Not a real call path today - see luksAddKey()'s identical guard for why.
    throw new Error('luksRemoveKey: an ad-hoc keyfile-contents secret is not supported here.');
  } else {
    await runCryptsetup(['luksRemoveKey', device], `${secret.passphrase}\n`);
  }
}

/** True if `device` currently carries a LUKS header at all - a lighter-weight check than parsing
 *  `nmdctl status`'s own filesystem.type for a caller that only has a raw device path, not a live
 *  disk slot, to work from. Not currently called anywhere in this feature (luks/service.ts's own
 *  callers all already have a live slot, so they read `filesystem.type` off `nmd.getStatus()`
 *  instead - see encryptionStateFor() - which is cheaper than shelling out again for the same
 *  answer); kept as part of this wrapper's documented "status" operation family (see
 *  docs/luks-support-scope.md's "Backend surface" section) for a future caller that only has a
 *  bare device path. */
export async function isLuks(device: string): Promise<boolean> {
  try {
    await runCryptsetup(['isLuks', device], '', 10_000);
    return true;
  } catch {
    return false;
  }
}

/** Number of currently-occupied key slots on `device`. Not currently called anywhere: every key
 *  slot this feature ever removes (luksRemoveKey, from switchToManual()) is specifically the
 *  keyfile's own slot, and every disk always independently keeps its original format-time
 *  passphrase slot and its mandatory recovery-passphrase slot untouched (see formatDiskAsLuks()),
 *  so no current call site can ever drive a disk down to a single remaining slot - there's
 *  nothing for a "would this leave only one slot" check to guard yet. Kept available for a future
 *  caller that removes an admin-chosen slot directly (not yet exposed by this feature) and would
 *  need that guard. Parses `luksDump`'s own text output (no `--dump-json-metadata` in the 2.7.5
 *  CLI surface this was verified against for a plain slot count) - counts distinct `<n>: luks2`
 *  slot header lines, the same lines this module's own rig verification read by eye to confirm
 *  add/remove key behavior. */
export async function luksKeySlotCount(device: string): Promise<number> {
  const { stdout } = await runCryptsetup(['luksDump', device], '', 10_000);
  const slotLines = stdout.match(/^\s*\d+: luks2\s*$/gm);
  return slotLines?.length ?? 0;
}
