z# Production Requirements — NonRAID and nonraid-webui

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
- `smartmontools` (`smartctl`) — used by the webui for disk temperature.
- `hdparm` — used by the Disks page's spin-down/spin-up actions
  (`backend/src/system/hdparm.ts`). Not installed by default; without it, the backend's own error
  is clear rather than a crash, same graceful-failure treatment as `apprise`/`smartmontools`
  above.
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
  self-signed certificates and inspect imported ones. Near-universally present on Debian already;
  called explicitly rather than assumed, same as every other shelled-out tool in this list.
- `docker.io` — Docker Engine, for the Docker tab. `nonraid-webui` talks to `/var/run/docker.sock`
  directly (`dockerode`); no separate install step exists for this anywhere else, so it must be
  installed explicitly.
- `lxc` and `lxc-templates` — for the LXC tab (`nonraid-webui` shells out to the classic
  `lxc-*` tools: `lxc-ls`, `lxc-info`, `lxc-start`, `lxc-stop`, `lxc-destroy`, `lxc-create`,
  `lxc-snapshot`).
  `lxc-templates` provides the `download` template used by "Add Container". Same as Docker: no
  install step exists elsewhere, must be installed explicitly.
- **Node.js, version 20.6 or newer, or 21.7 or newer.** Not 18.x. This app no longer uses `.env`
  files (config is env vars / TOML now, see `tools/config/nonraid-webui.toml.example`) so this
  floor is no longer strictly required by anything specific — kept as the known-good version this
  app has actually been verified against, not yet re-tested against anything older.
- `npm`.

## Build output

**Built.** `tools/install-webui.sh` builds both halves (`npm ci` + `tsc` for the backend, `npm ci`
+ `vite build` for the frontend) and stages them into `/opt/nonraid-webui`. The backend serves the
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