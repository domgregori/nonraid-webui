import { useCallback, useEffect, useRef, useState } from 'react';
import { browseApi } from '../api/browseApi';
import type { BrowseEntry, BrowseListing } from '../types/browseApi';

export type BrowseLoadStatus = 'loading' | 'ready' | 'error';

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

export interface UseBrowse {
  path: string;
  listing: BrowseListing | null;
  status: BrowseLoadStatus;
  error: string | null;
  actionError: string | null;
  busy: boolean;
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

/** Drives one share's directory view: navigation, listing, and file ops. Resets to
 * the share root whenever `share` changes (e.g. the user picks a different share). */
export function useBrowse(share: string | null): UseBrowse {
  const [path, setPath] = useState('');
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

  useEffect(() => {
    setPath('');
  }, [share]);

  const refresh = useCallback(async () => {
    if (!share) return;
    setStatus('loading');
    try {
      const result = await browseApi.list(share, path);
      if (!mounted.current) return;
      setListing(result);
      setStatus('ready');
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setStatus('error');
      setError((err as Error).message);
    }
  }, [share, path]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const navigate = useCallback((next: string) => setPath(next), []);
  const up = useCallback(() => setPath((prev) => parentOf(prev)), []);

  const open = useCallback(
    (entry: BrowseEntry) => {
      if (entry.type === 'directory') navigate(joinPath(path, entry.name));
    },
    [navigate, path],
  );

  const downloadUrl = useCallback((entry: BrowseEntry) => browseApi.downloadUrl(share ?? '', joinPath(path, entry.name)), [share, path]);

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

  const mkdir = useCallback(
    (name: string) =>
      withAction(async () => {
        if (!share) return;
        await browseApi.mkdir(share, path, name);
      }),
    [share, path, withAction],
  );

  const rename = useCallback(
    (entry: BrowseEntry, newName: string) =>
      withAction(async () => {
        if (!share) return;
        await browseApi.rename(share, joinPath(path, entry.name), newName);
      }),
    [share, path, withAction],
  );

  const remove = useCallback(
    (entry: BrowseEntry) =>
      withAction(async () => {
        if (!share) return;
        await browseApi.remove(share, joinPath(path, entry.name));
      }),
    [share, path, withAction],
  );

  const move = useCallback(
    (entry: BrowseEntry, destPath: string) =>
      withAction(async () => {
        if (!share) return;
        await browseApi.move(share, joinPath(path, entry.name), destPath);
      }),
    [share, path, withAction],
  );

  const upload = useCallback(
    (files: FileList | File[]) =>
      withAction(async () => {
        if (!share) return;
        await browseApi.upload(share, path, files);
      }),
    [share, path, withAction],
  );

  return { path, listing, status, error, actionError, busy, navigate, open, up, refresh, downloadUrl, mkdir, rename, remove, move, upload };
}
