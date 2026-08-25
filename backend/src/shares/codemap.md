# backend/src/shares/

## Responsibility
Owns the share/pool domain: desired-state JSON stores (shares.json, share-access.json), request validation, and `ShareService`, which reconciles that desired state onto real mergerfs mounts and SMB/NFS exports.

## Design
- JSON files are the source of truth — no external system holds this data (smb.conf is generated *from* it). `ShareStore` (store.ts) and `ShareAccessStore` (aclStore.ts) each serialize writes through a single promise chain and persist via temp-file + `rename` (atomic, crash-safe), with an in-memory cache.
- `validateShareInput` (validate.ts) turns untrusted bodies into `ShareInput`: name regex, allocation-method enum, `allDisks` vs single-disk/cache-only rules, cache-only requires zero disks.
- Applier abstraction: `ShareApplier` interface + `ApplyContext` (`diskMountpoints`, `minFreeSpaceGb`, `cacheMountPoint`) in applier/client.ts; `RealShareApplier` in applier/realApplier.ts is the only impl, created by `createShareApplier()`.
- `ShareService` orchestrates: `buildContext()` (nmd status + settings + `cache.isActiveForShares()`) drives every applier call. Types in types.ts: `AllocationMethod`, `SharePermission`, `ShareAccess`, `ShareWithStats`.

## Flow
- Create/update/remove (routes/shares.ts) → `validateShareInput` → `mountShare`/`unmountShare` → `store.upsert`/`remove` → `aclStore` updates → `resyncExports()` → activity log.
- Startup `remountAll()`: `growAllDisksShares()` extends `allDisks` shares to live slots (persists each), then best-effort `mountShare` per share. `unmountAll()` is NOT best-effort — array stop depends on it.
- Rename (`update` with new name): unmount old → `moveShareData()` (per-disk dir `rename`, refuses if any disk offline or cache unmounted) → remove old mountpoint dir → `renameAccess()` → mount new.
- `removeMountPointWithData()`: unmount, `rm` real per-disk + cache data, drop store + ACL entries, resync — used by Browse's delete.
- `list()` enriches shares with applier stats, `smbstatus` connection counts, and per-share access.

## Integration
- Consumers: routes/shares.ts, routes/browse.ts (`removeMountPointWithData`, `locateShareEntries`, `getShareNames`), routes/users.ts (UsersService calls `resyncExports()` after ACL changes), routes/settings.ts, system/arrayLifecycle.ts (`remountAll`/`unmountAll` around array start/stop), cacheRouter (triggers `remountAll()` after cache mutations).
- Dependencies: `NmdClient`, `SettingsStore`, `CacheService`, `ActivityStore`, `config` paths (`sharesConfigPath`, `shareAccessConfigPath`, `shareMountRoot`).
- `index.ts` exports `ShareStore`, `ShareAccessStore`, `ShareService`, `createShareApplier`, `ShareApplier`, and all types.
