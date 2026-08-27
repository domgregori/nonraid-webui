export type BrowseEntryType = 'file' | 'directory' | 'symlink';

/** What kind of top-level storage location a directory entry is - only ever set for entries one
 *  level above the location itself (see BrowseService.list()'s own classification logic): a raw
 *  array disk, the cache pool, an individual pool, or - the one that isn't a mount point at all -
 *  a plain directory that happens to sit alongside them (e.g. a container's own conventional
 *  /mnt/user/appdata, created by convention rather than through this app's Pools feature).
 *  /mnt/user itself isn't a mount point, so anything unmounted directly under it is really just
 *  sitting on the boot disk's own filesystem, not redundant array storage - confirmed live via
 *  `stat -f`, same device as `/`. Lets the UI color-code otherwise identical-looking folders so
 *  it's clear at a glance what's actually pool/array/cache storage vs. limited boot-disk space. */
export type BrowseLocationType = 'pool' | 'disk' | 'cache' | 'boot';

export interface BrowseEntry {
  name: string;
  type: BrowseEntryType;
  size: number;
  modifiedAt: string;
  /** Physical disk branch(es) backing this entry - present only when the listing is inside a
   *  user share (config.shareMountRoot), where mergerfs can blend more than one disk together. */
  locations?: string[];
  locationType?: BrowseLocationType;
  /** Set only for type: 'file' - whether the Browse page's text editor can open it (small enough,
   *  and not binary by content sniff). Lets the UI decide clickability without guessing from the
   *  extension. */
  editable?: boolean;
}

export interface BrowseListing {
  /** The browse ceiling ("/mnt" by default) - clients compare `path` against
   * this to know when they've reached the top and should hide/disable "up". */
  root: string;
  path: string;
  entries: BrowseEntry[];
}

export interface BrowseCommandResult {
  ok: boolean;
  message: string;
}

export interface BrowseFileContent {
  content: string;
}

export type BulkOp = 'copy' | 'move' | 'delete';

export interface BulkOpProgress {
  index: number;
  total: number;
  name: string;
}

export interface BulkOpResult {
  succeeded: string[];
  failed: { path: string; error: string }[];
  cancelled: boolean;
}
