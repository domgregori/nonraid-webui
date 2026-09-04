# Production Requirements — NonRAID and nonraid-webui

This is a list of items needed to run NonRAID and nonraid-webui in production, on one VM under
Proxmox VE. Update this list as items change or new items appear.

## Repositories

- `nonraid-webui` — this repository. Dashboard frontend and backend.
- `nonraid` — Kernel driver (`md_nonraid`, `nonraid6_pq`)
  and the `nmdctl` command-line tool.

## Host

- Debian 13 Trixie

## Kernel driver

- Kernel headers meta-package, matching the guest kernel, so DKMS can rebuild the driver after kernel update.
- DKMS.
- `md_nonraid` and `nonraid6_pq`, built and installed with DKMS, from `dkms.conf` and the source
  from nonraid repo.

## Software

- `nmdctl` — from `../nonraid`'s `tools/nmdctl`.
- `blkid`, `parted` or `sgdisk`.
- Filesystem tools: `xfsprogs`, `e2fsprogs`, `btrfs-progs` (as needed for the filesystems used).
- `acl` (`setfacl`) — used by the Shares and Cache features to set a recursive default ACL on each
  share's and the cache pool's mount point, so files created under them later inherit the right
  ownership without a per-file chown.
- `smartmontools` (`smartctl`) — used by the webui for disk temperature.
- `fd-find` (binary name `fdfind`, not `fd` — a Debian packaging naming conflict with an unrelated
  package) — used by the Browse page's search feature for a fast, parallel recursive filename
  search.
- `hdparm` — used by the Disks page's manual spin-down/spin-up actions
  (`backend/src/system/hdparm.ts`).
- `hd-idle` — used by the *automatic* idle-timeout spin-down (`backend/src/system/hdIdle.ts`),
  deliberately not hdparm's own ATA standby timer - see that file's own doc comment for why (this
  app's background SMART polling would otherwise keep resetting a drive's own hardware idle
  countdown before it ever reached standby). Only ever touches real HDDs, never an SSD.
- `mergerfs`, version **2.42.0 or newer**. Older versions (such as 2.33.5) accept an invalid
  "High-water" policy setting and crash on the first write. Debian 13's repo package is only
  2.40.2 — install from the upstream GitHub release instead (a `debian-trixie_amd64.deb` asset
  is published per release).
- `samba` and `nfs-kernel-server` — used by the Shares feature.
- `apprise` — used by the Notifications feature (Settings → Notifications → Send test notification,
  and every automatic event notification). Available as a Debian package (`apt install apprise`);
  not installed by default. Without it, the backend's own error is clear ("apprise" isn't installed
  or isn't on PATH), but notifications silently never send until it's installed.
- `rsync` — required by `tools/install-webui.sh` itself (stages build output into
  `/opt/nonraid-webui`); not installed by default on a minimal Debian 13 install.
- `openssl` — used by the webui's built-in TLS feature (Settings → Security → HTTPS) to generate
  self-signed certificates and inspect imported ones, and by the optional per-job password
  encryption on Local Backups / Remote Backup sync jobs (`openssl enc`, AES-256/PBKDF2 — see
  `backend/src/system/backupCrypto.ts`). Near-universally present on Debian already; called
  explicitly rather than assumed, same as every other shelled-out tool in this list.
- `avahi-daemon` - used for network discovery.
- `tailscale` — for the optional Tailscale settings section (Settings → Tailscale), disabled by
  default. Not in Debian's own repos; `tools/install-webui.sh`'s `ensure_tailscale()` adds
  Tailscale's own apt repo first, then installs it and immediately disables+stops `tailscaled`
  (its postinst enables it by default, same as docker.io/samba/nfs-kernel-server - undone here
  since this feature must start off). The webui's own enable toggle (`PUT /tailscale/enabled`)
  starts it back up when someone actually turns the feature on.
- `rclone` — for the optional Remote Backup settings section (Settings → Backups), disabled by
  default. Debian 13's repo package is stale (1.60.1); `tools/install-webui.sh`'s `ensure_rclone()`
  installs from rclone's own official installer instead, then generates a random password for
  `rclone-rcd` (its own remote-control daemon this feature talks to over HTTP — see
  `backend/src/rclone/realClient.ts`). `install_rclone_systemd_unit()` installs `rclone-rcd`'s own
  systemd unit and immediately disables+stops it, same as `tailscaled` above. The webui's own
  enable toggle (`PUT /rclone/enabled`) starts it back up when someone actually turns Remote Backup
  on.
- `docker.io` — Docker Engine, for the Docker tab. `nonraid-webui` talks to `/var/run/docker.sock`
  directly (`dockerode`); no separate install step exists for this anywhere else, so it must be
  installed explicitly.
- `lxc` and `lxc-templates` — for the LXC tab (`nonraid-webui` shells out to the classic
  `lxc-*` tools: `lxc-ls`, `lxc-info`, `lxc-start`, `lxc-stop`, `lxc-destroy`, `lxc-create`,
  `lxc-snapshot`).
  `lxc-templates` provides the `download` template used by "Add Container". Same as Docker: no
  install step exists elsewhere, must be installed explicitly.
- **Node.js, version 20.6 or newer, or 21.7 or newer.** Not 18.x. This app no longer uses `.env`
  files (config is plain environment variables, see `backend/src/config.ts`) so this floor is no
  longer strictly required by anything specific — kept as the known-good version this app has
  actually been verified against, not yet re-tested against anything older.
- `npm`.

## Build output

**Built.** `tools/install-webui.sh` builds both halves (`npm ci` + `tsc` for the backend, `npm ci`

- `vite build` for the frontend) and stages them into `/opt/nonraid-webui`. The backend serves the
  frontend's built files itself (`SERVE_FRONTEND=true`, same origin/port) — no separate reverse
  proxy needed; TLS also terminates natively in this same process (see Security below), so a
  reverse proxy in front is optional, not required.

## Process management

**Built.** `tools/systemd/nonraid-webui.service` + `.default`, installed by `install-webui.sh`,
mirroring nonraid's own `tools/systemd/nonraid.service` pattern. Persistent state lives at
`/var/lib/nonraid-webui` (unit's `WorkingDirectory`/`StateDirectory`), kept separate from the
`/opt` code tree so re-running the install script for an update never touches it. Safe to re-run:
preserves an already-customized `/etc/default/nonraid-webui`, always ends with `systemctl
restart` so first-install and updates take the same path.
