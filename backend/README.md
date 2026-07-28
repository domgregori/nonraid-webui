# nonraid-webui backend

Express API for the frontend, wrapping `nmdctl` (the nonraid CLI), the Docker Engine API, `smartctl`
(disk temperature), and mergerfs/Samba/NFS (shares). Those four follow the same pattern — a small
interface with a **real** implementation and an in-memory **mock** implementation. `real` is always
the default. **The backend never picks mock data by itself** — mock runs only when a person sets the
mode to `mock` by hand (`NMD_MODE`, `DOCKER_MODE`, `SMART_MODE`, `SHARES_MODE`). In `real` mode, if
the real tool is missing, calls fail with a clear error instead of a silent switch to mock data.
`src/system/` (host CPU/memory) is the one exception to the real/mock split — see its own section for
why.

## nmdctl (`src/nmd/`)

Two `NmdClient` implementations (`src/nmd/client.ts`):

- **`RealNmdClient`** — shells out to the real `nmdctl` binary via `execFile` (never a shell string,
  so there's no command-injection surface) and parses its `-o json` output.
- **`MockNmdClient`** — an in-memory simulated array, for developing/demoing on machines without the
  nonraid kernel module loaded (like this one). Ticks parity-check progress on a 1s interval, same
  shape as the real thing. Its data disks come from `discoverRealDataDisks()`
  (`src/nmd/discoverRealDisks.ts`), which reads `/proc/mounts` + `statfs` for real mounts at
  `/mnt/disk1..28` — inside `backend/testing/`'s container, this makes the mock array report the
  *actual* loopback disks (real size, real filesystem, real usage), not disconnected fictional
  numbers. Falls back to fictional TB-scale disks only when nothing's really mounted there (e.g. a
  plain dev machine with no test container running).

`createNmdClient()` (`src/nmd/index.ts`) picks one based on `NMD_MODE`: `real` (default) always uses
`RealNmdClient`; `mock` must be set by hand to use `MockNmdClient`.

All response types in `src/nmd/types.ts` are transcribed directly from `format_json_output()` in the
main nonraid repo's `tools/nmdctl` — not guessed. If that function changes, update these types to
match.

## Docker (`src/docker/`)

Two `DockerClient` implementations (`src/docker/client.ts`), same real/mock pattern via `DOCKER_MODE`
and `createDockerClient()` (`src/docker/index.ts`):

- **`RealDockerClient`** — uses `dockerode` against `/var/run/docker.sock`. CPU% is computed with
  Docker's own delta formula (`(cpuDelta/systemDelta) * onlineCpus * 100`) from two stats samples —
  the raw `stats` payload doesn't include a ready-made percentage. Stats are only fetched for running
  containers.
- **`MockDockerClient`** — the same four fake containers the frontend mock originally used
  (jellyfin/nextcloud/mergerfs-mover/qbittorrent), with real start/stop/restart state transitions.

Unlike `nmd/types.ts`, `docker/types.ts` is **not** a passthrough of the raw Docker Engine API (that
payload is large and stats need the CPU% derivation above) — both clients normalize to
`DockerContainerSummary`.

## SMART / disk temperature (`src/smart/`)

nmdctl's status JSON has **no temperature field at all** — that's SMART data, not something the array
driver tracks. This is the piece that closes that gap.

- **`RealSmartClient`** — runs `smartctl -n standby --json -a <device>` per disk. `-n standby` means a
  sleeping disk is *not* woken up just to read its temperature (real hardware concern — waking spun-down
  drives on every status poll would defeat the point of spin-down). Temperature extraction tries, in
  order: the normalized `temperature.current` field (smartmontools ≥7.0, all device types), then
  `nvme_smart_health_information_log.temperature` (older NVMe), then the ATA SMART attribute table
  (`Temperature_Celsius`/`Airflow_Temperature_Cel`). smartctl's exit code is a bitmask of conditions
  (asleep, checks failed, etc) that's often nonzero even when stdout has perfectly valid JSON, so we
  parse stdout regardless of exit status rather than treating nonzero as failure.
- **`MockSmartClient`** — the same baseline temps the frontend originally mocked per disk slot, with
  small random jitter so it reads as a live sensor.
- **`SmartService`** (not a `SmartClient` itself — wraps one) — caches temperatures per device with a
  configurable TTL (default 60s) and serves stale-while-revalidate: cached values return immediately,
  a background refresh kicks off once stale, and only a cold (never-read) device blocks the response.
  This exists because shelling out to `smartctl` for every disk on every poll would be real added
  latency multiplied by disk count — status polling and SMART polling intentionally run on different
  cadences.

