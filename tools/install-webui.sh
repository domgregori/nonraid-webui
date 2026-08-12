#!/usr/bin/env bash
# Sets up a fresh Debian 12/13 or Ubuntu 24.04 host to run nonraid-webui end to end: system
# package dependencies, the NonRAID kernel driver + nmdctl (via the PPA), nonraid-webui itself,
# and starts every service involved. Safe to re-run for updates afterward: apt-get install skips
# already-installed packages, the PPA/driver/mergerfs steps detect and skip what's already in
# place, this checkout's own node_modules is never touched (a staged copy in /opt is pruned
# instead), an already-customized /etc/nonraid/config.toml is never overwritten, and it always
# ends with `systemctl restart` so first-install and every later update take the same code path.
#
# Run from inside a nonraid-webui checkout, as root:
#   sudo tools/install-webui.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
INSTALL_ROOT=/opt/nonraid-webui
NODE_BIN=/usr/bin/node
MERGERFS_MIN="2.42.0"
NONRAID_PPA_KEY_ID="0x0B1768BC3340D235F3A5CB25186129DABB062BFD"
NONRAID_PPA_LIST=/etc/apt/sources.list.d/nonraid-ppa.list

log() { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "must be run as root (sudo tools/install-webui.sh)."

log "Updating package lists"
apt-get update -qq

log "Installing system dependencies"
# Everything nonraid-webui's own features shell out to at runtime — see ../REQUIREMENTS.md (this
# script runs from tools/) for the authoritative list and why each one's needed — plus `patch`,
# used only by this script
# itself (see the nmdctl blank-array status fix below). Installed up front so every feature works
# immediately after this script finishes, not just whichever ones a fresh install happens to touch
# first. apt-get install is naturally idempotent — already-installed packages are just skipped.
apt-get install -y \
  rsync openssl gpg curl patch \
  smartmontools hdparm \
  xfsprogs e2fsprogs btrfs-progs parted \
  samba nfs-kernel-server \
  apprise \
  docker.io \
  lxc lxc-templates \
  linux-headers-amd64

log "Checking mergerfs (needs $MERGERFS_MIN+ — Debian's own repo package is older and accepts an invalid High-water policy setting that crashes on the first write, see REQUIREMENTS.md)"
# Debian's repo package versions like "2.40.2-5"; the upstream release .deb versions like
# "2.42.0~debian-trixie" — the "~" sorts *before* nothing in Debian's own version ordering, so
# comparing the raw string against a bare "2.42.0" would wrongly conclude an already-correct
# install needs reinstalling every single run. Stripping everything from the first "~" onward
# before comparing (confirmed live against dpkg --compare-versions) avoids that.
mergerfs_current="$(dpkg-query -W -f='${Version}' mergerfs 2>/dev/null || true)"
mergerfs_current_bare="${mergerfs_current%%~*}"
if [ -n "$mergerfs_current" ] && dpkg --compare-versions "${mergerfs_current_bare:-0}" ge "$MERGERFS_MIN"; then
  log "mergerfs $mergerfs_current already installed and new enough"
else
  ARCH="$(dpkg --print-architecture)"
  log "Installing mergerfs from the upstream GitHub release (arch: $ARCH)"
  mergerfs_deb_url="$(curl -fsSL https://api.github.com/repos/trapexit/mergerfs/releases/latest \
    | grep -oP '"browser_download_url":\s*"\K[^"]+debian-trixie_'"$ARCH"'\.deb' | head -1)"
  [ -n "$mergerfs_deb_url" ] || fail "Could not find a mergerfs debian-trixie_$ARCH.deb in the latest GitHub release — check https://github.com/trapexit/mergerfs/releases manually."
  mergerfs_tmp="$(mktemp --suffix=.deb)"
  curl -fsSL -o "$mergerfs_tmp" "$mergerfs_deb_url"
  apt-get install -y "$mergerfs_tmp"
  rm -f "$mergerfs_tmp"
fi

log "Checking Node.js"
# Unusual floor: 20.6+ OR 21.7+ OR 22+ (not 18.x, not 21.0-21.6) — kept as the known-good version
# this app has actually been verified against, not yet re-tested against anything older.
install_node() {
  log "Installing Node.js 22.x from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
}
check_node_version() {
  local v major minor_rest minor
  v="$("$NODE_BIN" -v)"
  v="${v#v}"
  major="${v%%.*}"
  minor_rest="${v#*.}"
  minor="${minor_rest%%.*}"
  node_version="$v"
  node_ok=0
  if [ "$major" -eq 20 ] && [ "$minor" -ge 6 ]; then node_ok=1; fi
  if [ "$major" -eq 21 ] && [ "$minor" -ge 7 ]; then node_ok=1; fi
  if [ "$major" -ge 22 ]; then node_ok=1; fi
}
if [ ! -x "$NODE_BIN" ]; then
  install_node
fi
check_node_version
if [ "$node_ok" -ne 1 ]; then
  log "Node.js $node_version doesn't satisfy the version floor — reinstalling from NodeSource"
  install_node
  check_node_version
  [ "$node_ok" -eq 1 ] || fail "$NODE_BIN is still v$node_version after installing from NodeSource — need 20.6+ or 21.7+ (not 18.x, not 21.0-21.6). See ../REQUIREMENTS.md."
fi
log "Node.js v$node_version OK"

log "Checking for the NonRAID kernel driver and nmdctl"
if ! modinfo md_nonraid >/dev/null 2>&1 || ! command -v nmdctl >/dev/null 2>&1; then
  # Debian needs the repository and signing key added manually — Ubuntu's add-apt-repository
  # would also work there, but the manual method works identically on both, so it's the only path
  # this script needs (see ../nonraid/README.md's "PPA setup for Debian" for the commands this
  # mirrors exactly).
  if [ ! -f "$NONRAID_PPA_LIST" ]; then
    log "Adding the NonRAID PPA"
    wget -qO- "https://keyserver.ubuntu.com/pks/lookup?op=get&search=$NONRAID_PPA_KEY_ID" | gpg --dearmor -o /usr/share/keyrings/nonraid-ppa.gpg
    echo "deb [signed-by=/usr/share/keyrings/nonraid-ppa.gpg] https://ppa.launchpadcontent.net/qvr/nonraid/ubuntu noble main" > "$NONRAID_PPA_LIST"
    apt-get update -qq
  fi
  log "Installing the NonRAID kernel driver and nmdctl"
  apt-get install -y nonraid-dkms nonraid-tools
  # The package's own postinst already enables+starts nonraid.service (confirmed live via
  # systemctl list-unit-files) — this is just making sure it's actually running right now rather
  # than waiting for a reboot, in case this is a same-session install.
  systemctl enable --now nonraid.service
else
  log "NonRAID driver and nmdctl already present"
fi

# The PPA's nonraid-tools (1.23.0 at time of writing) lags fixes already landed in the nonraid
# repo's own tools/nmdctl. Patches the installed script directly with each one rather than waiting
# on a new PPA release. Each row is (patch file, a string only present once patched, short
# description) — add a row here for each fix that lands ahead of its PPA release, drop the row
# once that release ships and the row's own marker check starts finding nothing to do.
log "Checking for nmdctl fixes not yet in the PPA release"
NMDCTL_BIN="$(command -v nmdctl)"
NMDCTL_FIXES=(
  # status -o json/prometheus/terse printed plain colored text instead of valid output on a
  # genuinely fresh install (no array ever created), which nonraid-webui's RealNmdClient.getStatus()
  # then JSON.parse()'d and threw on — confirmed live by actually restoring a pre-install snapshot
  # and running an install end to end (the dashboard got stuck on a raw "Unexpected token" parse
  # error instead of the onboarding wizard).
  "nmdctl-status-json-on-blank-array.patch|no array is configured yet|status -o json/prometheus/terse returns valid output on a blank array"
  # import_disks()'s rescan (used by start/import) required a child partition, so a disk assigned
  # as a raw whole device (add_disk()'s own explicit-device path never partitions anything) could
  # never be automatically re-imported after a plain stop/start — confirmed live restoring an older
  # config backup onto an array built from raw disks, which left it stuck unable to start at all.
  "nmdctl-import-raw-whole-disk.patch|it may be assigned as a raw whole-disk device|import_disks() can re-import a raw whole-disk slot after a stop/start"
)
for fix in "${NMDCTL_FIXES[@]}"; do
  IFS='|' read -r patch_file marker description <<< "$fix"
  patch_path="$REPO_ROOT/tools/patches/$patch_file"
  if grep -qF "$marker" "$NMDCTL_BIN"; then
    log "nmdctl already has: $description"
  elif patch --dry-run -s -p1 "$NMDCTL_BIN" < "$patch_path" >/dev/null 2>&1; then
    patch -p1 "$NMDCTL_BIN" < "$patch_path"
    log "Patched nmdctl: $description"
  else
    log "WARNING: could not apply nmdctl fix ($description) — the installed nmdctl differs from what this patch expects. Continuing anyway."
  fi
done

log "Checking other required tools"
for tool in rsync systemctl npm; do
  command -v "$tool" >/dev/null 2>&1 || fail "'$tool' not found on PATH — required to install."
done

log "Building backend"
(cd "$BACKEND_DIR" && npm ci && npm run build)

log "Building frontend"
(cd "$REPO_ROOT" && npm ci && npm run build)

log "Staging into $INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT/backend" "$INSTALL_ROOT/frontend-dist"

rsync -a --delete "$BACKEND_DIR/dist/" "$INSTALL_ROOT/backend/dist/"
rsync -a --delete "$BACKEND_DIR/node_modules/" "$INSTALL_ROOT/backend/node_modules/"
cp "$BACKEND_DIR/package.json" "$BACKEND_DIR/package-lock.json" "$INSTALL_ROOT/backend/"
# Pruned in the staged copy only — never in $BACKEND_DIR itself, which would
# silently strip tsx/typescript out of this checkout's own working
# node_modules and break `npm run dev`/`npm run typecheck` right after.
(cd "$INSTALL_ROOT/backend" && npm prune --omit=dev)

rsync -a --delete "$REPO_ROOT/dist/" "$INSTALL_ROOT/frontend-dist/"

# This whole script runs as root (see the check at the top), so every file staged above — including
# rsync -a's ownership, preserved from $BACKEND_DIR/$REPO_ROOT's own build output — ends up
# root:root. Handing the staged tree to whoever actually ran the script (via $SUDO_USER, set by
# sudo itself) means a later update can be rsynced into place directly — confirmed live: a plain
# non-root rsync deploy after a fresh install failed with a wall of "Permission denied"/"Operation
# not permitted" errors. Skipped when run as a genuine root login with no SUDO_USER, since there's
# no more-appropriate non-root owner to hand off to in that case (the service falls back to
# running as root itself below, too, in that same case).
if [ -n "${SUDO_USER:-}" ]; then
  log "Handing $INSTALL_ROOT to $SUDO_USER (so future updates can be rsynced without sudo)"
  chown -R "$SUDO_USER:$(id -gn "$SUDO_USER")" "$INSTALL_ROOT"
  # StateDirectory=nonraid-webui (see the systemd unit) makes systemd create+chown
  # /var/lib/nonraid-webui to the service's User/Group automatically — but only the first time it's
  # created. An already-existing one (e.g. from before this script started running the service
  # non-root) is left as-is by systemd, so it needs the same explicit fix-up as $INSTALL_ROOT above
  # — confirmed live, restoring a pre-install snapshot and re-running an already-once-root install.
  [ -d /var/lib/nonraid-webui ] && chown -R "$SUDO_USER:$(id -gn "$SUDO_USER")" /var/lib/nonraid-webui
fi

log "Installing systemd unit"
install -m 644 "$REPO_ROOT/tools/systemd/nonraid-webui.service" /etc/systemd/system/nonraid-webui.service

# nonraid-webui shells out to nmdctl/docker/mount/useradd/and more as root — the base unit above
# has no User=, so with nothing else it'd run the whole Node process (and by extension, every HTTP
# request it ever handles) as root. Instead, run it as the same $SUDO_USER the deployed tree above
# now belongs to, and let it reach root only through a sudoers rule scoped to exactly the commands
# it actually needs (installed below) — so a bug or vulnerability in this backend can't act as root
# outside that narrow allowlist. A drop-in override (not editing the unit file itself) keeps the
# checked-in unit portable across whichever user ends up running the script. Skipped, same as
# above, when there's no SUDO_USER to hand off to — the service then keeps running as root, exactly
# like it always has, and none of the *_USE_SUDO env vars below take effect (config.ts's flags
# default to false, matching "this process already is root, no sudo needed").
if [ -n "${SUDO_USER:-}" ]; then
  log "Configuring nonraid-webui.service to run as $SUDO_USER instead of root"
  mkdir -p /etc/systemd/system/nonraid-webui.service.d
  {
    echo "[Service]"
    echo "User=$SUDO_USER"
    echo "Group=$(id -gn "$SUDO_USER")"
    # One per backend/src/config.ts *_use_sudo flag — see the sudoers generation right below for
    # exactly which commands each of these actually unlocks.
    for flag in NMD SMART HDPARM TLS SHARES SYSTEM USERS LXC CACHE; do
      echo "Environment=${flag}_USE_SUDO=true"
    done
  } > /etc/systemd/system/nonraid-webui.service.d/override.conf

  log "Restricting $SUDO_USER's sudo to exactly what nonraid-webui shells out to as root"
  # Every plain binary the backend can sudo to (see every *_use_sudo call site in backend/src) —
  # resolved to an absolute path here since sudoers requires one and won't fall back to a PATH
  # lookup. No argument restriction on these: each one's arguments are either inherently dynamic
  # app data (usernames, hostnames, container names, disk/device paths) that can't be pinned down
  # ahead of time, or just not dangerous enough as a bare grant to be worth the added fragility.
  # tee/modprobe/systemctl are the exception — bare, those would themselves be generic
  # arbitrary-file-write / arbitrary-kernel-module-load / arbitrary-service-control primitives, so
  # they're pinned below to the exact invocations nmd/realClient.ts, system/services.ts, and
  # routes/array.ts actually make instead of granted as plain binaries.
  SUDO_BINS=(
    nmdctl mv cp test mkfs.xfs
    smartctl
    hdparm dd
    mount umount mergerfs exportfs smbstatus smbcontrol smbd
    tar hostnamectl timedatectl journalctl
    getent useradd usermod userdel groupadd groupdel chpasswd smbpasswd
    lxc-ls lxc-info lxc-start lxc-stop lxc-destroy lxc-snapshot lxc-create
    btrfs mkfs.btrfs mkdir mountpoint lsblk blkid udevadm
    openssl
  )
  SUDOERS_TMP="$(mktemp)"
  {
    echo "# Managed by nonraid-webui's tools/install-webui.sh — re-run the script to update this"
    echo "# rather than hand-editing it. Scopes $SUDO_USER's sudo to exactly what nonraid-webui's"
    echo "# backend shells out to as root (see every *_use_sudo flag in backend/src/config.ts) and"
    echo "# nothing else."
    for bin in "${SUDO_BINS[@]}"; do
      # type -P, not command -v: `test` (and potentially others) is a shell builtin that shadows
      # the real /usr/bin binary — command -v reports the builtin (just the bare word, not a path,
      # which visudo then rejects outright), type -P forces a PATH-only lookup regardless.
      bin_path="$(type -P "$bin" 2>/dev/null || true)"
      if [ -z "$bin_path" ]; then
        echo "WARNING: '$bin' not found on PATH — skipping its sudoers entry (a feature needing it may not work as $SUDO_USER)" >&2
        continue
      fi
      echo "$SUDO_USER ALL=(root) NOPASSWD: $bin_path"
    done

    tee_path="$(type -P tee 2>/dev/null || true)"
    modprobe_path="$(type -P modprobe 2>/dev/null || true)"
    systemctl_path="$(type -P systemctl 2>/dev/null || true)"
    # nmdctl's own `unassign` has no unattended-mode bypass for its confirm prompt, so unassign
    # writes this one driver command straight to /proc/nmdcmd instead (see nmd/realClient.ts's
    # writeNmdCmd) — the only file this backend ever needs `tee` for.
    [ -n "$tee_path" ] && echo "$SUDO_USER ALL=(root) NOPASSWD: $tee_path /proc/nmdcmd"
    if [ -n "$modprobe_path" ]; then
      echo "$SUDO_USER ALL=(root) NOPASSWD: $modprobe_path -r nonraid"
      echo "$SUDO_USER ALL=(root) NOPASSWD: $modprobe_path nonraid super=*"
    fi
    if [ -n "$systemctl_path" ]; then
      # The complete, closed set from system/services.ts's SERVICE_DEFS (Docker/LXC/SMB/NFS/SSH
      # start/stop/is-active) plus routes/array.ts's driver-reload Docker stop/start.
      for args in \
        "is-active docker.service" "is-active lxc.service" \
        "is-active smbd.service nmbd.service winbind.service" \
        "is-active nfs-server.service" "is-active ssh.service" \
        "stop docker.socket docker.service" "start docker" \
        "stop lxc" "start lxc" \
        "stop smbd.service nmbd.service winbind.service" "start smbd.service nmbd.service winbind.service" \
        "stop nfs-server" "start nfs-server" \
        "stop ssh" "start ssh"; do
        echo "$SUDO_USER ALL=(root) NOPASSWD: $systemctl_path $args"
      done
    fi
  } > "$SUDOERS_TMP"

  if visudo -c -f "$SUDOERS_TMP" >/dev/null; then
    install -m 0440 -o root -g root "$SUDOERS_TMP" /etc/sudoers.d/nonraid-webui
    rm -f "$SUDOERS_TMP"
  else
    fail "Generated sudoers rules failed validation (visudo -c) — not installed, left at $SUDOERS_TMP for inspection."
  fi
fi

if [ ! -e /etc/nonraid/config.toml ]; then
  log "Installing default config (/etc/nonraid/config.toml)"
  mkdir -p /etc/nonraid
  install -m 644 "$REPO_ROOT/tools/config/nonraid-webui.toml.example" /etc/nonraid/config.toml
else
  log "/etc/nonraid/config.toml already exists — leaving it as-is"
fi

log "Starting system services"
# samba/nfs-kernel-server/docker.io's own postinst scripts already enable+start their services by
# default on Debian — this is the same "make sure, don't just assume" belt-and-suspenders as the
# nonraid.service line above, explicit rather than relying on package-manager defaults that could
# vary. mergerfs and lxc/lxc-templates have no persistent daemon of their own to start (mergerfs
# is mounted per-share on demand by nonraid-webui itself; lxc containers are started individually
# via the LXC tab, not a single system-wide service).
systemctl enable --now smbd nmbd nfs-kernel-server docker

log "Reloading systemd and (re)starting nonraid-webui"
systemctl daemon-reload
systemctl enable nonraid-webui
systemctl restart nonraid-webui

echo
systemctl status nonraid-webui --no-pager || true
echo
log "Done. Visit http://<this-host>:3001/ — first boot shows the admin account setup screen."
log "Reminder: HTTPS can be enabled from Settings -> Security once you're ready — the session cookie's Secure flag auto-flips at boot once this app's own TLS is enabled, no manual config.toml edit needed."
