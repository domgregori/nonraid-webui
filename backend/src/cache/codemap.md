# backend/src/cache/

## Responsibility
Owns the cache mirror — a two-device btrfs RAID1 pool — its lifecycle (create, mount, health, replace failed member) and the scheduled drain of its contents onto the array.

## Design
- `CacheService` (service.ts): `setup()` runs `mkfs.btrfs -m raid1 -d raid1` across exactly two freshly re-scanned devices (never trusts client paths; `-f` only after an unforced refusal), reads the new UUID via `blkid`, mounts, persists to `SettingsStore` (`fsUuid`, `enabled:false`). No ShareService dependency — callers trigger `shares.remountAll()` themselves.
- mount.ts helpers: `resolveCacheDevicePaths` (btrfs device scan + filesystem show, skipping `MISSING` members), `missingDevid` (devid 1/2), `isMounted`, `getDeviceModel`, `getDeviceSizeBytes`, and `mountCache` — idempotent, mounts degraded automatically when one member is gone, then chown/setgid/setfacl to `arrayDataOwner`.
- `isActiveForShares()` is the cheap check shares/applier uses: enabled + fsUuid + both members present + mounted (never degraded). `replaceDevice()` runs `btrfs replace start` on the missing devid with a same-size-or-larger guard; `replaceStatus()` polls progress.
- `CacheMoverService` (mover.ts) wraps the shared `FileMoveService` (source = /mnt/cache, every cache-eligible share — excludes single-disk and cache-only — no `excludeDestSlot`); plan+start in one call, unlike EmptyDiskService.
- `CacheMoverScheduler` (moverScheduler.ts): self-unref'd interval tick; fires the mover when `settings.cacheSchedule` matches the hour, only when the array is STARTED and not resyncing; also doubles as the job's completion watcher by diffing `job.finishedAt` (works for runs that finish between polls).

## Flow
- POST /cache/setup → `CacheService.setup` → route calls `shares.remountAll()`. Scheduler tick → `mover.run()` → engine plan+start → UI polls `status()`.
- `ShareService.buildContext()` calls `cache.isActiveForShares()` to decide whether shares get a cache branch.

## Integration
- Dependencies: `NmdClient`, `SmartService`, `SettingsStore`, `FileMoveService` (own instance per owner), `ActivityStore`.
- Constructed in index.ts (`CacheService`, `CacheMoverService`, `CacheMoverScheduler`); consumed by routes/cache.ts, routes/disks.ts (busy lock), system/arrayLifecycle.ts, docker/storagePath.ts + lxc/storagePath.ts (`requireCacheUsable`).
