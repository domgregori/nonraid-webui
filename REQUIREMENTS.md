# Production Requirements — NonRAID and nonraid-webui

This is a list of items needed to run NonRAID and nonraid-webui in production, on one VM under
Proxmox VE. Update this list as items change or new items appear.

## Repositories

- `nonraid-webui` — this repository. Dashboard frontend and backend.
- `nonraid` — separate repository, at `../nonraid`. Kernel driver (`md_nonraid`, `nonraid6_pq`)
  and the `nmdctl` command-line tool.

## Host

- Proxmox VE host.
- CPU with IOMMU support: VT-d (Intel) or AMD-Vi (AMD). Must be enabled in the host BIOS.
- Disk controller (HBA) in its own IOMMU group, separate from unrelated devices.
- A separate boot disk for the Proxmox host, on a different controller than the one passed
  through to the VM.

## VM / guest kernel

- Guest kernel version listed in `../nonraid`'s README, section "Kernel support matrix". Ubuntu
  24.04 LTS and Debian 12/13 have the most testing.
- Kernel headers meta-package, matching the guest kernel, so DKMS can rebuild the driver after a
  kernel update.
- `serial=` value set on each array-disk entry in the VM config, for stable
  `/dev/disk/by-id/virtio-<serial>` links inside the guest.

## Kernel driver

- DKMS.
- `md_nonraid` and `nonraid6_pq`, built and installed with DKMS, from `dkms.conf` and the source
  in `../nonraid`.

## Software inside the VM

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
mirroring `../nonraid`'s own `tools/systemd/nonraid.service` pattern. Persistent state lives at
`/var/lib/nonraid-webui` (unit's `WorkingDirectory`/`StateDirectory`), kept separate from the
`/opt` code tree so re-running the install script for an update never touches it. Safe to re-run:
preserves an already-customized `/etc/default/nonraid-webui`, always ends with `systemctl
restart` so first-install and updates take the same path.

## Security

- Authentication layer for the webui backend API. **Built.** Single admin account, first-run
  setup screen, signed session cookie rather than a server-side session store — see the doc
  comments in `backend/src/auth/`. Still not yet built: everything else in this section.
- TLS (HTTPS) for the webui backend and frontend. **Built** (self-signed path). Settings →
  Security → HTTPS: generate a self-signed certificate (openssl, no external CA), then
  enable/disable — see `backend/src/tls/`. The session cookie's `Secure` flag (`COOKIE_SECURE`)
  auto-flips to `true` at boot once this app's own TLS is enabled, so this no longer needs a
  manual step for the default deployment shape. Importing an existing cert+key pair (a real
  CA-issued cert, or one from an external ACME client) is a planned follow-up, not yet built.
- Firewall rules, to control what is reachable from the LAN.
- A decision on backend user/permissions: root, or a limited user with `sudo` rules per
  subsystem (`nmdctl`, Docker, SMART, Shares) — see `tools/install-webui.sh`'s `$SUDO_USER`
  handoff and generated `/etc/sudoers.d/nonraid-webui` for the built default. Note:
  mergerfs-pooled (multi-disk) shares are mounted with `-o allow_other`, needed or FUSE denies
  every non-root process (Samba included) regardless of the underlying directory's own
  permissions. That's unconditionally safe when the backend mounts as root; a limited-user
  backend additionally needs `user_allow_other` set in `/etc/fuse.conf`, or every multi-disk
  share silently breaks again.

## Backup

- Backup or snapshot of the VM's own disk (root/boot disk), separate from the array disks.
- Backup plan for the Shares configuration file and the managed sections of `smb.conf` and
  `/etc/exports`, since parity protection does not cover this configuration data.

## Known gaps (not required to deploy, relevant to scope)

- WebSocket or server-sent events for live status: not built yet, webui uses polling.
