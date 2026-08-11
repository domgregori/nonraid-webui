// Mirrors backend/src/browse/types.ts. Keep in sync.
export type BrowseEntryType = 'file' | 'directory' | 'symlink';

export interface BrowseEntry {
  name: string;
  type: BrowseEntryType;
  size: number;
  modifiedAt: string;
  locations?: string[];
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

export interface PathSuggestions {
  suggestions: string[];
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
