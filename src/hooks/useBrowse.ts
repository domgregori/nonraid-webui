import { useCallback, useEffect, useRef, useState } from 'react';
import { browseApi } from '../api/browseApi';
import type { BrowseEntry, BrowseListing, BulkOp, BulkOpProgress, BulkOpResult } from '../types/browseApi';

export type BrowseLoadStatus = 'loading' | 'ready' | 'error';

// Mirrors backend/src/config.ts's browseDefaultPath default — the page's
// starting point, /mnt/user, before any listing has come back from the server.
const DEFAULT_PATH = '/mnt/user';

function joinPath(parent: string, name: string): string {
  return parent.endsWith('/') ? `${parent}${name}` : `${parent}/${name}`;
}

function parentOf(absPath: string): string {
  const idx = absPath.lastIndexOf('/');
  return idx <= 0 ? '/' : absPath.slice(0, idx);
}

export interface BulkJobState {
  op: BulkOp;
  total: number;
  progress: BulkOpProgress | null;
  /** Set once the server reports a clean completion — including a server-observed cancel (the
   *  request stayed connected long enough for req.on('close') to report back what had actually
   *  succeeded before stopping). */
  result: BulkOpResult | null;
  /** Set when the client itself severed the connection before any server response arrived — the
   *  exact succeeded/failed split in that case is unknowable client-side, so this is tracked
   *  separately rather than faking an empty BulkOpResult. */
  aborted: boolean;
  error: string | null;
  controller: AbortController;
}

export interface UseBrowse {
  path: string;
  listing: BrowseListing | null;
  status: BrowseLoadStatus;
  error: string | null;
  actionError: string | null;
  busy: boolean;
  canGoUp: boolean;
  selected: Set<string>;
  sizes: Record<string, number>;
  bulkJob: BulkJobState | null;
  navigate: (path: string) => void;
  open: (entry: BrowseEntry) => void;
  up: () => void;
  refresh: () => void;
  downloadUrl: (entry: BrowseEntry) => string;
  mkdir: (name: string) => Promise<boolean>;
  rename: (entry: BrowseEntry, newName: string) => Promise<boolean>;
  upload: (files: FileList | File[]) => Promise<boolean>;
  toggleSelect: (name: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  calculateSize: (entry: BrowseEntry) => Promise<number>;
  startBulk: (op: BulkOp, entries: BrowseEntry[], destPath?: string) => void;
  cancelBulk: () => void;
  dismissBulk: () => void;
}

/** Drives the file browser: navigation, listing, and file ops over the whole
 * /mnt tree. Starts at /mnt/user; "up" stops working once `listing.path`
 * reaches `listing.root` ("/mnt", the highest directory the server allows). */
export function useBrowse(): UseBrowse {
  const [path, setPath] = useState(DEFAULT_PATH);
  const [listing, setListing] = useState<BrowseListing | null>(null);
  const [status, setStatus] = useState<BrowseLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [bulkJob, setBulkJob] = useState<BulkJobState | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Calculated sizes are keyed by absolute path, which already encodes the directory — they only
  // go stale on a real navigation, not on a same-directory refresh (e.g. after New Folder).
  useEffect(() => {
    setSizes({});
  }, [path]);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await browseApi.list(path);
      if (!mounted.current) return;
      setListing(result);
      setStatus('ready');
      setError(null);
      setSelected(new Set());
    } catch (err) {
      if (!mounted.current) return;
      setStatus('error');
      setError((err as Error).message);
    }
  }, [path]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const navigate = useCallback((next: string) => setPath(next), []);
  const up = useCallback(() => setPath((prev) => parentOf(prev)), []);
  const canGoUp = listing !== null && listing.path !== listing.root;

  const open = useCallback(
    (entry: BrowseEntry) => {
      if (entry.type === 'directory') navigate(joinPath(path, entry.name));
    },
    [navigate, path],
  );

  const downloadUrl = useCallback((entry: BrowseEntry) => browseApi.downloadUrl(joinPath(path, entry.name)), [path]);

  const withAction = useCallback(
    async (action: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        await refresh();
        return true;
      } catch (err) {
        setActionError((err as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const mkdir = useCallback((name: string) => withAction(async () => { await browseApi.mkdir(path, name); }), [path, withAction]);

  const rename = useCallback(
    (entry: BrowseEntry, newName: string) => withAction(async () => { await browseApi.rename(joinPath(path, entry.name), newName); }),
    [path, withAction],
  );

  const upload = useCallback(
    (files: FileList | File[]) => withAction(async () => { await browseApi.upload(path, files); }),
    [path, withAction],
  );

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set((listing?.entries ?? []).map((e) => e.name)));
  }, [listing]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const calculateSize = useCallback(
    async (entry: BrowseEntry): Promise<number> => {
      const absPath = joinPath(path, entry.name);
      const { bytes } = await browseApi.calculateSize(absPath);
      if (mounted.current) setSizes((prev) => ({ ...prev, [absPath]: bytes }));
      return bytes;
    },
    [path],
  );

  const startBulk = useCallback(
    (op: BulkOp, entries: BrowseEntry[], destPath?: string) => {
      const controller = new AbortController();
      const paths = entries.map((e) => joinPath(path, e.name));
      setBulkJob({ op, total: paths.length, progress: null, result: null, aborted: false, error: null, controller });

      browseApi
        .bulk(
          paths,
          op,
          destPath,
          (p) => {
            if (mounted.current) setBulkJob((prev) => (prev ? { ...prev, progress: p } : prev));
          },
          controller.signal,
        )
        .then((result) => {
          if (!mounted.current) return;
          setBulkJob((prev) => (prev ? { ...prev, result } : prev));
          refresh();
        })
        .catch((err) => {
          if (!mounted.current) return;
          if ((err as Error).name === 'AbortError') {
            setBulkJob((prev) => (prev ? { ...prev, aborted: true } : prev));
            refresh(); // some items likely completed before the abort landed — worth reloading
          } else {
            setBulkJob((prev) => (prev ? { ...prev, error: (err as Error).message } : prev));
          }
        });
    },
    [path, refresh],
  );

  const cancelBulk = useCallback(() => {
    setBulkJob((prev) => {
      prev?.controller.abort();
      return prev;
    });
  }, []);

  const dismissBulk = useCallback(() => setBulkJob(null), []);

  return {
    path,
    listing,
    status,
    error,
    actionError,
    busy,
    canGoUp,
    selected,
    sizes,
    bulkJob,
    navigate,
    open,
    up,
    refresh,
    downloadUrl,
    mkdir,
    rename,
    upload,
    toggleSelect,
    selectAll,
    clearSelection,
    calculateSize,
    startBulk,
    cancelBulk,
    dismissBulk,
  };
}
