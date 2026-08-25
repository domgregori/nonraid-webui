# backend/src/fileMove/

## Responsibility
Generic background engine that moves real files from one source (a retiring array disk or the cache pool) onto other array disks, bin-packed per each share's own allocation policy.

## Design
- `FileMoveService` (service.ts); each owner (`EmptyDiskService`, `CacheMoverService`) constructs its own instance, so single-flight is per-instance, not global.
- `plan(PlanParams)`: `dfAvailBytes` per eligible destination, `find -type f` under each relevant share's directory on the source, `stat` with concurrency 64, then first-fit-decreasing bin-pack via `pickDestination` (`fill-up` = first fitting in configured order; all others = most-free) against a simulated free-space map. Collects `unfitExamples` (max 20) and `unmanagedBytes` (top-level dirs not under a configured share — left behind, reported). Refuses to start (`fits:false`) if anything doesn't fit anywhere, rather than discovering that mid-move with the source half emptied.
- `start()` launches `run()` fire-and-forget (real data can take hours; callers poll `status()`, same pattern as nmdctl resync). Per file: `mkdir` recursive (capturing the first created dir for a targeted chown), `copyFile`, size-verify, `chownArrayOwner`, then `unlink` the source — an interrupted job leaves both a valid copy and a valid original, safely resumable by planning again. `cancel()` sets a flag checked per file.
- Per-file errors accumulate; job ends `'done'` with an error summary, or `'failed'`/`'cancelled'`.

## Flow
- Owner (emptyDisk or cache mover) → `engine.plan` → `engine.start` → background `run` loop → owner polls `engine.status()`. `finishedAt` drives CacheMoverScheduler's completion watcher (a fast run can finish between polls, so status-transition diffing alone misses it).

## Integration
- Depends only on `config` (`arrayDataOwner`) and node fs/child_process — no domain services. Consumed by emptyDisk/service.ts and cache/mover.ts; both construct their own instance from index.ts wiring.