`GET /api/smart/temperatures` takes no params — it calls the active `NmdClient.getStatus()` internally
to get the current disk device list, so it always reflects whatever's actually in the array.

**Verified against real hardware, partially**: this dev machine's NVMe drive returns "Permission
denied" without root (expected — smartctl needs privilege same as nmdctl/Docker), which exercises and
confirms the nonzero-exit-but-valid-JSON parsing path. The temperature-field extraction itself is
built from the documented smartmontools JSON schema, not verified against a live temperature reading
on this machine. Worth double-checking against `sudo smartctl -n standby --json -a <device>` on first
real deployment.

## Shares (`src/shares/`)

Unlike the three above, there's no existing system to query for "shares" — nmdctl doesn't have the
concept. The backend owns `shares.json` (path via `SHARES_CONFIG_PATH`, default `backend/data/`) as
the source of truth and reconciles it onto three real subsystems:

- **Pooling** — one `mergerfs` mount per share at `/mnt/user/<name>` (not one global pool — each share
  can include a different disk subset), branches at `<disk-mountpoint>/<name>` on each included disk.
  A single-disk share skips mergerfs entirely and uses a plain bind mount. Allocation method maps to
  mergerfs's `category.create` policy: `most-free`→`mfs`, `fill-up`→`ff`. `high-water` has no exact
  mergerfs equivalent (that's Unraid's own term) — mapped to `msp` as the closest approximation, not a
  faithful reproduction.
