import { stat } from 'node:fs/promises';
import { config } from '../config.js';
import { DAEMON_JSON_PATH } from '../docker/storagePath.js';
import type { NmdClient } from '../nmd/index.js';

// Single source of truth for what a config backup covers, shared by backup creation
// (backupStream.ts's resolveConfigBackupPaths, BackupScheduler) and restore (configRestore.ts,
// routes/system.ts's preview/commit) - grouped into categories a user can individually pick to
// restore rather than an undifferentiated flat file list. 'array' stays special-cased by callers
// (only ever actually restorable onto a currently-blank array - see configRestore.ts's
// isArrayBlank) on top of whatever this reports; 'adminAccount' is its own category rather than
// folded into 'appConfig' specifically so a restore can bring back shares/settings/history without
// silently swapping out whoever's currently logged in - confirmed live this session: restoring a
// backup clobbered a freshly-created admin account with the older one saved inside it, with no way
// to have kept the current login and restored everything else.
export type BackupCategoryId = 'array' | 'sharing' | 'appConfig' | 'adminAccount' | 'activityHistory' | 'graphHistory' | 'appdata' | 'remoteBackup';

export interface BackupCategory {
  id: BackupCategoryId;
  label: string;
  description: string;
  paths: string[];
}

/**
 * `includeAppdata` adds the 'appdata' category on top of the fixed six below - opted into by the
 * "Config backups + appdata" scope (Local Backups' own scope picker, and each Remote Backup sync
 * job's scope) rather than always included, since it's typically far larger than everything else
 * here combined. Resolved as config.appsBindRoots as a whole (the same host paths the Docker/Apps
 * bind-mount allow-list already treats as "where container data lives" - see config.ts's own doc
 * comment on appsBindRoots) rather than trying to enumerate every individual container's actual
 * bind mounts - simpler, and still backs up real appdata, just at root granularity rather than
 * filtered to only-currently-bound subpaths.
 */
export async function resolveBackupCategories(nmd: NmdClient, includeAppdata = false): Promise<BackupCategory[]> {
  const categories: BackupCategory[] = [
    { id: 'array', label: 'Array', description: 'The array superblock - disk assignments and parity configuration.', paths: [await nmd.getSuperblockPath()] },
    { id: 'sharing', label: 'Samba/NFS config', description: 'smb.conf and /etc/exports.', paths: [config.smbConfPath, config.exportsPath] },
    {
      id: 'appConfig',
      label: 'App settings & shares',
      description: 'This app\'s own config.toml, settings, shares, share permissions, and Docker\'s storage location.',
      paths: ['/etc/nonraid', config.settingsConfigPath, config.sharesConfigPath, config.shareAccessConfigPath, DAEMON_JSON_PATH],
    },
    { id: 'adminAccount', label: 'Admin account', description: 'The login used to sign into this dashboard.', paths: [config.authConfigPath] },
    { id: 'activityHistory', label: 'Activity history', description: 'The event log shown on the Dashboard and History page.', paths: [config.activityConfigPath] },
    { id: 'graphHistory', label: 'Graph history', description: 'Recorded CPU/memory/disk/network metrics behind the History page\'s graphs.', paths: [config.metricsDbPath] },
    {
      id: 'remoteBackup',
      label: 'Remote Backup',
      description: "Configured rclone remotes (provider credentials) and sync job definitions - without these, Remote Backup comes back from a restore with no remotes or jobs configured, even if it's still switched on.",
      paths: [config.rcloneConfigPath, config.rcloneSyncJobsConfigPath],
    },
  ];
  if (includeAppdata) {
    categories.push({
      id: 'appdata',
      label: 'Appdata',
      description: "Docker/LXC containers' own persistent data - everything under this host's configured app bind-mount root(s).",
      paths: [...config.appsBindRoots],
    });
  }
  return categories;
}

/** Flattened, existing-only path list - what actually gets archived. Shared by the on-demand
 *  backup route and BackupScheduler so both back up exactly the same things. */
export async function resolveConfigBackupPaths(nmd: NmdClient, includeAppdata = false): Promise<string[]> {
  const categories = await resolveBackupCategories(nmd, includeAppdata);
  const allPaths = categories.flatMap((c) => c.paths);
  const existing = await Promise.all(allPaths.map(async (p) => ((await pathExists(p)) ? p : null)));
  return existing.filter((p): p is string => p !== null);
}

/** Category ids that actually contributed at least one existing path to a backup archive - what
 *  the `.meta.json` sidecar's own `categories` field records (see backupMeta.ts), computed at
 *  backup-creation time so nothing ever needs to read the archive back to produce it. */
export async function resolveExistingCategoryIds(nmd: NmdClient, includeAppdata = false): Promise<BackupCategoryId[]> {
  const categories = await resolveBackupCategories(nmd, includeAppdata);
  const withExistence = await Promise.all(
    categories.map(async (c) => ({ id: c.id, exists: (await Promise.all(c.paths.map(pathExists))).some(Boolean) })),
  );
  return withExistence.filter((c) => c.exists).map((c) => c.id);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Which category (if any) an archive member - a tar path like "etc/samba/smb.conf", relative,
 *  no leading "/" - belongs to. A category's own paths are absolute; matched either as an exact
 *  file or as a member living under a directory category ('appConfig''s "/etc/nonraid"). */
export function categoryForMember(member: string, categories: BackupCategory[]): BackupCategoryId | null {
  for (const cat of categories) {
    for (const p of cat.paths) {
      const rel = p.replace(/^\//, '');
      if (member === rel || member.startsWith(`${rel}/`)) return cat.id;
    }
  }
  return null;
}
