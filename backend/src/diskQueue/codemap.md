# backend/src/diskQueue/

## Responsibility
Serializes the "add" family of disk operations (add parity disk, add data disk, add cache mirror) into a single backend-owned FIFO queue, so array stop/add/start sequences can never overlap.

## Design
- `DiskQueueService` (service.ts), in-memory only (lost on restart — nmdctl's array state is the real source of truth). It is the single writer for `nmd.addDisk()` and `cache.setup()`: routes/diskQueue.ts is their only caller.
- `runLoop()` processes the head item to full completion — including the background resync it triggers (`waitForResyncIdle`), not just the initial API call. A failure pauses the queue at a `'failed'` head, never skipping ahead without human review; `retry()` only accepts that failed head; `remove()` forbids running/done items; `pruneHistory()` keeps the 5 most-recent done.
- `isBusy()` is the advisory 409 lock for Format/Unassign/Replace/Cache-Replace routes; `queuedDevicePaths()` hides claimed devices from /disks/available (prevents enqueuing the same disk twice).
- `runAddDiskItem` mirrors ArrayBuilder's hand-rolled stop/add/start/check order, generalized to any slot: fresh revalidation via `listAvailableDevices` (`partition ?? device`), refuse if an external resync is active, `unmountArrayWithContainerRetry` (stopContainers always true) + `stopArray`, `addDisk(autoStart:false)`, `startArray` (`ERROR:NO_DATA_DISKS` treated as done-with-note), `mountArrayDisksBestEffort`, `restoreDockerAndAutostartLxc`, then `parityCheck('CORRECT')` to actually kick the resync.
- `waitForResyncIdle` polls `getStatus` every 5s (setTimeout loop, no overlap), failing after 5 consecutive read errors or 6 consecutive pending-without-active polls (external cancel detection); the slot must end on `DISK_OK`.
- `runCacheMirrorItem`: revalidates devices, then `cache.setup()` with auto-retry-with-`-f` on an existing-filesystem refusal — no array stop, no resync wait (cache setup never touches nmdctl).

## Flow
- routes/diskQueue.ts enqueues → item pushed + `kick()` → `runLoop` marks `'running'`, sets phase (`committing`/`awaiting-resync`/`formatting`) → `runItem` → `'done'`/`'failed'` + activity log → next head, or pause on failure.

## Integration
- Dependencies: `NmdClient`, `CacheService`, `ShareService`, `LxcClient`, `ActivityStore`, and system/arrayLifecycle helpers (`unmountArrayWithContainerRetry`, `mountArrayDisksBestEffort`, `restoreDockerAndAutostartLxc`, `restoreStoppedContainers`).
- Constructed in index.ts; consumed by routes/diskQueue.ts, routes/disks.ts, and routes/cache.ts (advisory busy lock).
