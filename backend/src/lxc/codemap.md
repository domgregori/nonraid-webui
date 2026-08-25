# backend/src/lxc/

## Responsibility
LXC container management: list/inspect/start/stop/restart/destroy, create from the download template, raw config editing, autostart toggle, snapshots, bridge/physical-NIC enumeration, live distro index, per-container CPU/mem/IP stats, and lxcpath relocation. Shells out to the classic `lxc-*` tools (`lxc-ls`, `lxc-info`, `lxc-create`, `lxc-stop`, `lxc-snapshot`, `lxc-destroy`) with `-P config.lxcDefaultPath` on every call.

## Design
- **Interface + impl + factory**: `LxcClient` (client.ts) → `RealLxcClient` (realClient.ts) created via `createLxcClient()`; a private `LxcStatsPoller` provides stats. All calls are argv arrays; a raw `ENOENT` is rewritten to "lxc-utils isn't installed".
- **Config-file-as-database** (`configFile.ts`): line-based `key = value` get/set over the container's real `config` file. Real `lxc.*` directives and this app's own comment-prefixed metadata (`#container_description`, `#container_webui`, `#container_distribution`) share one mechanism; `parseVariable`/`applyVariable` are exported pure for unit testing, `atomicWrite` is temp-file-then-rename, and newline-bearing values are rejected (directive-injection guard).
- **`createContainer`**: `lxc-create --bdev=overlayfs --template download -- --dist/--release/--arch` streamed via `spawn` (watchdog SIGKILL at `lxcCreateTimeoutMs`), then writes network (veth on a bridge, or macvlan riding a physical NIC), a random locally-administered MAC, autostart, and metadata, then starts the container.
- **`listDistros`**: fetches the live index via `lxc-create -n __nonraid_lxc_distro_probe -t download -- --list` against an isolated scratch `-P` dir (avoids a race where listContainers would see the probe mid-flight); keeps only default-variant `amd64` entries. `distros.ts` supplies `DEFAULT_ARCH`, `FALLBACK_DISTROS` (used only when the live fetch fails), and cosmetic `labelFor()` names.
- **`LxcStatsPoller`** (statsPoller.ts): unref'd interval worker (config.lxcStatsIntervalMs) — CPU% from `/proc/<pid>/stat` utime+stime deltas, memory from `/proc/<pid>/status` VmRSS, IPs via `lxc-info -i`; serves cached `LxcStatSample`, prunes stopped containers.
- **Snapshots**: `lxc-snapshot -L -C` output parsed header/comment pairing; create writes the comment to a scratch temp file (`-c` takes a file); restore always requires an explicit `newName`. Delete translates LXC's "has snapshots on its rootfs" into a clear "a container restored from it still exists" error.
- **storagePath.ts**: `resolveLxcPath` (boot/array/cache → fixed subfolder) and `migrateLxcStorage` mirror the Docker side, plus `rewriteRootfsPaths` (rsync does not update the overlay `lxc.rootfs.path` baked into each container's config). Switches `config.lxcDefaultPath` live (read fresh by every call) and persists to settingsStore. Single system-wide `withLock`.
- **templateCache.ts**: `pruneTemplateCache` clears `/var/cache/lxc/download` — always safe because lxc-create extracts a full independent rootfs copy per container.

## Flow
- routes/lxc.ts → `LxcClient` → `lxc-*` subprocess → normalized types.
- List: `lxc-ls --fancy NAME,STATE` → per-container `readMetadata` (config file) + statsPoller sample.
- Create: `listDistros` → form → `createContainer` (template lines streamed as progress) → config write → start.
- Edit: `getConfigText`/`setConfigText` expose the raw on-disk config; `setContainerAutostart` is a single-field write to `lxc.start.auto`.

## Integration
- Consumed by routes/lxc.ts, routes/array.ts (via system/arrayLifecycle.ts's container stop/start helpers), `DiskQueueService`, and routes/settings.ts (storage relocation).
- Depends on config (`lxcDefaultPath`, timeout family, `lxcStatsIntervalMs`), system/procUtil.ts, cache/service.ts, settings types (`StorageLocation`), and nmd (`getStatus` for array-disk validation during migration).
