import { useCallback, useEffect, useRef, useState } from 'react';
import { browseApi } from '../api/browseApi';
import type { BrowseEntry, BrowseListing } from '../types/browseApi';

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

export interface UseBrowse {
  path: string;
  listing: BrowseListing | null;
  status: BrowseLoadStatus;
  error: string | null;
  actionError: string | null;
  busy: boolean;
  canGoUp: boolean;
  navigate: (path: string) => void;
  open: (entry: BrowseEntry) => void;
  up: () => void;
  refresh: () => void;
  downloadUrl: (entry: BrowseEntry) => string;
  mkdir: (name: string) => Promise<boolean>;
  rename: (entry: BrowseEntry, newName: string) => Promise<boolean>;
  remove: (entry: BrowseEntry) => Promise<boolean>;
  move: (entry: BrowseEntry, destPath: string) => Promise<boolean>;
  upload: (files: FileList | File[]) => Promise<boolean>;
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
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await browseApi.list(path);
      if (!mounted.current) return;
      setListing(result);
      setStatus('ready');
      setError(null);
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

  const remove = useCallback(
    (entry: BrowseEntry) => withAction(async () => { await browseApi.remove(joinPath(path, entry.name)); }),
    [path, withAction],
  );

  const move = useCallback(
    (entry: BrowseEntry, destPath: string) => withAction(async () => { await browseApi.move(joinPath(path, entry.name), destPath); }),
    [path, withAction],
  );

  const upload = useCallback(
    (files: FileList | File[]) => withAction(async () => { await browseApi.upload(path, files); }),
    [path, withAction],
  );

  return { path, listing, status, error, actionError, busy, canGoUp, navigate, open, up, refresh, downloadUrl, mkdir, rename, remove, move, upload };
}
