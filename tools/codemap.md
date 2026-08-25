# tools/

## Responsibility
Deployment, build, and operations tooling that turns the source tree into a running NAS appliance. The centerpiece is the single-file installer that provisions the whole host and stages both app halves into `/opt/nonraid-webui`.

## Design
- `install-webui.sh` (675 lines) is the sole install/update path for Debian 12/13 and Ubuntu 24.04. It is step-based (`--step NAME`, `NAME+`, `--list-steps`) with a canonical `STEPS` order, plus update shortcuts (`update_backend`/`update_frontend`/`update_driver`/`update_script`), so an update re-runs only the stages that changed.
- Idempotent and safe to re-run: never overwrites an existing `/etc/nonraid/config.toml` or `/etc/default/nonraid-webui`; always ends with `systemctl restart nonraid-webui` so first-install and update share one path.
- Every run is logged to `/var/log/nonraid-webui/`.
- Owns the full third-party dependency surface: apt packages (smartmontools, hdparm, xfs/btrfs tools, docker.io, lxc + lxc-templates, samba + nfs, apprise, avahi, dkms/build deps), mergerfs ≥2.42 from upstream `.deb`, Tailscale (installed then disabled), rclone (installed then disabled, with `rclone-rcd` credentials written to `/etc/default/rclone-rcd`), and Node 22.x.
- Builds the NonRAID kernel driver via DKMS (always rebuilds), installs `nmdctl` + NonRAID systemd units, builds both app halves (`npm ci` + `tsc` / `vite build`), and stages output (prunes dev deps).
- Provisions the `user:users` (99:100) data-ownership account, configures nfsd thread count, and starts/enables smbd/nmbd/nfs/docker/avahi.

## Flow
`install-webui.sh` → apt/dependency install → DKMS kernel-driver build → `nmdctl` + systemd units → backend `npm ci`+`tsc` → frontend `npm ci`+`vite build` → stage to `/opt/nonraid-webui` → write config/units → provision data account → start services → restart `nonraid-webui`.

## Integration
- Produces the runtime layout consumed by `tools/systemd/nonraid-webui.service` (code at `/opt`, state at `/var/lib/nonraid-webui`).
- Installs the files under `tools/config/` (`config.toml`, `smb.conf`, `avahi-samba.service`) and `tools/systemd/`.
- Relies on the sibling `nonraid` repo's `nmdctl` and DKMS source. Not a runtime dependency of the backend itself — it only sets the stage the backend assumes.
