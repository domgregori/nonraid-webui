# backend/src/docker/

## Responsibility
Docker container management: list/inspect/start/stop/restart/remove/destroy, create from a validated plan with pull progress, logs live-tail, image prune, network listing, and data-root relocation. Talks to the daemon through dockerode (Engine HTTP/socket API), not the `docker` CLI.

## Design
- **Interface + impl + factory**: `DockerClient` (client.ts) → `RealDockerClient` (realClient.ts) wrapping `new Docker()`, created via `createDockerClient()`.
- **Normalized shapes** (types.ts), not raw Engine API passthrough: CPU% derived from stats deltas (`computeCpuPercent`), memory minus page-cache (`computeMemUsed`), ports formatted, and `autostart` read off a real per-container `inspect()` RestartPolicy (list API only exposes NetworkMode).
- **`guard()`** rewrites daemon-unreachable socket errors (ENOENT/ECONNREFUSED/EACCES) into a human "is Docker installed and running?" message.
- **`createContainer`**: `ensureImagePulled` first (dockerode does not auto-pull — aggregates per-layer pull bytes into one percentage via `followProgress`), then create + start; a failed start force-removes the container so the name is freed.
- **Logs**: TTY containers are raw text, non-TTY output is 8-byte-framed and `demuxLogBuffer`-parsed; `timestamps: true` plus the last line's timestamp yields the `nextSince` live-tail cursor.
- **planning.ts**: `isAllowedBindPath` (path-resolve containment plus a realpath walk-up to the nearest existing ancestor, same pattern as browse/paths.ts), `isAllowedDevicePath` (`/dev/` prefix only), `sanitizeContainerName`, `computeElevatedAccessReasons` (privileged / host-networking / device passthrough each demand an explicit ack).
- **manualPlan.ts**: `buildManualPlan` validates the Add/Edit dialog request into a `ManualContainerPlan` — the same checks as Apps' `resolvePlan` minus CA Config-schema resolution.
- **devices.ts**: curated passthrough-device offer list (only `/dev/dri`, `/dev/snd`, `/dev/serial/by-id` subdirs — USB renumbers and is excluded); `stat()` follows symlinks.
- **storagePath.ts**: `resolveDockerPath` (boot/array/cache → fixed subfolder, mirroring the LXC side); `getCurrentDockerStorage` via the live daemon, `getConfiguredDockerStorage` from `/etc/docker/daemon.json` (exported as `DAEMON_JSON_PATH`). `migrateDockerStorage` stops docker.socket+docker.service, rsyncs the old root, rewrites `data-root`, restarts, and polls `docker info` to verify; a single system-wide `withLock` serializes moves.

## Flow
- routes/docker.ts → `DockerClient` method → dockerode → Engine API.
- Create/edit: request → `buildManualPlan` (errors + `elevatedAccessReasons` + per-bind/device `allowed` flags) → `createContainer(options, onProgress)` → progress events streamed to the frontend.
- Logs: the dialog's poll loop passes `since: nextSince` each iteration; `since` supersedes `tail`.

## Integration
- Consumed by routes/docker.ts, routes/apps.ts (via `AppsService`), routes/cache.ts; `DockerClient` is also injected into AppsService and used by docker/storagePath.ts migrations (with `NmdClient` + `CacheService` deps).
- config: `appsBindRoots` is the bind-mount allow-list shared with the Apps flow and passed into `dockerRouter`. docker/storagePath.ts exports `DAEMON_JSON_PATH`, which backupCatalog.ts includes in config backups.
- Depends on system/procUtil.ts (`runSudoMaybe`), cache/service.ts, and settings types (`StorageLocation`).