- **SMB** — a managed block in `smb.conf` (`SMB_CONF_PATH`), fully regenerated from the complete
  current share list on every change, then `smbcontrol smbd reload-config` (falls back to starting
  `smbd` if it wasn't running). Only ever touches the block between
  `# === nonraid-webui:managed-shares:begin/end ===` markers — never the rest of the file — and keeps
  a `.bak` before every rewrite.
- **NFS** — same managed-block approach for `/etc/exports` (`EXPORTS_PATH`), then `exportfs -ra`
  (best-effort — see `testing/README.md` on why NFS-in-Docker is unreliable; this is not a limitation
  of the approach itself, just of testing it in a container).
- **Stats** — `df -k --output=used,size` on the pooled mountpoint once it exists, rather than summing
  member disks ourselves (handles overlapping disks across shares correctly for free).

`RealShareApplier`/`MockShareApplier` behind the same `ShareApplier` interface, same real/mock pattern
via `SHARES_MODE`. `ShareService` ties the store + applier
+ live disk mountpoints (from `NmdClient.getStatus()`) together — create/update/delete all mount (or
remount, idempotently) before persisting to `shares.json`, and deleting a share only unmounts +
un-exports it, never touches the underlying files.

**Verified for real** (not just unit-level) against `testing/`'s Docker environment: created a
3-disk share, confirmed the actual `mergerfs` mount, wrote files to two different underlying disks and
confirmed they appear merged in one directory listing, confirmed `df` on the pool reports correctly
aggregated size, confirmed the share is listed by a real `smbclient -L`, renamed it (old mount
unmounted, new one created, `smb.conf`/`exports` correctly regenerated with only the new name), and
deleted it (unmounted, un-exported, files still present on the underlying disks). Also confirmed the
error path: creating a share referencing disks that are all offline fails with a clear 409 rather than
a cryptic mount error.

Known gap found during testing, not yet fixed: SMB guest access hits `NT_STATUS_ACCESS_DENIED` when
actually listing files inside a share (the share itself is correctly created/listed/exported) — a
Samba guest-account/permissions detail to sort out, not a failure of the create/mount/config pipeline.

## Users (`src/users/`)

SMB/NFS share users — real Linux/Samba accounts, not a webui login system (there still isn't one; see
"Privileges" below). Unlike Shares, there's no JSON store for *which users/groups exist* — the host's
`/etc/passwd`/`/etc/group` (read via `getent`, which also picks up NSS sources like LDAP if
configured) are the source of truth, same reasoning as why `nmd`/`docker`/`smart` query the live
system instead of caching. Only accounts with uid/gid ≥ `USERS_UID_RANGE_START` (default `20000`) are
considered "managed" — listed, editable, deletable — so this can never see or touch real host system
accounts.

- **Create** — `useradd -u <uid> -M -s <USERS_SHELL_PATH>` (no home dir, login shell disabled — these
  are share-access accounts, not shell accounts), then sets both the Unix password (`chpasswd`) and the
  Samba password (`smbpasswd -a -s`) so the two stay in sync. Passwords are only ever sent over stdin
  to these commands, never as argv (argv is visible to any other process on the host via `ps`).
- **Groups** — real `groupadd`/`usermod -aG`/`usermod -G`, same uid/gid-range managed-only rule.
  `UsersService` rejects any group in a create/update request that isn't already a managed
  (app-created) group before it ever reaches `usermod` — group names pass shape validation alone,
  which isn't a privilege check, so without this a request could name a real pre-existing system group
  (`docker`, `sudo`, ...) and get a managed user added to it, which is privilege escalation (`docker`
  group membership is root-equivalent). Updating a user's group list only ever replaces membership in
  *managed* groups — any other secondary group the account happens to have (unlikely, but possible via
  NSS) is preserved.
- **Delete** — `smbpasswd -x` (best-effort — fine if the account predates Samba being set up) then
  `userdel`, then purges every reference to that user from the share-access list below and resyncs
  `smb.conf`.
- **Per-share access** (`src/shares/aclStore.ts`, `data/share-access.json`) — the one piece that *is* a
  JSON store, for the same reason `shares.json` is: no external system holds "which permission level
  does user X have on share Y" as data — `smb.conf` is generated *from* it, not the other way around.
  Four levels: `read-write`, `read-only`, `none`, `hidden` — `none` is stored explicitly (never just
  "no entry"), since on a public share an absent entry means the share's normal guest-open default,
  which is not the same thing as an explicit deny. Realized in `smb.conf` as `read list` (read-only
  exceptions to an otherwise-writable share, so guest/public shares keep working exactly as before this
  feature existed), `valid users` (only added for non-public shares, so it can't fight with `guest ok`),
  and `invalid users` (explicit denial, works regardless of guest ok — also used to deny *everyone* via
  the `*` wildcard on a private share that has zero explicit grants yet, since Samba's own default
  there — any account that can authenticate at all — is not an acceptable default). SMB only — plain
  NFS exports are host-based, not user-based, so per-user NFS permissions are out of scope.
- **`hidden` is an approximation, not a faithful per-user hide.** Samba's `access based share enum`
  (ABE) is share-wide, not per-user — there's no native way to make a share invisible to one specific
  denied user while staying visible to another. `hidden` is realized as: turn on ABE for the share
  whenever *anyone* has `hidden` set. Side effect: this also hides the share from any `none` principals
  on that same share, which isn't a faithful "denied but still browseable" vs. "denied and invisible"
  distinction — flagged here rather than silently shipped as if it were exact, same spirit as the
  `high-water`→`mspmfs` approximation in Shares above.
- Group membership changes don't need a `smb.conf` resync — Samba resolves `@groupname` membership live
  from the OS at connection time, so only actual access-list changes (`ShareService.resyncExports()`)
  trigger a rewrite.

`RealUsersClient`/`MockUsersClient` behind the same `UsersClient` interface, same real/mock pattern via
`USERS_MODE`.

**Not yet verified against a real environment** — `RealUsersClient`'s `useradd`/`usermod`/`smbpasswd`
calls have been reviewed carefully, including a security pass that caught and fixed two real issues
(see the Groups bullet's privilege-escalation note and the Per-share access bullet's deny-by-default
note above), but not exercised live: the Docker container this would have run in wasn't available in
the sandbox this was built in, and has since been removed project-wide in favor of VM-based testing
(see root README). Verify with `USERS_MODE=real` on a VM, same as Shares, before relying on it.

## System stats (`src/system/`)

Host CPU% and memory for the Dashboard's System card + header. **No real/mock split** here, unlike
everything else — Node's built-in `os` module always works, needs no external binary/daemon, and no
privilege, so there's nothing to fail to detect. `SystemStatsService` samples `os.cpus()` on a
background interval (default 2s, `SYSTEM_STATS_INTERVAL_MS`) and computes CPU% from the delta between
consecutive samples — a single snapshot is just cumulative counters since boot, not instantaneous
usage, same idea as Docker's CPU% calculation. Memory doesn't need that (`os.totalmem()`/`freemem()`
are already instantaneous).

**Caveat**: `os.cpus()`/`totalmem()`/`freemem()` are container-oblivious — inside a container (like
`testing/`'s) they report the **host's** stats, not the container's own cgroup limits. Correct for the
real deployment target (running directly on the NAS host); confusing if you go looking for
container-scoped numbers while testing. Verified live: hostname/uptime/CPU/memory all confirmed
reflecting the actual dev machine, and CPU% confirmed changing between successive polls (28% → 17% a
few seconds apart), proving the background sampler is real, not a static value.

## Running

```bash
npm install
npm run dev        # tsx watch, reads .env if present (see .env.example)
```

```bash
cp .env.example .env   # optional, defaults work out of the box in mock mode
```

## API

| Method | Path                | Body/Params                                          | Notes |
|--------|---------------------|-------------------------------------------------------|-------|
| GET    | `/api/health`        | —                                                       | `{ ok, nmdMode, dockerMode, smartMode, sharesMode, usersMode }` — check which clients are active |
| GET    | `/api/status`         | —                                                       | Full `nmdctl status -o json` passthrough |
| POST   | `/api/array/start`     | —                                                       | `nmdctl start` |
| POST   | `/api/array/stop`       | —                                                       | `nmdctl stop`. Mock client rejects with 502 if a parity check is active, matching real driver behavior. |
| POST   | `/api/parity/:action`    | `:action` = `CORRECT` \| `NOCORRECT` \| `PAUSE` \| `RESUME` \| `CANCEL` | `nmdctl check <action>` |
| GET    | `/api/docker/containers`        | —                                                       | List all containers (running + stopped), normalized `DockerContainerSummary[]` |
| POST   | `/api/docker/containers/:id/start`  | —                                                   | |
| POST   | `/api/docker/containers/:id/stop`    | —                                                   | |
| POST   | `/api/docker/containers/:id/restart`  | —                                                   | |
| GET    | `/api/smart/temperatures`        | —                                                       | `{ [device]: number \| null }` for every disk currently in the array |
| GET    | `/api/shares`             | —                                                               | `ShareWithStats[]` — config + live used/total bytes |
| POST   | `/api/shares`              | `{ name, disks, allocationMethod, protocols, smb?, nfs? }`         | 201 on success, 409 if the name exists |
| PUT    | `/api/shares/:name`          | same body as POST                                                    | Renaming (body `name` ≠ `:name`) unmounts the old pool and mounts a new one |
| DELETE | `/api/shares/:name`            | —                                                                       | Unmounts + un-exports only — never deletes files |
| GET    | `/api/system`             | —                                                               | `{ hostname, uptimeSeconds, cpuPercent, memUsedBytes, memTotalBytes }` |
| GET    | `/api/users`               | —                                                               | `User[]` — managed accounts (uid ≥ `USERS_UID_RANGE_START`) |
| POST   | `/api/users`                | `{ username, password, groups }`                                     | 201 on success, 409 if the username exists |
| PUT    | `/api/users/:username`        | `{ password?, groups? }`                                            | Either field optional — omit to leave unchanged |
| DELETE | `/api/users/:username`          | —                                                                       | Also purges the user from every share's access list and resyncs `smb.conf` |
| GET    | `/api/users/:username/access`    | —                                                                       | `{ shareName, permission }[]` — one entry per existing share, `'none'` where unset |
| PUT    | `/api/users/:username/access/:shareName` | `{ permission }` — one of `read-write` \| `read-only` \| `none` \| `hidden` | Resyncs `smb.conf` |
| GET    | `/api/groups`               | —                                                               | `Group[]` — managed groups (gid ≥ `USERS_UID_RANGE_START`) |
| POST   | `/api/groups`                | `{ name }`                                                            | 201 on success, 409 if the group exists |
| DELETE | `/api/groups/:name`            | —                                                                       | Also purges the group from every share's access list and resyncs `smb.conf` |
| GET    | `/api/groups/:name/access`       | —                                                                       | Same shape as the per-user access endpoint |
| PUT    | `/api/groups/:name/access/:shareName`  | `{ permission }`                                                | Same as the per-user version, applied via Samba's `@groupname` syntax |

Errors are `{ error: string }` with status 400 (bad request — e.g. invalid parity action, or a share
name/disks/allocation method that fails validation), 404 (share/user/group not found), 409 (name
already exists, or none of a share's disks are currently mounted), or 502 (the underlying command
itself failed — nmdctl/Docker/smartctl/mergerfs/Samba/useradd family).

## Config (env vars, see `.env.example`)

- `PORT` (default `3001`)
- `CORS_ORIGIN` (default `http://localhost:5183`, the frontend's Vite dev server)
- `NMD_MODE` — `real` (default) | `mock`
- `NMD_BIN` — path/name of the nmdctl binary (default `nmdctl`)
- `NMD_SUPERBLOCK` — optional, passed as `-s <path>` to every nmdctl call
- `NMD_USE_SUDO` — `true` if this process doesn't run as root itself and instead needs
  `sudo nmdctl ...` via a sudoers rule (see below)
- `NMD_TIMEOUT_MS` — kill nmdctl subprocess after this long (default `15000`)
- `DOCKER_MODE` — `real` (default) | `mock` (dockerode reads the standard `DOCKER_HOST`/socket env
  vars itself if you need a non-default connection)
- `SMART_MODE` — `real` (default) | `mock`
- `SMARTCTL_BIN` — path/name of the smartctl binary (default `smartctl`)
- `SMART_USE_SUDO` — same idea as `NMD_USE_SUDO`, for a sudoers rule scoped to smartctl
- `SMART_TIMEOUT_MS` — kill smartctl subprocess after this long (default `10000`)
- `SMART_CACHE_TTL_MS` — how long a cached temperature is served before a background refresh
  (default `60000`)
- `SHARES_MODE` — `real` (default) | `mock`
- `SHARES_CONFIG_PATH` — where `shares.json` lives (default `backend/data/shares.json`)
- `SHARE_MOUNT_ROOT` — pooled mount root (default `/mnt/user`)
- `SMB_CONF_PATH` / `EXPORTS_PATH` — config files to write the managed block into (defaults
  `/etc/samba/smb.conf` / `/etc/exports`)
- `SHARES_USE_SUDO` — same idea as `NMD_USE_SUDO`, for a sudoers rule scoped to mount/mergerfs/umount
- `SHARE_ACCESS_CONFIG_PATH` — where `share-access.json` lives (default `backend/data/share-access.json`)
- `SYSTEM_STATS_INTERVAL_MS` — background CPU-sampling interval (default `2000`)
- `USERS_MODE` — `real` (default) | `mock`
- `USERS_USE_SUDO` — same idea as `NMD_USE_SUDO`, for a sudoers rule scoped to the useradd/smbpasswd
  family
- `USERS_UID_RANGE_START` — uid/gid floor for managed accounts/groups (default `20000`)
- `USERS_SHELL_PATH` — login shell assigned to created accounts (default `/usr/sbin/nologin`)
- `USERS_TIMEOUT_MS` — kill useradd/smbpasswd/etc. subprocess after this long (default `15000`)

## Privileges

`nmdctl` needs root for anything beyond `status`. For now this backend assumes it's either run as
root directly, or granted a narrowly-scoped sudoers rule, e.g.:

```
webui ALL=(root) NOPASSWD: /usr/local/sbin/nmdctl
```

with `NMD_USE_SUDO=true`.

Docker access needs the process to run as root, or as a user in the `docker` group. Note that group
membership is effectively root-equivalent (container mounts make privilege escalation trivial) — same
severity as the nmdctl sudoers rule above.

`smartctl` also needs root (or a sudoers rule, same pattern as nmdctl's `NMD_USE_SUDO`).

Shares needs root for `mount`/`mergerfs`/`umount` and to write `smb.conf`/`/etc/exports` — same
sudoers pattern via `SHARES_USE_SUDO`. This is the most consequential of the four: it's not just
running privileged commands, it's rewriting system service config and mounting/unmounting real
filesystems. The managed-block + backup approach limits blast radius on the config-file side; the
mount side has no equivalent safety net beyond the offline-disk check.

Users needs root for `useradd`/`usermod`/`userdel`/`groupadd`/`groupdel`/`chpasswd`/`smbpasswd` — same
sudoers pattern via `USERS_USE_SUDO`. This is consequential in the same way Shares is: it's creating
and deleting real host accounts, not just config. The uid/gid-range restriction (`USERS_UID_RANGE_START`)
is the safety net here — every operation refuses to touch anything below it, so it can't be pointed at
real system/service accounts even by a buggy caller.

**There is no auth layer on this API yet** — anyone who can reach it can start/stop the array, run
parity checks, start/stop/restart any container, read disk identifiers/serials, create/rename/delete
shares (which mounts/unmounts filesystems and exports them over the network), and now also create,
delete, and set passwords for real system accounts. Fine for a trusted LAN during development; needs an
auth layer before this is ever exposed beyond that — this feature makes that gap more urgent, not less,
since it now manages credentials, not just infrastructure.

## Not yet done

- Disk add/replace/unassign (interactive wizards in nmdctl — need a non-interactive path, see
  `docs/manual-management.md` in the main nonraid repo)
- `nmdctl set` (turbo write, etc.)
- WebSocket/SSE push for status instead of frontend polling
- Docker: image pull/list, "Add Container" (currently a design-only button), container logs
- SMART: only temperature is read today; SMART pass/fail health, reallocated sectors, etc. aren't
  surfaced
- Shares: the guest-access permission issue noted above, no validation that a share name doesn't
  collide with an existing directory some other way
- Users: no rename (delete + recreate only — `useradd`/`usermod` renaming is more disruptive to
  double-check than it's worth for a first version), no quotas, no API tokens, no 2FA — none of these
  were in scope for the first version (see root README for what was deliberately deferred and why)
- Auth
