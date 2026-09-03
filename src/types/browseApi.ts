// Mirrors backend/src/browse/types.ts. Keep in sync.
export type BrowseEntryType = 'file' | 'directory' | 'symlink';

export type BrowseLocationType = 'pool' | 'disk' | 'cache' | 'boot';

export interface BrowseEntry {
  name: string;
  type: BrowseEntryType;
  size: number;
  modifiedAt: string;
  locations?: string[];
  locationType?: BrowseLocationType;
  editable?: boolean;
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

export interface BrowseFileContent {
  content: string;
}

export interface PathSuggestions {
  suggestions: string[];
}

export type BulkOp = 'copy' | 'move' | 'delete';

export interface BulkOpProgress {
  index: number;
  total: number;
  name: string;
  // Sub-progress *within* this one entry, for a copy/move whose source is a directory with many
  // files - absent for delete (no equivalent hook - see backend browse/service.ts) and absent for
  // the first tick of any entry (fires only once real per-file work starts). filesDone is a
  // running count, not a fraction of a known total - see backend's own FileProgressCallback doc
  // comment for why getting a real total isn't worth a second walk of the tree just for this.
  currentFile?: string;
  filesDone?: number;
}

export interface BulkOpResult {
  succeeded: string[];
  failed: { path: string; error: string }[];
  cancelled: boolean;
}

export interface SearchMatch {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

export interface SearchResult {
  count: number;
  /** True once MAX_SEARCH_RESULTS (backend/src/routes/browse.ts) was hit - there may be more
   *  matches than what's shown, not just exactly this many. */
  truncated: boolean;
}
