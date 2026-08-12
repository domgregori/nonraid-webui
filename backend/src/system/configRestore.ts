import { unlink } from 'node:fs/promises';
import type { NmdClient } from '../nmd/index.js';
import { runSudoMaybe } from './procUtil.js';

interface StagedRestore {
  filePath: string;
  uploadedAt: number;
}

// Same shape as routes/array.ts's own stagedImports (single-admin, upload-then-decide, in-memory,
// swept lazily) — kept as its own independent map rather than sharing that one, since these are a
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

/** Lists a config backup archive's members without extracting anything — `tar -tzf`, splitting
 *  on newlines. GNU tar strips the leading "/" from absolute paths when creating an archive (see
 *  streamConfigBackup/writeConfigBackupToFile, which archive absolute paths directly), so members
 *  come back relative to "/" — re-prepend it before comparing against a real absolute path. */
export async function listArchiveMembers(filePath: string, useSudo: boolean): Promise<string[]> {
  const { stdout } = await runSudoMaybe('tar', ['-tzf', filePath], useSudo);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Same "nothing assigned yet" signal the frontend's onboarding wizard already uses
 *  (deriveStartStep() in OnboardingWizard.tsx) — every disk slot has an empty disk_id. Re-derived
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
 * Extracts exactly `members` (a subset of what listArchiveMembers() returned — the caller decides
 * which ones, e.g. dropping the superblock member when isArrayBlank() said no) from `filePath`
 * back onto the real filesystem at their original absolute locations. `-C /` plus naming each
 * member explicitly means untouched members (the ones left out) are never even read, let alone
 * written — not a full-archive extract followed by cleanup.
 *
 * Drops bare directory members (tar -tzf lists them with a trailing "/", e.g. "etc/nonraid/")
 * before extracting — confirmed live that GNU tar, given a directory member and a file inside it
 * as two separate named extraction targets in the same invocation, fails the file with "Not found
 * in archive" even though it's really there. Harmless to drop: extracting any file always creates
 * its parent directories anyway, so a bare directory entry never carried anything the file
 * extractions wouldn't already produce.
 */
export async function restoreArchiveMembers(filePath: string, members: string[], useSudo: boolean): Promise<void> {
  const fileMembers = members.filter((m) => !m.endsWith('/'));
  if (fileMembers.length === 0) return;
  await runSudoMaybe('tar', ['-xzf', filePath, '-C', '/', ...fileMembers], useSudo);
}
