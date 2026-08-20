import { unlink } from 'node:fs/promises';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import { categoryForMember, resolveBackupCategories, type BackupCategoryId } from './backupCatalog.js';
import { decryptFileToTemp, PasswordRequiredError } from './backupCrypto.js';
import { runSudoMaybe } from './procUtil.js';

interface StagedRestore {
  filePath: string;
  uploadedAt: number;
}

// Same shape as routes/array.ts's own stagedImports (single-admin, upload-then-decide, in-memory,
// swept lazily) - kept as its own independent map rather than sharing that one, since these are a
// different kind of archive (a config tar.gz, not a 4096-byte superblock) with no reason to share
// token space.
const stagedRestores = new Map<string, StagedRestore>();
const STAGING_TTL_MS = 30 * 60 * 1000;

export function sweepStagedRestores(): void {
  const cutoff = Date.now() - STAGING_TTL_MS;
  for (const [token, staged] of stagedRestores) {
    if (staged.uploadedAt < cutoff) {
      stagedRestores.delete(token);
      unlink(staged.filePath).catch(() => {});
    }
  }
}

export function stageRestoreFile(token: string, filePath: string): void {
  stagedRestores.set(token, { filePath, uploadedAt: Date.now() });
}

export function getStagedRestore(token: string): StagedRestore | undefined {
  return stagedRestores.get(token);
}

export function dropStagedRestore(token: string): void {
  stagedRestores.delete(token);
}

/** Lists a config backup archive's members without extracting anything - `tar -tzf`, splitting
 *  on newlines. GNU tar strips the leading "/" from absolute paths when creating an archive (see
 *  streamConfigBackup/writeConfigBackupToFile, which archive absolute paths directly), so members
 *  come back relative to "/" - re-prepend it before comparing against a real absolute path. */
