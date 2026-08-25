# backend/src/emptyDisk/

## Responsibility
Moves a data disk's real files off onto the rest of the array so the disk can be safely unassigned — the data-movement half of the Unassign/Restore/Replace flow.

## Design
- `EmptyDiskService` (service.ts) is a thin wrapper around the generic `FileMoveService` (shared with the cache mover). It resolves "slot N" to a mountpoint (via `NmdClient.getStatus` data disks) + relevant shares (`s.disks` includes the slot) + destination candidates (every other mounted data disk), and translates the engine's generic `sourceId`-shaped types (`"disk:<slot>"`) into a slot-shaped public API (`EmptyDiskPlanSummary`/`EmptyDiskJobState`) — routes and frontend are unchanged by this refactor.
- `plan(slot)` calls `engine.plan` with `excludeDestSlot = slot` (a disk can't be its own destination) and maps the result to `EmptyDiskPlanSummary` (`fits`, `fileCount`, `totalBytes`, `perDestinationBytes`, `unfitExamples`, `unfitReason`, `unmanagedBytes`).
- `status()`/`start()`/`cancel()` delegate to the engine's job/start/cancel, re-deriving the slot from the sourceId.

## Flow
- routes/emptyDisk.ts → `plan(slot)` → `engine.plan` (bin-packs files per each share's allocation method, simulates free space, refuses if anything doesn't fit) → returns summary for UI review; then `start(slot)` → `engine.start` runs the background move; UI polls `status()`. Engine states: `planning → planned → running → done/failed/cancelled`.

## Integration
- Dependencies: `NmdClient` (data-disk mountpoints) and `ShareStore` (share list). Uses `FileMoveService` from ../fileMove with its own instance — per-owner single-flight, so an empty-disk job and the cache mover don't block each other.
- Constructed in index.ts; consumed by routes/emptyDisk.ts. Sibling of cache/mover.ts (same engine, source = /mnt/cache).
