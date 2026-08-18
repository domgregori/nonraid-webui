# nonraid-webui backend API

Full HTTP API reference. For an architectural overview (modules, privileges, config env vars),
see `backend/README.md`.

## Conventions

- **Base path**: every route below is mounted under `/api` (e.g. `GET /status` in this doc means
  `GET /api/status`).
- **Auth**: every route requires a valid session cookie *except* `GET /api/health` and everything
  under `/api/auth/*` (login/setup/status are necessarily reachable pre-session). A request with no
  or an invalid session gets `401`.
- **Errors**: `{ error: string }`. Status is usually `400` (bad request/validation), `404` (not
  found), `409` (conflict - name already exists, a queued operation is already running, etc.), or
  `502` (the underlying command failed - nmdctl/Docker/smartctl/mergerfs/Samba/openssl/apprise/...).
  A handful of endpoints (noted below) use `HttpError`, which carries its own specific status
  instead of always `502`.
- **Streaming (NDJSON)**: endpoints that can take a while (image pulls, container creation, storage
  migrations, bulk file operations) respond `200` immediately with
  `Content-Type: application/x-ndjson` and write one JSON object per line as the operation
  progresses: `{"type":"progress",...}` events, then a final `{"type":"done","result":...}` or
  `{"type":"error","message":...}` line. These are marked **NDJSON** below.
