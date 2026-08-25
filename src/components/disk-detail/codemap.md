# src/components/disk-detail/

## Responsibility

Disk-level inspection and mutation: the slide-in disk detail panel, add/replace/empty/shrink dialogs, cache mirror setup and replacement, the boot-disk detail panel, and unassigned-device browsing.

## Design

- Two overlay patterns: the global `detail-panel` slide-in (`DiskDetailPanel`, `BootDiskDetailPanel`, `UnassignedDeviceDetailPanel`) and centered `.dialog` modals for one-off flows.
- `SmartOverviewRows` and `BenchmarkSection` are deliberately shared across all three detail panels so the same data doesn't render with different layouts; `BenchmarkSection` takes `onRead`/optional `onWrite` callbacks and renders read/write series in `TimeSeriesChart`.
- `DiskDetailPanel` is mounted globally (in `AppShell`) and renders only while `selectedDiskId` is set; it computes context-sensitive actions (`needsFormat`, `needsMount`, `canForceFormat`, `isRestorable`, `isDroppable`) from the disk view model and array state, plus SMART tabs (overview/attributes/capabilities) driven by `useDiskSmart`.
- `AddDiskDialog` picks a role (data/parity/parity2) and enqueues via `diskQueueApi`; parity slot 0 / parity2 slot 29 occupancy disables options.
- `ReplaceDiskDialog` is a staged flow (confirm -> select -> result) whose final step is one atomic `nmdApi.replaceDisk` call.
- `CacheSetupDialog` picks two distinct devices and enqueues a btrfs mirror via `diskQueueApi.enqueueCacheMirror`; `CacheReplaceDialog` polls `cacheApi.getReplaceStatus` every 3s during an online btrfs replace.
- `EmptyDiskDialog` fetches an `EmptyDiskPlanSummary` via `emptyDiskApi.plan`, then starts a background job or falls back to stop-array + `nmdApi.unassignDisk` when there's nothing to move.
- `ShrinkArrayDialog` is the riskiest flow (driver reload mid-operation) and uses a two-step confirm plus `ArrayActionErrorBanner` with a retry-with-stop-containers action.
- `UnassignedDevicesCard` lists available devices with per-row SMART health (`useDeviceHealth`) and opens `AddDiskDialog` or `UnassignedDeviceDetailPanel`.
- `CacheSection` (with `CacheSetupDialog`/`CacheReplaceDialog`) manages the cache mirror on the Disks page.

## Flow

Selection state originates in `useArrayStatus.selectDisk`; `DiskDetailPanel` actions call `nmdApi`/`emptyDiskApi` and surface results inline (`actionNote`, `ArrayActionErrorBanner`). Dialog completion callbacks (`onDone`/`onStarted`/`onClose`) trigger parent refreshes.

## Integration

`DiskDetailPanel` and `shared/ArrayStopBlockedModal` mount once in `AppShell`. `DisksPage` mounts `UnassignedDevicesCard`, `CacheSection`, and `BootDiskDetailPanel`. Depends on `useArrayStatus`, `useDiskSmart`, `useAvailableDevices`, `useCacheStatus`, `useSystemStats`, and APIs `nmdApi`, `diskQueueApi`, `cacheApi`, `emptyDiskApi`, `smartApi`, `systemApi`. Styling in `src/styles/disk-detail.css` and `dialog.css`.
