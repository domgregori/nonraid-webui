import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { DAEMON_JSON_PATH } from '../docker/storagePath.js';
import { resolveLxcPath } from '../lxc/storagePath.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';

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
export type BackupCategoryId = 'array' | 'sharing' | 'appConfig' | 'adminAccount' | 'activityHistory' | 'graphHistory' | 'appdata' | 'remoteBackup' | 'lxc' | 'users';

// The extension every config backup archive this app writes gets, encrypted or not - a branded
// stand-in for the generic ".tar.gz" every archive actually still is under the hood (tar+gzip, or
// that piped through openssl enc - see backupCrypto.ts), the same "the container format doesn't
// change, only the label on it" reasoning backupMeta.ts's own doc comment already established for
// why a `.meta.json` sidecar carries the encrypted flag instead of the extension. Shared by
// backupStream.ts, backupScheduler.ts, and rclone/service.ts so every archive this app creates -
// on-demand download, scheduled local, or remote sync - uses the same suffix.
export const ARCHIVE_EXT = '.nrb';
// Every archive this app wrote before ARCHIVE_EXT existed - recognized alongside ARCHIVE_EXT
// wherever existing archives are matched (local/remote listing, retention pruning, restore lookup)
// so upgrading this app doesn't orphan anything already on disk or already uploaded; never used for
// naming a newly-created archive.
export const LEGACY_ARCHIVE_EXT = '.tar.gz';

/** True for a filename this app would recognize as one of its own config backup archives -
 *  `prefix` is the caller's own archive-naming prefix (BackupScheduler's/RcloneService's each
 *  differ), suffix is ARCHIVE_EXT or LEGACY_ARCHIVE_EXT. */
export function isOwnArchiveName(name: string, prefix: string): boolean {
  return name.startsWith(prefix) && (name.endsWith(ARCHIVE_EXT) || name.endsWith(LEGACY_ARCHIVE_EXT));
}

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
export async function resolveBackupCategories(nmd: NmdClient, settingsStore: SettingsStore, includeAppdata = false): Promise<BackupCategory[]> {
  const categories: BackupCategory[] = [
    { id: 'array', label: 'Array', description: 'The array superblock - disk assignments and parity configuration.', paths: [await nmd.getSuperblockPath()] },
    { id: 'sharing', label: 'Samba/NFS config', description: 'smb.conf and /etc/exports.', paths: [config.smbConfPath, config.exportsPath] },
    {
      id: 'appConfig',
      label: 'App settings & shares',
      description: 'This app\'s own settings, shares, share permissions, and Docker\'s storage location.',
      paths: [config.settingsConfigPath, config.sharesConfigPath, config.shareAccessConfigPath, DAEMON_JSON_PATH],
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
    {
      id: 'lxc',
      label: 'LXC containers',
      description: "Each LXC container's own config file (resource limits, network, mount points, rootfs location) - not the container's own filesystem, which is either 'appdata' (below) or too large to back up wholesale either way. The path here is this host's whole LXC storage root, so a restore still recognizes these members even onto a host with no containers currently defined - see resolveLxcConfigFilePaths() for what's actually archived out of it.",
      paths: [await resolveLxcRootSafe(settingsStore)],
    },
    {
      id: 'users',
      label: 'SMB/NFS users & groups',
      description: "This app's own managed users and groups (and their SMB passwords) - without these, a restore brings back share definitions with nobody actually able to log into them. usersExportPath is a snapshot regenerated fresh right before each backup run (see users/backupExport.ts), not a live file - restoring it recreates whatever's missing rather than overwriting /etc/passwd directly.",
      paths: [config.usersExportPath, config.sambaPasswdPath],
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

/** resolveLxcPath() throws when lxcStorage is 'array' mode with no disk slot chosen yet (an
 *  inconsistent state this app's own settings route never actually lets happen, but backup
 *  creation runs unattended from a scheduler tick too, where degrading to "no LXC configs this
 *  run" beats a whole backup failing over one category). */
async function resolveLxcRootSafe(settingsStore: SettingsStore): Promise<string> {
  try {
    const settings = await settingsStore.get();
    return resolveLxcPath(settings.lxcStorage);
  } catch {
    return '';
  }
}

/** The small subset of an 'lxc' category's directory root that's actually worth archiving - each
 *  container's own `config` file, never its rootfs. Mirrors lxc/storagePath.ts's own
 *  rewriteRootfsPaths() (readdir the storage root, treat each subdirectory with a `config` file as
 *  one container) rather than going through LxcClient.listContainers(), so this module doesn't need
 *  its own LxcClient dependency just to enumerate two-dozen bytes of file names. */
async function resolveLxcConfigFilePaths(lxcRoot: string): Promise<string[]> {
  if (!lxcRoot) return [];
  const entries = await readdir(lxcRoot, { withFileTypes: true }).catch(() => []);
  const candidates = entries.filter((e) => e.isDirectory()).map((e) => path.join(lxcRoot, e.name, 'config'));
  const existing = await Promise.all(candidates.map(async (p) => ((await pathExists(p)) ? p : null)));
  return existing.filter((p): p is string => p !== null);
}

/** Flattened, existing-only path list - what actually gets archived. Shared by the on-demand
 *  backup route and BackupScheduler so both back up exactly the same things. The 'lxc' category's
 *  own `paths` (its whole storage root, for restore-time member matching - see its doc comment
 *  above) is expanded here into just its real per-container config files, never archived as-is. */
export async function resolveConfigBackupPaths(nmd: NmdClient, settingsStore: SettingsStore, includeAppdata = false): Promise<string[]> {
  const categories = await resolveBackupCategories(nmd, settingsStore, includeAppdata);
  const allPaths: string[] = [];
  for (const c of categories) {
    if (c.id === 'lxc') allPaths.push(...(await resolveLxcConfigFilePaths(c.paths[0] ?? '')));
    else allPaths.push(...c.paths);
  }
  const existing = await Promise.all(allPaths.map(async (p) => ((await pathExists(p)) ? p : null)));
  return existing.filter((p): p is string => p !== null);
}

/** Category ids that actually contributed at least one existing path to a backup archive - what
 *  the `.meta.json` sidecar's own `categories` field records (see backupMeta.ts), computed at
 *  backup-creation time so nothing ever needs to read the archive back to produce it. */
export async function resolveExistingCategoryIds(nmd: NmdClient, settingsStore: SettingsStore, includeAppdata = false): Promise<BackupCategoryId[]> {
  const categories = await resolveBackupCategories(nmd, settingsStore, includeAppdata);
  const withExistence = await Promise.all(
    categories.map(async (c) => {
      if (c.id === 'lxc') return { id: c.id, exists: (await resolveLxcConfigFilePaths(c.paths[0] ?? '')).length > 0 };
      return { id: c.id, exists: (await Promise.all(c.paths.map(pathExists))).some(Boolean) };
    }),
  );
  return withExistence.filter((c) => c.exists).map((c) => c.id);
}

async function pathExists(p: string): Promise<boolean> {
  if (!p) return false;
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Which category (if any) an archive member - a tar path like "etc/samba/smb.conf", relative,
 *  no leading "/" - belongs to. A category's own paths are absolute; matched either as an exact
 *  file or as a member living under a directory category ('appdata''s bind-mount roots). */
export function categoryForMember(member: string, categories: BackupCategory[]): BackupCategoryId | null {
  for (const cat of categories) {
    for (const p of cat.paths) {
      const rel = p.replace(/^\//, '');
      if (member === rel || member.startsWith(`${rel}/`)) return cat.id;
    }
  }
  return null;
}
