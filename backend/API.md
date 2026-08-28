# nonraid-webui backend API

Full HTTP API reference. Config is plain environment variables, read once at startup with hardcoded
defaults when unset - see each module's own `str(...)`/`num(...)` calls in `backend/src/config.ts`
for the full list. This backend runs as root (no privilege drop, no sudoers rule) since every
external tool it shells out to (`nmdctl`, Docker, `smartctl`, `mount`/`mergerfs`, `useradd`/
`smbpasswd`, ...) needs root anyway - see the root README's Project layout section for which
backend module owns which subsystem.

## Conventions

- **Base path**: every route below is mounted under `/api` (e.g. `GET /status` in this doc means
  `GET /api/status`).
- **Auth**: every route requires a valid session cookie or `Authorization: Bearer <token>` *except*
  `GET /api/health` and everything under `/api/auth/*` (login/setup/status are necessarily reachable
  pre-session; the token-management routes are session-only, see the Auth section below). A request
  with neither gets `401`.
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
| GET | `/system/boot-disk/backup/config` | - | Streams a config-only backup archive (NonRAID config files, a metrics.db checkpoint, managed users/groups + their SMB passwords, and each LXC container's own config file - never its rootfs). `400` if nothing was found to back up. |
| GET | `/system/boot-disk/backup/config-encrypted` | - | Same archive as above, encrypted with whatever password is already saved for Local Backups (Settings → Backups' own Encryption section). `400` if no password is saved, or if nothing was found to back up. |
| POST | `/system/backup/run-now` | - | Runs the same backup the schedule would, on demand, to the configured destination (Settings → Backups). |

### Boot disk snapshots

Read-only btrfs snapshots of the boot disk - `404`/empty results when the root filesystem isn't
btrfs (`{ btrfsRoot: false }` on the list route), same "feature just isn't available here"
degradation as Tailscale/Rclone's own `installed: false`. Both the automatic ones
`tools/install-webui.sh` takes before every install/update and on-demand ones created here share
one GRUB rescue menu, kept in sync on every create/delete - there's no "reboot into this" action
from the UI (an earlier version had one; dropped after confirming live that GRUB's own one-shot
next-boot override doesn't reliably self-clear on this setup). Booting into one for real recovery
is still done manually from the physical GRUB menu. See `backend/src/system/bootSnapshots.ts`.

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/system/boot-snapshots` | - | `{ btrfsRoot: boolean, snapshots: BootSnapshot[] }` - each snapshot has `name`, `kind` (`pre-update` \| `manual`), `label`, `createdAtLocal`, `inGrubMenu`, and `size` (`{ totalBytes, exclusiveBytes }` from `btrfs filesystem du`, or `null` if that query failed). |
| POST | `/system/boot-snapshots` | `{ label? }` | Creates a read-only snapshot (`manual-<timestamp>[-label]`) and regenerates the GRUB rescue menu. `400` if root isn't btrfs. |
| DELETE | `/system/boot-snapshots/:name` | - | Deletes the snapshot subvolume and regenerates the GRUB rescue menu. `:name` must match this feature's own naming pattern. |

### Config restore

Same preview-then-commit shape as the array import wizard. Three ways to get a preview/token -
upload, an archive already sitting at the Local Backups destination, or one pulled down from a
configured Remote Backup sync job (see Rclone's own `/backups` routes below) - all feed the exact
same `/system/backup/restore/commit`, which only ever cares about the staged token, not where it
came from.

**Encryption**: Local Backups and each Remote Backup sync job can optionally password-encrypt
their own archives (`openssl enc`, AES-256/PBKDF2 - see `backend/src/system/backupCrypto.ts`).
Every archive gets a plaintext `.meta.json` sidecar written alongside it either way (same
directory locally, same remote path for rclone) recording `{ version, createdAt, scope,
categories, encrypted }` - a missing sidecar (a backup made before this feature shipped) reads as
`{ encrypted: false, categories: null }` everywhere, never an error (`backend/src/system/
backupMeta.ts`). All three preview routes below accept an optional `password` and decrypt to a
temp plaintext file *before* ever building the preview - a missing/wrong password fails with
`400` and `{ code: "PASSWORD_REQUIRED" }` in the body (see `PasswordRequiredError`/
`IncorrectPasswordError` in `backupCrypto.ts`), which the frontend keys off to show a password
field rather than a confusing "not a valid config backup" error. The raw-upload route has no
sidecar of its own to check ahead of time - it detects "needs a password" from the file's own
bytes (gzip magic vs. not) instead.

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| POST | `/system/backup/restore/preview` | multipart `file`, `password?` | Lists archive contents by category, flags the array superblock member and whether restoring it is currently allowed (only when the array has nothing assigned yet). Returns a `token`. |
| GET | `/system/backup/local/list` | - | What's already sitting at the configured Local Backups destination. `{ destDir: string \| null, backups: [{ name, sizeBytes, modifiedAt, encrypted, categories: string[] \| null }] }` - `destDir: null` covers both "nothing configured yet" and a destination picker that can't resolve without more setup (the `array` mode with no disk slot chosen); either way `backups` is `[]`, not an error. `encrypted`/`categories` come from the archive's own `.meta.json` sidecar. |
| POST | `/system/backup/local/restore/preview` | `{ name, password? }` | Same preview shape as the upload route, sourced from one of `GET /system/backup/local/list`'s own entries instead of a fresh upload. `name` must exactly match a real entry there - no arbitrary host path accepted. |
| POST | `/system/backup/restore/commit` | `{ token, categories?: string[] }` | Re-validates fresh (array must be stopped). `categories` omitted/malformed restores everything (back-compat with pre-selection clients). Best-effort superblock reload if the superblock was restored - a reload failure is reported in the body, not a `502`, since the files are safely on disk either way. When the archive's managed-users export was part of what got restored, also recreates whatever users/groups are missing on this host (`useradd -u <original uid>` + implanting the captured `/etc/shadow` hash directly, never the original plaintext) - reported as `usersRestoreResult: { usersCreated, usersSkipped, groupsCreated, groupsSkipped } | null` (`null` when that category wasn't restored) and `usersRestoreError: string | null`. |

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

## Rclone (Remote Backup)

Disabled by default (`settings.remoteBackup.enabled`) - `GET /rclone/status` still works either
way (so the section can render its own "not installed"/"not enabled" state), but every other route
here is only meaningful once the feature's switched on and `rclone-rcd` is running. This app talks
to rclone entirely through its own RC (remote control) daemon over HTTP - no local copy of remote
definitions is persisted here; remotes are rclone's own source of truth (`config/listremotes` +
`config/dump`), same "don't shadow an external source of truth" reasoning as Tailscale above. Sync
jobs (the schedule/scope/retention around a remote) are this app's own concept and are persisted
locally (`backend/src/rclone/syncJobStore.ts`).

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/rclone/status` | - | `{ installed, running, featureEnabled }`. `installed: false` (not an error) when the `rclone` binary isn't on PATH; `running` reflects whether `rclone-rcd` answered a live RC call just now. |
| PUT | `/rclone/enabled` | `{ enabled: boolean }` | Persists the toggle and best-effort starts/stops the `rclone-rcd` systemd unit to match. |
| GET | `/rclone/providers` | - | Every backend rclone supports, live from its own `config/providers` RC call. Each provider's fields are split into `options` (the standard ones, always shown) and `advancedOptions` (rclone-web's own "Show advanced" set, rolled up behind the Add-remote form's own "More options" disclosure) - both exclude genuinely deprecated fields (rclone's `Hide` bitmask, plus a help-text check for the ones `Hide` alone doesn't catch). |
| GET | `/rclone/remotes` | - | Configured remotes with live per-remote status (`ok` \| `authExpired` \| `error` \| `unknown`), from `config/listremotes` plus a `checkRemote()` probe on each. |
| POST | `/rclone/remotes` | `{ name, type, parameters }` | `config/create`. OAuth-based providers (Google Drive, Dropbox, ...) return mid-flow instead of finishing immediately (`{ done: false, state, ... }`) - the frontend then calls `.../continue` once the user's done authorizing. |
| POST | `/rclone/remotes/:name/continue` | `{ type, state, result }` | Resumes an in-progress OAuth remote setup (`config/create` called again with the saved `state`, answering its next prompt with `result`) until it reports `done: true`. |
| GET | `/rclone/remotes/:name` | - | The remote's current saved config (`config/dump`, scoped to one remote) - backs the Edit-remote form's pre-filled values. |
| PUT | `/rclone/remotes/:name` | `{ parameters }` | `config/update` - merges the given fields into the existing remote config rather than replacing it wholesale. Provider type itself isn't editable this way (delete + recreate instead). |
| DELETE | `/rclone/remotes/:name` | - | `config/delete`. Any sync job still pointing at this remote isn't deleted or blocked - it starts reporting a "remote missing" error state instead (see `GET /rclone/jobs`). |
| GET | `/rclone/jobs` | - | Every sync job plus live runtime state (`idle` \| `syncing` \| `disabled`) and, for whichever job is currently running, live progress (bytes/speed/ETA/file counts) read from rclone's own `core/stats`. Each job's `encryption` comes back redacted as `{ enabled, hasPassword }` - the real (obscured) password is never round-tripped to the client. |
| POST | `/rclone/jobs` | `{ name, scope, customPath?, remoteName, remotePath?, schedule, retention, encryption }` | `scope` is `config` \| `configAppdata` \| `custom` (`customPath` required only for `custom`). `retention` is always day-based (`{ keepDays, forever }`) regardless of scope, never a "keep last N" count - see `SyncJobRetention`'s own doc comment for why. `encryption` is `{ enabled, password? }` - `password` is plaintext, obscured via rclone's own `core/obscure` RC call before being stored (`RcloneClient.obscure()`); only meaningful for `config`/`configAppdata` scope (never offered for `custom`, a live file-by-file mirror). `400` with a specific message on any validation failure, including "Enter a password to enable encryption." when `enabled: true` resolves to no password at all. |
| PUT | `/rclone/jobs/:id` | partial patch of the same shape | Any subset of fields; `schedule`/`retention` are validated the same way as on create when present. `encryption.password` blank/omitted means "keep the current saved password" (same pattern as a remote's own password-type provider fields) - only required the first time `enabled` turns on with nothing saved yet. |
| DELETE | `/rclone/jobs/:id` | - | Deletes the job record only - never touches whatever's already been synced to the remote. |
| PUT | `/rclone/jobs/:id/enabled` | `{ enabled: boolean }` | Toggles a single job without a full edit - same precedent as the Docker/LXC autostart toggles. |
| POST | `/rclone/jobs/:id/sync` | - | Runs this job immediately, outside its schedule. Blocks until the sync finishes (and retention's been enforced) rather than returning a job handle - poll `GET /rclone/jobs` for live progress while it runs. |
| POST | `/rclone/jobs/:id/cancel` | - | Cancels whichever sync is currently in progress (at most one runs at a time). |
| GET | `/rclone/jobs/:id/backups` | - | Archives this job has already uploaded to its own remote target (`operations/list` on the job's `remoteName:remotePath`, filtered to this app's own config-backup filename pattern). Only `config`/`configAppdata` scope jobs have anything here - a `custom` scope job mirrors a folder live with no single archive to list, and `400`s instead. `[{ name, sizeBytes, modTime, encrypted, categories: string[] \| null }]` - `encrypted`/`categories` come from each archive's own `.meta.json` sidecar (downloaded and read alongside the listing) when one exists next to it remotely. |
| POST | `/rclone/jobs/:id/backups/:name/restore-preview` | `{ password? }` | Downloads that one archive into a private staging path (`operations/copyfile`) and builds the same preview/token shape as `/system/backup/restore/preview` - the Config restore section above's `/system/backup/restore/commit` is what actually restores it from there. Decrypts first when the archive's own sidecar says it's encrypted (`400` + `{ code: "PASSWORD_REQUIRED" }` on a missing/wrong password). `400` for a `custom` scope job or an unrecognized `name`. |
| POST | `/rclone/browse-backups` | `{ remoteName, remotePath? }` | Same listing as `GET /rclone/jobs/:id/backups`, but at an arbitrary remote+path with no sync job behind it - what onboarding's disaster-recovery restore uses, since a from-scratch install has no jobs configured yet to browse via. Same response shape. |
| POST | `/rclone/browse-backups/restore-preview` | `{ remoteName, remotePath?, name, password? }` | Same download/decrypt/preview as `POST /rclone/jobs/:id/backups/:name/restore-preview`, at an arbitrary remote+path instead of a job's own fixed target. Same response shape and `PASSWORD_REQUIRED` handling. |

## Settings

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/settings` | - | Full settings object (schedules, notifications, temp alerts, turbo write, trust-proxy, min free space, ...). `backupSchedule.encryption` comes back redacted as `{ enabled, hasPassword }` - the real (obscured) password is never round-tripped to the client. |
| PUT | `/settings` | partial patch of the same shape | `turboWrite` and `trustProxy` are applied live (not just persisted) as part of the same request; `minFreeSpaceGb` triggers a share remount. Each nested section (`paritySchedule`, `backupSchedule`, `cacheSchedule`, `notifications.eventTypes`, `tempAlerts`) is validated independently. `backupSchedule.encryption` is `{ enabled, password? }` - same obscure-and-store, blank-means-keep-current handling as a Remote Backup sync job's own `encryption` (see Rclone's `POST /rclone/jobs` above). |
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

**API tokens**: every non-auth route in this API also accepts `Authorization: Bearer <token>` as an
alternative to a session cookie (see `requireAuth`/`AuthService.isAuthenticated`) - this is what the
`nonraid` CLI uses. Tokens are minted/listed/revoked below; creation requires a real session plus
step-up re-auth, while revocation only needs a session (removing access is strictly safety-positive,
and a token can never mint or revoke itself or another token, avoiding any bootstrapping problem).
The raw token is returned exactly once, at creation time, and never stored or shown again - only a
salted hash of it persists server-side.

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
| POST | `/auth/tokens` | `{ name, currentPassword, totpCode? }` | Step-up gated (same class of risk as adding an SSH key) - `totpCode` required only if TOTP is enrolled. `201`, `{ id, name, createdAt, token }` - `token` (`nrd_...`) is shown once and never retrievable again. |
| GET | `/auth/tokens` | - | `{ id, name, createdAt, lastUsedAt }[]` - never the hash or raw token. |
| DELETE | `/auth/tokens/:id` | - | Session-gated only (not step-up) - revokes one token immediately. |

## Activity, Logs, Metrics

| Method | Path | Body/Params | Response / Notes |
|---|---|---|---|
| GET | `/activity` | `?limit=` | The in-app activity feed (array/disk/share/notification events this backend itself logged). |
| GET | `/logs/sources` | - | Available log source ids/labels. |
| GET | `/logs/:sourceId` | `?tail=&since=&window=` | Tails a system log source (journalctl-backed). `404` for an unknown source id. `since` (a cursor from a previous response) takes priority over `window` when both could apply. |
| GET | `/metrics` | `?metrics=cpu_percent,mem_used_bytes&range=1h\|24h\|7d\|30d` | Batched historical time series for the History page's charts - comma-separated metric names in one request. `400` for an unknown metric name or range. |
