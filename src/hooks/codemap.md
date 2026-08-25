# src/hooks/

## Responsibility
Data-fetching React hooks that bridge the `src/api` layer to pages/components. Mostly polling hooks (`useEffect` + `setInterval`), plus a few one-shot/on-demand and derived hooks.

## Design
- Dominant pattern: `useState` + `useRef(mounted)` guard + `useCallback(refresh)` that calls an api method, then `useEffect(() => { refresh(); const id = setInterval(refresh, POLL_MS); … })`. Unmount sets `mounted.current = false` and clears the interval so no state is set after unmount.
- Poll intervals vary by cost/speed: 2s (useCacheMoverStatus, useDiskQueueStatus, useEmptyDiskStatus), 3s (useSystemStats), 4s (useDockerContainers, useLxcContainers), 5s (useCacheStatus, useGroups, useShares, useUsers), 8s (NotificationsProvider poll, not here), 15s/5s adaptive (useDiskSmart — faster while a self-test runs), 60s (useMetrics, matching backend sampling).
- Actions are never optimistic: `useDockerContainers`/`useLxcContainers`/`useShares`/`useUsers`/`useGroups` call the api, then `refresh()`, with a `pending`/`pendingNames`/`pendingUsernames` `Set<string>` to disable per-row buttons.
- Specialized members: `useActivity` (pollable or one-shot, shared by dashboard card and history dialog), `useApps` (debounced search, category/sort filters, feed refresh), `useBrowse` (full file-browser state machine incl. `BulkJobState` with `AbortController`), `useInstallProgress` (dedupes pull-layer ticks into one line per `layerId`), `useMetrics` vs `useLiveMetrics` (DB-backed 60s poll vs. client-side ring buffer reusing existing polls), `useSettings` (thin `SettingsContext` accessor), `useTheme` (localStorage + `data-theme` on `<html>`).

## Flow
1. Mount → immediate `refresh()` → `setInterval`. Every tick updates state and clears `error` on success; failures keep last-known data (best-effort).
2. User action → set pending → api call → `refresh()` → clear pending.
3. `useLiveMetrics` appends points to a ref-backed `Map` buffer and `publish()`es a snapshot to state only when data changed, pruning points older than a 10-minute window.

## Integration
- Import the api modules (`src/api/*`) and occasionally other hooks/state (`useLiveMetrics` uses `useSystemStats` + `useArrayStatus`).
- Consumed by pages (`useBrowse` → BrowsePage, `useDockerContainers` → DockerPage, …) and dashboard components.
- `useSettings`/`useArrayStatus` re-export context accessors from `src/state`.
