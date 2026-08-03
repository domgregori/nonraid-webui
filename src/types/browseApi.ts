// Mirrors backend/src/browse/types.ts. Keep in sync.
export type BrowseEntryType = 'file' | 'directory' | 'symlink';

export interface BrowseEntry {
  name: string;
  type: BrowseEntryType;
  size: number;
  modifiedAt: string;
}

export interface BrowseListing {
  root: string;
  path: string;
  entries: BrowseEntry[];
}

export interface BrowseCommandResult {
  ok: boolean;
  message: string;
}
