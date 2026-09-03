import { useCallback, useRef, useState } from 'react';
import { browseApi } from '../api/browseApi';
import type { SearchMatch } from '../types/browseApi';

export type SearchScope = 'here' | 'everywhere';

export interface UseBrowseSearch {
  query: string;
  setQuery: (q: string) => void;
  scope: SearchScope;
  setScope: (s: SearchScope) => void;
  /** Off by default - a plain filename search containing "." or "(" shouldn't silently start
   *  meaning "any character" or "group start" for anyone who didn't ask for fdfind's own
   *  (Rust-flavored) regex syntax. */
  regex: boolean;
  setRegex: (r: boolean) => void;
  /** True once a search has actually been run - distinct from a non-empty query, since typing
   *  alone shouldn't replace the normal directory listing until Enter/Search is actually pressed
   *  (a recursive search, especially "everywhere", is real work worth an explicit trigger). */
  active: boolean;
  results: SearchMatch[];
  searching: boolean;
  truncated: boolean;
  error: string | null;
  run: () => void;
  cancel: () => void;
  /** Back to the normal directory listing - clears the query too, unlike cancel(). */
  clear: () => void;
}

/** Streamed recursive filename search (GET-equivalent /browse/search, see its own doc comment for
 *  why fdfind) - a sibling to useBrowse rather than folded into it, since it's a genuinely separate
 *  concern (its own query/scope/results state machine) that only needs useBrowse's current `path`
 *  as an input, for "here" scope. */
export function useBrowseSearch(currentPath: string): UseBrowseSearch {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('here');
  const [regex, setRegex] = useState(false);
  const [active, setActive] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(() => {
    const q = query.trim();
    if (!q) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setActive(true);
    setSearching(true);
    setResults([]);
    setTruncated(false);
    setError(null);

    browseApi
      .search(scope === 'here' ? currentPath : '', q, regex, (match) => setResults((prev) => [...prev, match]), controller.signal)
      .then((result) => {
        setSearching(false);
        setTruncated(result.truncated);
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return; // cancel()/a newer run() already handled UI state
        setSearching(false);
        setError((err as Error).message);
      });
  }, [query, scope, regex, currentPath]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setSearching(false);
  }, []);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    setQuery('');
    setActive(false);
    setResults([]);
    setSearching(false);
    setTruncated(false);
    setError(null);
  }, []);

  return { query, setQuery, scope, setScope, regex, setRegex, active, results, searching, truncated, error, run, cancel, clear };
}
