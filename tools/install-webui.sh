#!/usr/bin/env bash
# Sets up a fresh Debian 12/13 or Ubuntu 24.04 host to run nonraid-webui end to end: system
# package dependencies, the NonRAID kernel driver + nmdctl (built from source, see
# NONRAID_REPO_URL below), nonraid-webui itself, and starts every service involved. Safe to
# re-run for updates afterward: apt-get install skips already-installed packages, the driver step
# always re-pulls and rebuilds from the latest commit on that repo's main branch (a personal fork
# with fixes landing ahead of any version bump — see its own comment below for why this can't
# just skip-if-already-built like mergerfs/Node below do), this checkout's own node_modules is
# never touched (a staged copy in /opt is pruned instead), an already-customized
# /etc/nonraid/config.toml is never overwritten, and it always ends with `systemctl restart` so
# first-install and every later update take the same code path.
#
# Run from inside a nonraid-webui checkout, as root:
#   sudo tools/install-webui.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
INSTALL_ROOT=/opt/nonraid-webui
NODE_BIN=/usr/bin/node
MERGERFS_MIN="2.42.0"
NONRAID_REPO_URL="https://github.com/domgregori/nonraid.git"
NONRAID_SRC_DIR=/usr/src/nonraid
NONRAID_WEBUI_USER=nonraid

log() { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "must be run as root (sudo tools/install-webui.sh)."

log "Checking for the $NONRAID_WEBUI_USER system user"
# Owns $INSTALL_ROOT and runs nonraid-webui.service (see the override further down) — a fixed,
# dedicated account rather than whoever happens to invoke sudo, so this script produces the same
# result regardless of which admin account runs it, and re-running it later doesn't depend on
# still being logged in as the same person who ran it the first time.
if ! id "$NONRAID_WEBUI_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$NONRAID_WEBUI_USER"
fi

log "Updating package lists"
apt-get update -qq

log "Installing system dependencies"
# Everything nonraid-webui's own features shell out to at runtime — see ../REQUIREMENTS.md (this
# script runs from tools/) for the authoritative list and why each one's needed — plus git/dkms/
# build-essential, needed only by this script itself to build the NonRAID kernel driver from
# source below (linux-headers-amd64 further down this same list is the other half of that: DKMS
# needs matching headers for whatever kernel is actually running). Installed up front so every
# feature works immediately after this script finishes, not just whichever ones a fresh install
# happens to touch first. apt-get install is naturally idempotent — already-installed packages
# are just skipped.
apt-get install -y \
  rsync openssl gpg dkms build-essential \
  smartmontools hdparm \
  xfsprogs btrfs-progs parted \
  apprise \
  docker.io \
  lxc lxc-templates \
  linux-headers-amd64

# Separate --no-install-recommends call for the packages whose recommends are pure bloat for this
# app's headless, scripted use rather than something it (or a human at the console) actually
# benefits from: samba's own samba-ad-dc is a full Active Directory domain controller (Kerberos,
# LDAP, a DNS server) that this app has no use for at all — it only does plain file sharing via
# smb.conf — plus python3-samba (net-command admin tooling this app never shells out to, it uses
# smbd/nmbd/smbpasswd directly). e2fsprogs-l10n is pure localization data. curl's bash-completion
# and git's less/ssh-client/patch are interactive-shell/SSH-remote conveniences this script's own
# scripted HTTPS clone and non-interactive `git log`/`git diff` calls never need — patch
# specifically is what got removed as a dependency entirely when this script switched to building
# from source, so silently pulling it back in as an unused transitive recommend would undo that.
# Kept as its own call rather than a global --no-install-recommends flag on the install above,
# since several packages there (docker.io, lxc, lxc-templates) genuinely need theirs — lxc's
# recommends in particular (debootstrap, lxcfs, libpam-cgfs, uidmap) are load-bearing for container
# creation actually working, not bloat.
apt-get install -y --no-install-recommends \
  curl git e2fsprogs \
  samba nfs-kernel-server

# docker.sock is root:docker mode 660 (created by the docker.io package just installed above) —
# dockerode (backend/src/docker/realClient.ts) connects to it directly, no sudo wrapper exists for
# Docker the way there is for nmdctl/smartctl/etc (see SUDO_BINS further down), so the service user
# needs real group membership, not just a sudoers rule. usermod -aG is idempotent, safe to re-run
# even when already a member.
usermod -aG docker "$NONRAID_WEBUI_USER"

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

log "Fetching NonRAID from $NONRAID_REPO_URL (main branch)"
if [ -d "$NONRAID_SRC_DIR/.git" ]; then
  git -C "$NONRAID_SRC_DIR" fetch origin main
  git -C "$NONRAID_SRC_DIR" reset --hard origin/main
else
  rm -rf "$NONRAID_SRC_DIR"
  git clone --branch main "$NONRAID_REPO_URL" "$NONRAID_SRC_DIR"
fi

NONRAID_VERSION="$(grep '^PACKAGE_VERSION=' "$NONRAID_SRC_DIR/dkms.conf" | cut -d= -f2)"
KVERSION="$(uname -r)"
[ -n "$NONRAID_VERSION" ] || fail "Could not read PACKAGE_VERSION from $NONRAID_SRC_DIR/dkms.conf"

log "Building and installing the NonRAID kernel module via DKMS ($NONRAID_VERSION for $KVERSION)"
# Always rebuilds from whatever was just pulled, rather than skipping when dkms already has this
# exact module+version+kernel combination installed (the pattern mergerfs/Node above use): this is
# a personal fork under active iteration, and a real fix landing here won't reliably come with a
# PACKAGE_VERSION bump every time — skip-if-present would silently keep running stale, already-
# superseded driver code after a `git pull`-only update. dkms remove is a no-op (the `|| true`)
# the first time this ever runs, when nothing is registered yet.
DKMS_SRC_DIR="/usr/src/nonraid-dkms-$NONRAID_VERSION"
dkms remove "nonraid-dkms/$NONRAID_VERSION" -k "$KVERSION" >/dev/null 2>&1 || true
rm -rf "$DKMS_SRC_DIR"
mkdir -p "$DKMS_SRC_DIR"
cp -r "$NONRAID_SRC_DIR/md_nonraid" "$NONRAID_SRC_DIR/raid6" "$NONRAID_SRC_DIR/dkms.conf" "$NONRAID_SRC_DIR/Makefile" "$DKMS_SRC_DIR/"
dkms install "nonraid-dkms/$NONRAID_VERSION" -k "$KVERSION"

log "Installing nmdctl and the NonRAID systemd units"
install -m 755 "$NONRAID_SRC_DIR/tools/nmdctl" /usr/local/bin/nmdctl
install -m 644 "$NONRAID_SRC_DIR/tools/systemd/nonraid.service" /etc/systemd/system/nonraid.service
install -m 644 "$NONRAID_SRC_DIR/tools/systemd/nonraid-notify.service" /etc/systemd/system/nonraid-notify.service
install -m 644 "$NONRAID_SRC_DIR/tools/systemd/nonraid-notify.timer" /etc/systemd/system/nonraid-notify.timer
install -m 644 "$NONRAID_SRC_DIR/tools/systemd/nonraid-parity-check.service" /etc/systemd/system/nonraid-parity-check.service
install -m 644 "$NONRAID_SRC_DIR/tools/systemd/nonraid-parity-check.timer" /etc/systemd/system/nonraid-parity-check.timer
if [ ! -e /etc/default/nonraid ]; then
  install -m 644 "$NONRAID_SRC_DIR/tools/systemd/nonraid.default" /etc/default/nonraid
else
  log "/etc/default/nonraid already exists — leaving it as-is"
fi
systemctl daemon-reload
# Making sure it's actually running right now rather than waiting for a reboot, in case this is a
# same-session install/rebuild. The notify/parity-check timers are opt-in schedules, not something
# every install necessarily wants running immediately — enabled (survive a reboot) but not started.
systemctl enable --now nonraid.service
systemctl enable nonraid-notify.timer nonraid-parity-check.timer

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
# root:root. Handing the staged tree to $NONRAID_WEBUI_USER means a later update can be rsynced
# into place directly — confirmed live: a plain non-root rsync deploy after a fresh install failed
# with a wall of "Permission denied"/"Operation not permitted" errors.
log "Handing $INSTALL_ROOT to $NONRAID_WEBUI_USER (so future updates can be rsynced without sudo)"
chown -R "$NONRAID_WEBUI_USER:$(id -gn "$NONRAID_WEBUI_USER")" "$INSTALL_ROOT"
# StateDirectory=nonraid-webui (see the systemd unit) makes systemd create+chown
# /var/lib/nonraid-webui to the service's User/Group automatically — but only the first time it's
# created. An already-existing one (e.g. from before this script started running the service
# non-root) is left as-is by systemd, so it needs the same explicit fix-up as $INSTALL_ROOT above
# — confirmed live, restoring a pre-install snapshot and re-running an already-once-root install.
[ -d /var/lib/nonraid-webui ] && chown -R "$NONRAID_WEBUI_USER:$(id -gn "$NONRAID_WEBUI_USER")" /var/lib/nonraid-webui

log "Installing systemd unit"
install -m 644 "$REPO_ROOT/tools/systemd/nonraid-webui.service" /etc/systemd/system/nonraid-webui.service

# nonraid-webui shells out to nmdctl/docker/mount/useradd/and more as root — the base unit above
# has no User=, so with nothing else it'd run the whole Node process (and by extension, every HTTP
# request it ever handles) as root. Instead, run it as $NONRAID_WEBUI_USER, the same account the
# deployed tree above now belongs to, and let it reach root only through a sudoers rule scoped to
# exactly the commands it actually needs (installed below) — so a bug or vulnerability in this
# backend can't act as root outside that narrow allowlist. A drop-in override (not editing the
# unit file itself) keeps the checked-in unit portable.
log "Configuring nonraid-webui.service to run as $NONRAID_WEBUI_USER instead of root"
mkdir -p /etc/systemd/system/nonraid-webui.service.d
{
  echo "[Service]"
  echo "User=$NONRAID_WEBUI_USER"
  echo "Group=$(id -gn "$NONRAID_WEBUI_USER")"
  # One per backend/src/config.ts *_use_sudo flag — see the sudoers generation right below for
  # exactly which commands each of these actually unlocks.
  for flag in NMD SMART HDPARM TLS SHARES SYSTEM USERS LXC CACHE; do
    echo "Environment=${flag}_USE_SUDO=true"
  done
} > /etc/systemd/system/nonraid-webui.service.d/override.conf

log "Restricting $NONRAID_WEBUI_USER's sudo to exactly what nonraid-webui shells out to as root"
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
  echo "# rather than hand-editing it. Scopes $NONRAID_WEBUI_USER's sudo to exactly what"
  echo "# nonraid-webui's backend shells out to as root (see every *_use_sudo flag in"
  echo "# backend/src/config.ts) and nothing else."
  for bin in "${SUDO_BINS[@]}"; do
    # type -P, not command -v: `test` (and potentially others) is a shell builtin that shadows
    # the real /usr/bin binary — command -v reports the builtin (just the bare word, not a path,
    # which visudo then rejects outright), type -P forces a PATH-only lookup regardless.
    bin_path="$(type -P "$bin" 2>/dev/null || true)"
    if [ -z "$bin_path" ]; then
      echo "WARNING: '$bin' not found on PATH — skipping its sudoers entry (a feature needing it may not work as $NONRAID_WEBUI_USER)" >&2
      continue
    fi
    echo "$NONRAID_WEBUI_USER ALL=(root) NOPASSWD: $bin_path"
  done

  tee_path="$(type -P tee 2>/dev/null || true)"
  modprobe_path="$(type -P modprobe 2>/dev/null || true)"
  systemctl_path="$(type -P systemctl 2>/dev/null || true)"
  # nmdctl's own `unassign` has no unattended-mode bypass for its confirm prompt, so unassign
  # writes this one driver command straight to /proc/nmdcmd instead (see nmd/realClient.ts's
  # writeNmdCmd) — the only file this backend ever needs `tee` for.
  [ -n "$tee_path" ] && echo "$NONRAID_WEBUI_USER ALL=(root) NOPASSWD: $tee_path /proc/nmdcmd"
  if [ -n "$modprobe_path" ]; then
    echo "$NONRAID_WEBUI_USER ALL=(root) NOPASSWD: $modprobe_path -r nonraid"
    echo "$NONRAID_WEBUI_USER ALL=(root) NOPASSWD: $modprobe_path nonraid super=*"
  fi
  if [ -n "$systemctl_path" ]; then
    # The complete, closed set from system/services.ts's SERVICE_DEFS (Docker/LXC/SMB/NFS/SSH
    # start/stop/is-active), routes/array.ts's driver-reload Docker stop/start, and
    # routes/system.ts's Settings -> About reboot action.
    for args in \
      "is-active docker.service" "is-active lxc.service" \
      "is-active smbd.service nmbd.service winbind.service" \
      "is-active nfs-server.service" "is-active ssh.service" \
      "stop docker.socket docker.service" "start docker" \
      "stop lxc" "start lxc" \
      "stop smbd.service nmbd.service winbind.service" "start smbd.service nmbd.service winbind.service" \
      "stop nfs-server" "start nfs-server" \
      "stop ssh" "start ssh" \
      "reboot"; do
      echo "$NONRAID_WEBUI_USER ALL=(root) NOPASSWD: $systemctl_path $args"
    done
  fi
} > "$SUDOERS_TMP"

if visudo -c -f "$SUDOERS_TMP" >/dev/null; then
  install -m 0440 -o root -g root "$SUDOERS_TMP" /etc/sudoers.d/nonraid-webui
  rm -f "$SUDOERS_TMP"
else
  fail "Generated sudoers rules failed validation (visudo -c) — not installed, left at $SUDOERS_TMP for inspection."
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
