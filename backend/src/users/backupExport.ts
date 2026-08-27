import { readFile, writeFile } from 'node:fs/promises';
import type { UsersClient } from './client.js';
import type { UsersRestoreResult, UsersSnapshot } from './types.js';

/**
 * Regenerates the JSON snapshot backupCatalog.ts's 'users' category archives - called by each
 * backup-creation call site (routes/system.ts, BackupScheduler, RcloneService) right before
 * resolveConfigBackupPaths(), same "checkpoint immediately before the tar step reads it" pattern
 * as MetricsService.checkpointForBackup(). See config.ts's usersExportPath doc comment for why
 * this file exists at all rather than trusting a live /etc/passwd restore.
 */
export async function writeUsersExport(users: UsersClient, destPath: string): Promise<void> {
  const snapshot = await users.exportSnapshot();
  await writeFile(destPath, JSON.stringify(snapshot, null, 2), 'utf8');
}

/**
 * Reads back a snapshot already restored to `exportPath` by the generic tar-extract-in-place
 * restore every other category member goes through, and recreates whatever's missing on this
 * host - the follow-up materialization step for the 'users' category, same idea as the array
 * superblock's reloadModuleAndImport() in routes/system.ts's own restore/commit handler.
 */
export async function restoreUsersExport(users: UsersClient, exportPath: string): Promise<UsersRestoreResult> {
  const raw = await readFile(exportPath, 'utf8');
  const snapshot = JSON.parse(raw) as UsersSnapshot;
  return users.restoreSnapshot(snapshot);
}