- **Background jobs**: a few long-running operations (Empty Disk, the Cache Mover, the disk-add
  queue) instead run detached server-side and are polled via a separate `GET .../status` route
  rather than streaming - marked **background job** below.

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/health` | - | `{ ok: true }`. No auth required - used for liveness checks. |

## Status & Array

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/status` | - | Full `nmdctl status -o json` passthrough (`NmdStatus`). `404` with `code: "ARRAY_NOT_CONFIGURED"` on a fresh install with no array ever created (not a `502`) - the frontend uses this to route into onboarding. |
| POST | `/array/start` | - | Starts the array, mounts every disk's filesystem, remounts shares. Reapplies the persisted turbo-write preference (the driver forgets it across stop/start). |
| POST | `/array/stop` | - | Unmounts every share, then every disk, then stops the array (in that order - a share's mergerfs/bind mount holds a live reference nmdctl has no idea about). |
| POST | `/array/shrink` | `{ dropSlots: number[] }` | Unmounts, drops the listed slots, remounts. |
| POST | `/array/reload-driver` | `{ stopContainers?: boolean }` | Recovery action for a stuck/error array state. `stopContainers: true` opts into stopping Docker + running LXC containers first if something has a file open on an array disk; they're restarted afterward regardless of outcome. |
| PUT | `/array/label` | `{ label: string }` | Sets/clears the array's display label. |
| POST | `/parity/:action` | `:action` = `CORRECT` \| `NOCORRECT` \| `PAUSE` \| `RESUME` \| `CANCEL` | `nmdctl check <action>`. `400` on an invalid action. |

### Array import wizard (superblock `.dat` import)

Preview-then-commit flow, same shape as the config-restore and TLS-import flows below: nothing on
disk changes until `/array/import/commit`.

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/array/import/default-path` | - | `{ path, exists }` - where nmdctl itself looks for a superblock by default. |
| GET | `/array/import/browse-root` | `?path=` | Lists real subdirectories and `.dat` files under an absolute path on the host's own root filesystem (read-only, whole-`/` scope - this is the same file the backend already trusts and reads on every status poll). |
| POST | `/array/import/preview` | multipart `file` | Parses the uploaded superblock (no side effects), matches each slot against currently-connected disks, flags a parity-too-small risk. Returns a `token` for `/commit`. |
| POST | `/array/import/preview-from-path` | `{ path }` | Same preview, sourced from a `.dat` already on the host instead of an upload. |
| POST | `/array/import/commit` | `{ token }` | Re-validates against live disk state, unmounts everything, imports the superblock. `409` if any disk has a size mismatch against it (hard-blocks, no override - this can corrupt filesystems). `400` if the preview token expired (30 min TTL) or was already used. |

## Disks

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/disks/available` | - | Unassigned devices eligible to be added, excluding anything already claimed by the cache mirror or sitting in the disk-add queue. |
| POST | `/disks/:slot/add` | `{ device, autoStart? }` | `:slot` 0-29 (0/29 = parity, 1-28 = data). `device` must currently appear in `/disks/available`. |
| POST | `/disks/:slot/replace` | `{ device }` | `409` if a queued disk operation is already running. |
| POST | `/disks/:slot/restore` | - | Restores a disk that was previously unassigned. `HttpError`: `409` if the array is running, `404` if the slot isn't a pending uncommitted unassign or the original device can't be found, `409` if its recorded identity/size doesn't match. |
| POST | `/disks/:slot/format` | `{ force? }` | Formats as XFS. `force: true` overwrites an existing filesystem. `409` if the queue is busy. |
| POST | `/disks/:slot/mount` | - | Mounts every currently-unmounted disk (nmdctl has no per-slot mount command), then reports specifically whether `:slot` ended up mounted. |
| POST | `/disks/:slot/unassign` | - | `409` if the queue is busy. `HttpError`: `409` if the array is running, `404` if no disk is assigned to the slot, `409` if unassigning would leave more missing disks than parity can cover. |
| POST | `/disks/:slot/spin-down` | - | `409` if a parity check/clear is active. |
| POST | `/disks/:slot/spin-up` | - | |
| GET | `/disks/:slot/smart` | - | SMART attributes for the disk in this slot. |
| POST | `/disks/:slot/smart/self-test` | `{ type }` — `short` \| `long` \| `conveyance` | |
| POST | `/disks/:slot/benchmark/read` | `{ durationSeconds? }` | `409` if a parity check/clear is active. Default duration if omitted. |
| POST | `/disks/:slot/benchmark/write` | `{ durationSeconds? }` | `400` if the disk isn't currently mounted. |
| POST | `/disks/benchmark/read-device` | `{ device, durationSeconds? }` | Same as the per-slot read benchmark, for an unassigned device instead. |

### Disk queue (background job)

Serializes disk-add/parity/cache-mirror operations that can't safely run concurrently.

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/disk-queue/status` | - | Current queue contents/state. |
| POST | `/disk-queue/parity` | `{ device }` | Enqueues adding `device` to the first free parity slot (0, then 29). `409` if both are taken. |
| POST | `/disk-queue/data` | `{ device }` | Enqueues adding `device` to the first free data slot (1-28). `409` if none are free. |
| POST | `/disk-queue/cache-mirror` | `{ deviceA, deviceB }` | Enqueues setting up the cache mirror from two distinct devices. |
| POST | `/disk-queue/:id/retry` | - | Retries a failed queue item. |
| DELETE | `/disk-queue/:id` | - | Removes one item. |
| POST | `/disk-queue/clear` | - | Clears the whole queue. |

### Empty Disk (background job)

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| POST | `/disks/:slot/empty/plan` | - | `:slot` 1-28. Simulates moving the slot's files onto the rest of the array; refuses to start if anything doesn't fit anywhere. |
| POST | `/disks/:slot/empty/start` | - | Starts the real move as a background job. |
| POST | `/disks/empty/cancel` | - | Cancels after finishing whatever file is currently mid-copy. |
| GET | `/disks/empty/status` | - | Poll target for progress. |

## Cache

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/cache/status` | - | |
| POST | `/cache/setup` | `{ deviceA, deviceB, force? }` | Sets up the mirrored cache pool from two devices. |
| POST | `/cache/replace` | `{ device }` | Replaces one mirror member. `409` if the disk queue is busy. |
| GET | `/cache/replace/status` | - | |
| PUT | `/cache/enabled` | `{ enabled: boolean }` | `409` if enabling before the mirror has ever been set up (no `fsUuid` yet). |
| POST | `/cache/mover/run` | - | Starts the cache mover as a background job. |
| GET | `/cache/mover/status` | - | Poll target for progress. |
| POST | `/cache/mover/cancel` | - | |

## Shares (Pools)

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/shares` | - | `ShareWithStats[]` - config plus live used/total bytes per share. |
| POST | `/shares` | `{ name, disks, allDisks, allocationMethod, protocols, smb?, nfs?, description? }` | `201` on success, `409` if the name exists. |
| PUT | `/shares/:name` | same body as POST | Renaming (body `name` ≠ `:name`) unmounts the old pool and mounts a new one. |
| DELETE | `/shares/:name` | - | Unmounts + un-exports only - never deletes files. |

## Browse

Operates over the whole `/mnt` tree (not scoped per-share) - paths are absolute strings passed as a
`path` query/body param.

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/browse` | `?path=` | Directory listing; entries under a share are annotated with which physical disk(s) they're really on. |
| GET | `/browse/suggest` | `?path=&scope=binds\|browse` | Directory-name autocomplete. `binds` scopes to Docker/Apps bind-mount roots, `browse` to the file-browser root. |
| GET | `/browse/size` | `?path=` | `{ bytes }` - on-demand recursive size (`du`), not part of `list()`. |
| GET | `/browse/download` | `?path=` | Streams the file. |
| POST | `/browse/mkdir` | `{ path, name }` | `201` on success. |
| POST | `/browse/rename` | `{ path, newName }` | |
| POST | `/browse/upload` | multipart `files`, `path` field | `201`, `{ ok, results }`. |
| POST | `/browse/bulk` | `{ paths: string[], op: 'copy'\|'move'\|'delete', destPath? }` | **NDJSON.** Applies `op` to each path in turn, one `progress` event per item. Cancel by aborting the fetch (closes the connection). |

## Docker

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/docker/containers` | - | `DockerContainerSummary[]`, each with `webUiUrl` resolved from its Community-Applications template (if installed via Apps) against its *current* port mappings. |
| GET | `/docker/containers/:id` | - | Full inspect. |
| GET | `/docker/containers/:id/logs` | `?tail=&since=` | |
| POST | `/docker/containers/:id/start` | - | |
| POST | `/docker/containers/:id/stop` | - | |
| POST | `/docker/containers/:id/restart` | - | |
| PUT | `/docker/containers/:id/autostart` | `{ autostart: boolean }` | Toggles the container's restart policy between `unless-stopped` and `no`. |
| DELETE | `/docker/containers/:id` | - | |
| GET | `/docker/devices` | - | Curated `/dev` subdirectories (GPU, audio, stable-named serial) for the device picker - also used by the Apps install dialog for `Device`-type template config entries. |
| POST | `/docker/images/prune` | - | Removes unused images. |
| POST | `/docker/containers/plan` | body = manual-create form | Validates a manual container spec and returns the resolved plan without creating anything. |
| POST | `/docker/containers` | body = manual-create form, `{ privilegedAck? }` | **NDJSON.** `400` if the plan has errors, or requires elevated access without `privilegedAck: true`. |
| PUT | `/docker/containers/:id` | same body as POST, `{ privilegedAck? }` | **NDJSON.** Containers are immutable - "editing" stops+removes the old one and creates a new one with the same labels (so a Community-Applications-installed container is still recognized afterward). |
| GET | `/docker/storage` | - | Current Docker data-root location (`boot` \| `array` \| `cache`). |
| POST | `/docker/storage` | `{ mode: 'boot'\|'array'\|'cache', diskSlot? }` | **NDJSON.** Stops Docker, migrates `/var/lib/docker`, restarts it. `diskSlot` required when `mode: 'array'`. |

## Apps (Community Applications)

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/apps` | `?search=&category=&sort=trending\|latest\|new` | `AppSummary[]` from the cached CA feed. |
| GET | `/apps/categories` | - | All categories present in the feed. |
| GET | `/apps/meta` | - | `{ appCount, lastUpdated, fetchedAt }`. |
| POST | `/apps/refresh` | - | Forces a re-fetch of the feed, bypassing the disk cache. |
| GET | `/apps/:name` | `?repository=` | Full `CaApp` template. `repository` disambiguates when more than one template shares a name. |
| POST | `/apps/:name/plan` | `{ repository?, containerName?, overrides?, privilegedAck? }` | Resolves the template + overrides into an install plan without installing anything. |
| POST | `/apps/:name/install` | same body as `/plan` | **NDJSON.** `400` (as an error event, not an HTTP status - the response has already started streaming) if the plan has errors or needs `privilegedAck`. |

## LXC

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/lxc/containers` | - | `LxcContainerSummary[]` - name, state, autostart, description, webUiUrl, cpu/mem/IPs. |
| GET | `/lxc/containers/:name` | - | Full detail - pid, rootfs path, bridge, MAC, cgroup limits. |
| GET | `/lxc/distros` | - | `{ distros, defaultArch }` - live image index, falls back to a static list. |
| GET | `/lxc/bridges` | - | Host bridge names a new container can attach to. |
| GET | `/lxc/interfaces` | - | Host physical interfaces, for macvlan networking. |
| POST | `/lxc/containers/:name/start` | - | |
| POST | `/lxc/containers/:name/stop` | `{ force? }` | `force: true` → `lxc-stop --kill` instead of a graceful timeout. |
| POST | `/lxc/containers/:name/restart` | - | |
| PUT | `/lxc/containers/:name/autostart` | `{ autostart: boolean }` | Sets `lxc.start.auto` (`1`/`0`) directly on the container's config file. |
| DELETE | `/lxc/containers/:name` | - | |
| GET | `/lxc/containers/:name/config` | - | `{ content }` - raw on-disk config file text. |
| PUT | `/lxc/containers/:name/config` | `{ content }` | Overwrites the config file verbatim. |
| GET | `/lxc/containers/:name/snapshots` | - | |
| POST | `/lxc/containers/:name/snapshots` | `{ comment? }` | |
| POST | `/lxc/containers/:name/snapshots/:snapshotName/restore` | `{ newName }` | `newName === name` restores in place; anything else restores as a new container. |
| DELETE | `/lxc/containers/:name/snapshots/:snapshotName` | - | |
| POST | `/lxc/containers` | `{ name, distribution, release, arch?, networkType, bridge, autostart, description?, webUiUrl? }` | **NDJSON.** `bridge` is validated against `/lxc/bridges` or `/lxc/interfaces` (per `networkType`) fresh, server-side. |
| GET | `/lxc/storage` | - | Current LXC container-storage location. |
| POST | `/lxc/storage` | `{ mode: 'boot'\|'array'\|'cache', diskSlot? }` | **NDJSON.** Stops containers, migrates storage, restarts them. |
| POST | `/lxc/template-cache/prune` | - | Clears cached distro rootfs downloads. |

## SMART

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/smart/temperatures` | - | `{ [device]: number \| null }` for every disk currently in the array. |
| GET | `/smart/health` | - | Pass/fail health status per array disk. |
| GET | `/smart/disk-types` | - | `{ [device]: 'ssd' \| 'hdd' }` (plain `lsblk`, no caching - unlike temperature/health, this never changes at runtime). |
| GET | `/smart/by-device` | `?device=` | Full attributes for a disk with no array slot (an unassigned device, or the boot disk). `device` must be a currently-available device or the detected boot device. |

## System

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/system` | - | `{ hostname, uptimeSeconds, cpuPercent, memUsedBytes, memTotalBytes }`. |
| GET | `/system/net-live` | - | `{ rxKbS, txKbS }` - own independent sampler from the 60s history one, polled every 3s while the History page's Live mode is open. |
| GET | `/system/timezones` | - | |
| PUT | `/system/hostname` | `{ hostname }` | |
| PUT | `/system/timezone` | `{ timezone }` | |
| POST | `/system/reboot` | - | Reboots the whole host. |
| POST | `/system/reload-driver` | - | Manual retry of the driver reload a superblock restore already attempts automatically. |
| POST | `/system/restart-services` | `{ restartDocker? }` | Restarts SMB, NFS, reloads the driver, optionally restarts Docker, then self-restarts nonraid-webui (drops the connection - the client reconnects automatically). The "make everything take effect" action after a config restore. The driver reload here only re-imports the superblock - it never mounts array disks - so if Docker's storage is on an array disk and the array isn't started, the Docker restart is skipped instead of bouncing it against an unmounted path (reported in the response as `docker: { ok: false, message }` rather than attempted). |
| POST | `/system/boot-disk/benchmark/read` | `{ durationSeconds? }` | `404` if no boot disk detected, `409` if a parity check/clear is active. |
| POST | `/system/boot-disk/benchmark/write` | `{ durationSeconds? }` | |
| GET | `/system/boot-disk/backup/image` | - | Streams a raw image of the boot disk. `404` if none detected. |
| GET | `/system/boot-disk/backup/config` | - | Streams a config-only backup archive (NonRAID config files + a metrics.db checkpoint). `400` if nothing was found to back up. |
| POST | `/system/backup/run-now` | - | Runs the same backup the schedule would, on demand, to the configured destination (Settings → Backups). |

### Config restore

Same preview-then-commit shape as the array import wizard.

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| POST | `/system/backup/restore/preview` | multipart `file` | Lists archive contents by category, flags the array superblock member and whether restoring it is currently allowed (only when the array has nothing assigned yet). Returns a `token`. |
| POST | `/system/backup/restore/commit` | `{ token, categories?: string[] }` | Re-validates fresh (array must be stopped). `categories` omitted/malformed restores everything (back-compat with pre-selection clients). Best-effort superblock reload if the superblock was restored - a reload failure is reported in the body, not a `502`, since the files are safely on disk either way. |

## Services

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/services` | - | State (`active`/`inactive`/...) of every managed systemd service, plus a synthesized `webui` row (if this endpoint answered, the backend is up). |
| POST | `/services/:id/start` | - | |
| POST | `/services/:id/stop` | - | |
| POST | `/services/:id/restart` | - | `:id = webui` is special-cased to a self-exit (relies on the unit's `Restart=on-failure`) rather than `systemctl restart`, which would be killed by systemd's own stop phase first. |

## Tailscale

Disabled by default (`settings.tailscale.enabled`) - `GET /tailscale/status` still works either
way (so the section can render its own "not installed"/"not enabled" state), but every other route
here is only meaningful once the feature's switched on.

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/tailscale/status` | - | Live status from `tailscale status --json` + `tailscale debug prefs`, merged with `featureEnabled`/`loginServer` from settings.json. `installed: false` (not an error) when the `tailscale` binary isn't on PATH. |
| PUT | `/tailscale/enabled` | `{ enabled: boolean }` | Persists the toggle and best-effort starts/stops the `tailscaled` systemd unit to match (a host that never installed the package still gets the toggle persisted, just with `installed: false` still showing). |
| POST | `/tailscale/login` | `{ loginServer?: string }` | Persists `loginServer` as the new preference regardless of outcome, then runs `tailscale up --login-server=<url>` (omitted when blank, meaning Tailscale's own server). Resolves once a login URL is captured from its output (`{ authUrl }`) or the command finishes on its own because the node was already authenticated (`{ authUrl: null }`) - never waits for the user to actually finish the browser flow, which can take minutes. |
| POST | `/tailscale/logout` | - | `tailscale logout`. |
| PUT | `/tailscale/options` | `{ hostname?, ssh?, acceptDns?, advertiseRoutes?: string[], acceptRoutes? }` | `tailscale set` with only the given fields. `advertiseRoutes` replaces the full set (`[]` clears it); advertised routes still need approving in the Tailscale/Headscale admin console before they take effect - this app can't do that part. |

## Settings

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/settings` | - | Full settings object (schedules, notifications, temp alerts, turbo write, trust-proxy, min free space, ...). |
| PUT | `/settings` | partial patch of the same shape | `turboWrite` and `trustProxy` are applied live (not just persisted) as part of the same request; `minFreeSpaceGb` triggers a share remount. Each nested section (`paritySchedule`, `backupSchedule`, `cacheSchedule`, `notifications.eventTypes`, `tempAlerts`) is validated independently. |
| GET | `/settings/notification-events` | - | Catalog of notifiable event types (id, label, default severity). |
| POST | `/settings/notifications/test` | `{ appriseUrls? }` | Sends a test notification. Uses `appriseUrls` from the body if given (so the form can be tested before saving), otherwise falls back to the persisted config. |

## Users & Groups

Managed accounts/groups only - uid/gid ≥ `USERS_UID_RANGE_START` (default `20000`).

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/users` | - | |
| POST | `/users` | `{ username, password, groups }` | `201`, `409` if the username exists. |
| PUT | `/users/:username` | `{ password?, groups? }` | Either field optional - omit to leave unchanged. |
| DELETE | `/users/:username` | - | Also purges the user from every share's access list and resyncs `smb.conf`. |
| GET | `/users/:username/access` | - | `{ shareName, permission }[]` - one entry per existing share, `'none'` where unset. |
| PUT | `/users/:username/access/:shareName` | `{ permission }` — `read-write` \| `read-only` \| `none` \| `hidden` | Resyncs `smb.conf`. |
| GET | `/groups` | - | |
| POST | `/groups` | `{ name }` | `201`, `409` if the group exists. |
| DELETE | `/groups/:name` | - | Also purges the group from every share's access list and resyncs `smb.conf`. |
| GET | `/groups/:name/access` | - | Same shape as the per-user access endpoint. |
| PUT | `/groups/:name/access/:shareName` | `{ permission }` | Same as the per-user version, applied via Samba's `@groupname` syntax. |

## TLS

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/tls/status` | - | Current cert info plus suggested CN/SANs for a new self-signed cert. |
| POST | `/tls/self-signed` | `{ commonName?, sans?, days? }` | Generates and installs a self-signed cert. |
| POST | `/tls/import/preview` | multipart `cert`, `key` | Validates the pair (parses the cert, checks the key matches, rejects an already-expired cert) without installing anything. Returns a `token`. |
| POST | `/tls/import/commit` | `{ token }` | Re-validates the staged files, then installs them. `400` if the token expired (30 min TTL) or was already used. |
| POST | `/tls/enable` | - | Persists, then self-restarts the backend with HTTPS on (drops the connection - client reconnects). |
| POST | `/tls/disable` | - | Same, with HTTPS off. Also reissues the session cookie non-Secure first, to avoid a lockout where the browser keeps withholding the old Secure cookie on the plain-HTTP redirect target. |

## Auth

Public (no session required): `status`, `setup`, `login`, `logout`, and the TOTP/passkey
*login-time verification* endpoints (gated by a short-lived pending-2FA cookie instead, issued by
`login` when a second factor is enrolled). Everything else here requires a session.

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/auth/status` | - | `{ configured, authenticated, ... }`. |
| POST | `/auth/setup` | `{ username, password }` | `201`. First-run only - creates the single admin account. |
| POST | `/auth/login` | `{ username, password }` | Rate-limited. |
| POST | `/auth/logout` | - | |
| PUT | `/auth/password` | `{ currentPassword, newPassword }` | |
| GET | `/auth/2fa/status` | - | |
| POST | `/auth/2fa/totp/verify` | `{ code }` | Login-time second factor. Rate-limited. |
| POST | `/auth/2fa/totp/enroll` | - | Starts TOTP enrollment (returns a secret/QR payload). |
| POST | `/auth/2fa/totp/confirm` | `{ code }` | Confirms enrollment. Rate-limited. |
| POST | `/auth/2fa/totp/disable` | `{ currentPassword }` | |
| POST | `/auth/2fa/backup-codes/regenerate` | `{ currentPassword }` | |
| POST | `/auth/2fa/passkey/register-options` | - | WebAuthn registration challenge. |
| POST | `/auth/2fa/passkey/register-verify` | `{ response, name }` | `response` is the browser's WebAuthn `RegistrationResponseJSON`. |
| DELETE | `/auth/2fa/passkey/:id` | - | |
| POST | `/auth/2fa/passkey/auth-options` | - | WebAuthn login challenge. |
| POST | `/auth/2fa/passkey/auth-verify` | `{ response }` | Login-time second factor. `response` is `AuthenticationResponseJSON`. |

## Activity, Logs, Metrics

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/activity` | `?limit=` | The in-app activity feed (array/disk/share/notification events this backend itself logged). |
| GET | `/logs/sources` | - | Available log source ids/labels. |
| GET | `/logs/:sourceId` | `?tail=&since=&window=` | Tails a system log source (journalctl-backed). `404` for an unknown source id. `since` (a cursor from a previous response) takes priority over `window` when both could apply. |
| GET | `/metrics` | `?metrics=cpu_percent,mem_used_bytes&range=1h\|24h\|7d\|30d` | Batched historical time series for the History page's charts - comma-separated metric names in one request. `400` for an unknown metric name or range. |
