import { readFile, rm, writeFile } from 'node:fs/promises';
import type { BackupScope } from '../settings/types.js';
import type { BackupCategoryId } from './backupCatalog.js';

/**
 * The plaintext `.meta.json` sidecar every backup archive gets written alongside, encrypted or
 * not - this is what lets any "list backups" surface (the local picker, the remote picker, the
 * "existing backups found" notice) show what's *in* a backup and whether it's encrypted without
 * ever needing a password. See the handoff doc's "Proposed architecture" section for the full
 * reasoning; this module only owns the shape and the local (fs) read/write/delete of it -
 * RcloneService additionally builds one of these into its own local stagingDir (so it rides along
 * on the same rclone upload as the archive itself) and reads/deletes the remote copy via its own
 * RC-backed calls, both using buildMeta()/metaPathFor() from here.
 */
export interface BackupMeta {
  version: 1;
  createdAt: string; // ISO 8601
  scope: BackupScope;
  categories: BackupCategoryId[];
  encrypted: boolean;
}

export const META_SUFFIX = '.meta.json';

/** Swaps an archive's trailing ".tar.gz" for ".meta.json" - both BackupScheduler's and
 *  RcloneService's own archive filenames end in ".tar.gz" today (encrypted or not - the extension
 *  deliberately never changes, see BackupMeta's own doc comment), so this one substitution covers
 *  every archive-naming convention in the app without either caller needing its own copy. */
export function metaPathFor(archivePath: string): string {
  return archivePath.replace(/\.tar\.gz$/, META_SUFFIX);
}

export function metaNameFor(archiveName: string): string {
  return archiveName.replace(/\.tar\.gz$/, META_SUFFIX);
}

export function buildMeta(scope: BackupScope, categories: BackupCategoryId[], encrypted: boolean): BackupMeta {
  return { version: 1, createdAt: new Date().toISOString(), scope, categories, encrypted };
}

export async function writeMetaSidecar(archivePath: string, meta: BackupMeta): Promise<void> {
  await writeFile(metaPathFor(archivePath), JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * Missing sidecar reads as "legacy unencrypted, categories unknown" (null) everywhere, not an
 * error - every backup made before this feature shipped has no `.meta.json` at all, and that's
 * the actual mechanism behind the "destination already has previous unencrypted backups" edge
 * case, not a special case handled separately. A sidecar that exists but fails to parse (would
 * only ever happen from manual tampering, never anything this app itself writes) reads the same
 * way, for the same reason - a listing surface should degrade gracefully, not error out over one
 * bad entry.
 */
export async function readMetaSidecar(archivePath: string): Promise<BackupMeta | null> {
  try {
    const raw = await readFile(metaPathFor(archivePath), 'utf8');
    return JSON.parse(raw) as BackupMeta;
  } catch {
    return null;
  }
}

export async function deleteMetaSidecar(archivePath: string): Promise<void> {
  await rm(metaPathFor(archivePath), { force: true }).catch(() => {});
}
