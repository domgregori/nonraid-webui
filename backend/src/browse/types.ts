export type BrowseEntryType = 'file' | 'directory' | 'symlink';

export interface BrowseEntry {
  name: string;
  type: BrowseEntryType;
  size: number;
  modifiedAt: string;
  /** Physical disk branch(es) backing this entry - present only when the listing is inside a
   *  user share (config.shareMountRoot), where mergerfs can blend more than one disk together. */
  locations?: string[];
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
