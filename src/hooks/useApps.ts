import { useCallback, useEffect, useRef, useState } from 'react';
import { appsApi } from '../api/appsApi';
import type { AppSort, AppSummary, FeedMeta } from '../types/appsApi';

export type AppsLoadStatus = 'loading' | 'ready' | 'error';

export interface UseApps {
  apps: AppSummary[];
  categories: string[];
  meta: FeedMeta | null;
  status: AppsLoadStatus;
  error: string | null;
  search: string;
  setSearch: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  sort: AppSort | null;
  setSort: (v: AppSort | null) => void;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

const SEARCH_DEBOUNCE_MS = 250;

export function useApps(): UseApps {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [meta, setMeta] = useState<FeedMeta | null>(null);
  const [status, setStatus] = useState<AppsLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<AppSort | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    appsApi
      .listCategories()
      .then((list) => mounted.current && setCategories(list))
      .catch(() => {});
    appsApi
      .getFeedMeta()
      .then((m) => mounted.current && setMeta(m))
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      setStatus((s) => (s === 'ready' ? 'ready' : 'loading'));
      appsApi
        .listApps({ search, category, sort: sort ?? undefined })
        .then((list) => {
          if (!mounted.current) return;
          setApps(list);
          setStatus('ready');
          setError(null);
        })
        .catch((err) => {
          if (!mounted.current) return;
          setStatus('error');
          setError((err as Error).message);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, category, sort]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const m = await appsApi.refreshFeed();
      setMeta(m);
      const [list, cats] = await Promise.all([
        appsApi.listApps({ search, category, sort: sort ?? undefined }),
        appsApi.listCategories(),
      ]);
      setApps(list);
      setCategories(cats);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [search, category, sort]);

  return { apps, categories, meta, status, error, search, setSearch, category, setCategory, sort, setSort, refreshing, refresh };
}
