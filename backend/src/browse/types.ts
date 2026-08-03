export type BrowseEntryType = 'file' | 'directory' | 'symlink';

export interface BrowseEntry {
  name: string;
  type: BrowseEntryType;
  size: number;
  modifiedAt: string;
}

export interface BrowseListing {
  /** The browse ceiling ("/mnt" by default) — clients compare `path` against
   * this to know when they've reached the top and should hide/disable "up". */
  root: string;
  path: string;
  entries: BrowseEntry[];
}

export interface BrowseCommandResult {
  ok: boolean;
  message: string;
}
