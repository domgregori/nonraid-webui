# backend/src/nmd/

## Responsibility
Everything about the NonRAID array: status, start/stop, add/replace/restore/format/unassign disks, parity checks, topology changes (`shrinkArray`), and superblock import/restore. Pure shell-out to `nmdctl` and the kernel driver's `/proc/nmdcmd` — no database.

## Design
- **Interface + impl + factory**: `NmdClient` (client.ts) → `RealNmdClient` (realClient.ts), constructed via `createNmdClient()` in index.ts.
- **Two command paths**: `run()` shells out to `nmdctl -u --no-color <argv>` (argv arrays only, never shell strings); `writeNmdCmd()` writes a single command to `config.nmdCmdPath` (`/proc/nmdcmd`) for unassign/import; `runSystem()` handles `mv`/`modprobe`/`blockdev`/`rmdir`/`mkfs.xfs`. Failures throw `new Error(e.stderr || e.stdout || e.message)` so raw tool text bubbles up.
- **`getStatus()`** parses `status -o json` but treats a nonzero exit as normal — it mirrors the array's health code, not command failure (`runStatusJson`). Throws `ArrayNotConfiguredError` on nmdctl's `{"error": ...}` blank-array shape so routes/status.ts can route into onboarding.
- **Superblock resolution**: `resolveSuperblockPath()` only trusts a live `status.array.superblock` that is an absolute path, else falls back to the hardcoded `DEFAULT_SUPERBLOCK_PATH` (`/nonraid.dat`, matching nmdctl and nonraid.service).
- **Dangerous operations** (`shrinkArray`, `reloadDriver`, `commitImportedSuperblock`, `reloadModuleAndImport`) share a stop → `modprobe -r nonraid` → `modprobe nonraid super=<path>` → import sequence. The superblock is always backed up with `mv` (never deleted), and thrown errors embed the exact manual `modprobe` recovery command.
- **`startArray()`** retries once naming whatever abnormal state nmdctl reported; `ERROR:*` states map through `ARRAY_ERROR_DESCRIPTIONS` to one-line explanations, raw text as fallback. `parityCheck` substitutes the pending action word for `CORRECT`/`NOCORRECT` when a non-check resync is pending.
- **Device scanning** (`listAvailableDevices`, `scanAllDisks`, `findDeviceByDiskId`) uses `lsblk`/`udevadm`/`blockdev` with a hard rule — a disk with any mounted partition is never offered (`findAvailablePartition`); `syntheticDiskId()` gives serial-less devices a deterministic fallback id. `scanAllDisks` additionally corrects sizes via `blockdev --getsz` rounded down to the driver's 8-sector granularity.
- **`superblock.ts`**: `parseSuperblock` reads the fixed 4096-byte native-endian binary struct directly (magic `0xb92b4efc`, 30 disk descriptors, label at word 16); `matchSlotToDisk` predicts the kernel's `same_disk_info` decision via serial-part + exact size match to power the guided import preview.

## Flow
- routes/array.ts & routes/disks.ts → `NmdClient` method → execFile nmdctl (or `/proc/nmdcmd` write) → parse/normalize → `NmdStatusResponse` / `NmdCommandResult` / `AddDiskResult` / `ImportResult`.
- `addDisk`/`replaceDisk` → `commitNewDisk`: `add -f slot:device[:id]` → start (with explicit state on refusal) → `check <pendingAction>` when `resync.pending`. `replaceDisk` first unassigns and commits (`start`) to clear the old identity — irreversible.
- Import wizard: staged superblock upload → `superblock.ts` parse+match against `scanAllDisks()` → `commitImportedSuperblock` backs up `/nonraid.dat`, moves the staged file in, and reloads the module with a fresh `import` scan.

## Integration
- Consumed by routes/array.ts, routes/disks.ts, routes/status.ts, routes/smart.ts, routes/settings.ts, routes/cache.ts, routes/parity.ts, routes/system.ts, and services: ShareService, CacheService, DiskQueueService, ActivityWatcher, ParityScheduler, BackupScheduler, MetricsSampler, plus docker/lxc storagePath migrations.
- Depends on config (`nmdBin`, `nmdTimeoutMs`, `nmdCmdPath`), system/diskType.ts (`getDiskType`), and httpError.ts.
