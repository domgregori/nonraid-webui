# src/components/dashboard/

## Responsibility

Dashboard and Disks page cards: array capacity/protection/disk summaries, parity-check and background-job progress, system/cache/container/pool widgets, and the boot-disk tile.

## Design

- Cards wrap the shared `Card`/`ProgressBar` primitives and derive display data through selectors (`deriveDisks`, `deriveCapacity`, `deriveProtection`, `deriveParityViewModel`, `deriveContainerViewModel`, `deriveLxcContainerViewModel`, `deriveShareViewModel`).
- Many cards self-hide (return `null`) when their state doesn't apply, e.g. `CacheCard` before a mirror exists and `ParityCheckCard` while a new-disk clear is actually running.
- `StatCards` renders a three-card Capacity / Protection / Disks row.
- `ArrayDisks` renders the parity row (`ParityDiskCard`) and data grid (`DataDiskCard`) from `deriveDisks`, wiring `onClick` to `selectDisk`; it also routes the running new-disk clear view onto the clearing disk's own card.
- `DiskCard` exports `ParityDiskCard` and `DataDiskCard`; the data card swaps to a clear-progress view (pause/cancel, percent, ETA) when passed a `clearing` view model.
- `ParityCheckCard`, `DiskQueueCard`, `EmptyDiskProgressCard`, and `CacheMoverProgressCard` all present live operation progress from their own polling hooks; the two progress cards are client-dismissible and render nothing when idle.
- `DockerWidgetCard`/`LxcWidgetCard` render read-only `IconTile` grids using `NOOP_ACTIONS` view models; LXC tiles use `DistroIcon`.
- `CacheCard` shows cache health and a "Move Now" action (`cacheApi.runMover`).
- `SystemCard` shows CPU/memory/boot-disk bars; `BootDiskCard` is a compact boot-disk tile; `ArrayErrorCard` surfaces `ERROR:*` states with a `ReloadDriverPrompt`.
- `IconTile` renders a real icon (or letter-avatar fallback) plus pre-derived status color/label.

## Flow

Cards consume `useArrayStatus` and the per-feature hooks (`useSystemStats`, `useCacheStatus`, `useDockerContainers`, `useLxcContainers`, `useShares`, `useDiskQueueStatus`, `useEmptyDiskStatus`, `useCacheMoverStatus`) which poll on intervals; user actions call `nmdApi`/`cacheApi`/`diskQueueApi`/`emptyDiskApi` directly and rely on the next poll to refresh.

## Integration

`DashboardPage` mounts `StatCards`, `ArrayErrorCard`, `ParityCheckCard`, `DiskQueueCard`, `CacheCard`, `CacheMoverProgressCard`, `ArrayDisks (showManageLink)`, `DockerWidgetCard`, `LxcWidgetCard`, `SystemCard`, `SharesCard`. `DisksPage` mounts `ParityCheckCard`, `EmptyDiskProgressCard`, `DiskQueueCard`, `ArrayDisks`, and `BootDiskCard` (which opens `BootDiskDetailPanel`). Shared `ReloadDriverPrompt` is reused here and by Settings.