export async function listArchiveMembers(filePath: string): Promise<string[]> {
  const { stdout } = await runSudoMaybe('tar', ['-tzf', filePath]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Same "nothing assigned yet" signal the frontend's onboarding wizard already uses
 *  (deriveStartStep() in OnboardingWizard.tsx) - every disk slot has an empty disk_id. Re-derived
 *  here rather than trusted from a client-supplied flag, since this gates whether the array
 *  superblock is allowed into the restore at all. */
export async function isArrayBlank(nmd: NmdClient): Promise<boolean> {
  try {
    const status = await nmd.getStatus();
    return status.disks.every((d) => !d.disk_id);
  } catch {
    return true; // no status available reads the same as "nothing configured" for this check
  }
}

/**
 * Extracts exactly `members` (a subset of what listArchiveMembers() returned - the caller decides
 * which ones, e.g. dropping the superblock member when isArrayBlank() said no) from `filePath`
 * back onto the real filesystem at their original absolute locations. `-C /` plus naming each
 * member explicitly means untouched members (the ones left out) are never even read, let alone
 * written - not a full-archive extract followed by cleanup.
 *
 * Drops bare directory members (tar -tzf lists them with a trailing "/", e.g. "etc/nonraid/")
 * before extracting - confirmed live that GNU tar, given a directory member and a file inside it
 * as two separate named extraction targets in the same invocation, fails the file with "Not found
 * in archive" even though it's really there. Harmless to drop: extracting any file always creates
 * its parent directories anyway, so a bare directory entry never carried anything the file
 * extractions wouldn't already produce.
 */
export async function restoreArchiveMembers(filePath: string, members: string[]): Promise<void> {
  const fileMembers = members.filter((m) => !m.endsWith('/'));
  if (fileMembers.length === 0) return;
  await runSudoMaybe('tar', ['-xzf', filePath, '-C', '/', ...fileMembers]);
}

/**
 * The decrypt stage each of the three restore sources (upload, local-list, remote-list) runs
 * immediately before its own buildRestorePreview() call, never inside buildRestorePreview() itself
 * - see the handoff doc's "Encrypt/decrypt as a stream stage" section. `encrypted` is decided by
 * the caller (a `.meta.json` sidecar's own `encrypted` field for the local/remote sources, or
 * backupCrypto.ts's looksLikeGzip() fallback for a raw upload with no sidecar of its own) - this
 * function only acts on that decision, decrypting to a fresh temp plaintext file when true and
 * passing the original path straight through unchanged when false. Callers should always invoke
 * the returned `cleanup()` once they're done with the resulting path, whether or not decryption
 * actually happened (a no-op when it didn't) - same "caller owns cleanup" convention as every
 * other staging path in this app.
 *
 * Throws PasswordRequiredError when `encrypted` is true and no password was given, or
 * IncorrectPasswordError (from decryptFileToTemp) when one was given but didn't work - either way
 * this happens before buildRestorePreview() ever sees ciphertext, so a wrong password fails
 * cleanly here instead of surfacing as a confusing "archive is empty or not a valid config backup"
 * error from further downstream.
 */
export async function decryptIfNeeded(filePath: string, encrypted: boolean, password: string | null | undefined): Promise<{ path: string; cleanup: () => Promise<void> }> {
  if (!encrypted) return { path: filePath, cleanup: async () => {} };
  if (!password) throw new PasswordRequiredError();
  const decryptedPath = await decryptFileToTemp(filePath, password);
  return { path: decryptedPath, cleanup: () => unlink(decryptedPath).catch(() => {}) };
}

export interface RestorePreviewData {
  entries: { path: string; isSuperblock: boolean }[];
  categories: { id: BackupCategoryId; label: string; description: string; entries: string[] }[];
  arrayIsBlank: boolean;
  arrayStopped: boolean;
}

/**
 * Everything /system/backup/restore/preview needs to compute from an already-on-disk archive -
 * shared by every way of getting there (a fresh browser upload, a file already sitting at the
 * Local Backups destination, or one just pulled down from a configured rclone remote). Doesn't
 * stage the file or mint a token itself - callers do that with stageRestoreFile() right after,
 * since only they know whether the file needs cleaning up on their own error paths first (e.g. the
 * upload route unlinking a bad upload before this ever throws).
 *
 * `includeAppdata` is always on here (unlike resolveBackupCategories()'s own default) - a restore
 * preview has to recognize an 'appdata' member if the archive happens to have one (built by a
 * "config backups + appdata" Local/Remote Backup run) or it silently falls into no category at
 * all and can never be selected or restored, even though it's sitting right there in the archive.
 */
export async function buildRestorePreview(nmd: NmdClient, filePath: string): Promise<RestorePreviewData> {
  const members = await listArchiveMembers(filePath);
  if (members.length === 0) throw new HttpError(400, 'Archive is empty or not a valid config backup.');

  const superblockPath = await nmd.getSuperblockPath();
  const superblockMember = superblockPath.replace(/^\//, '');
  const arrayIsBlank = await isArrayBlank(nmd);
  const status = await nmd.getStatus().catch(() => null);
  const arrayStopped = status ? status.array.state !== 'STARTED' : true;

  const categories = await resolveBackupCategories(nmd, true);
  // Directory members (e.g. "etc/nonraid/") are counted in their category's totals below but
  // dropped from the flat `entries` shown per-member - same reasoning restoreArchiveMembers()
  // itself already has for not extracting them: a bare directory carries nothing the file
  // members inside it don't already imply.
  const categories_ = categories
    .map((cat) => ({
      id: cat.id,
      label: cat.label,
      description: cat.description,
      entries: members.filter((m) => !m.endsWith('/') && categoryForMember(m, categories) === cat.id).map((m) => `/${m}`),
    }))
    .filter((c) => c.entries.length > 0);

  return {
    entries: members.map((m) => ({ path: `/${m}`, isSuperblock: m === superblockMember })),
    categories: categories_,
    arrayIsBlank,
    arrayStopped,
  };
}
