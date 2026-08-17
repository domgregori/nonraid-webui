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
ARRAY_DATA_GROUP=users
ARRAY_DATA_GID=100
ARRAY_DATA_USER=user
ARRAY_DATA_UID=99
LOG_DIR=/var/log/nonraid-webui
LOG_FILE="$LOG_DIR/install-$(date +%Y%m%d-%H%M%S).log"

log() { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "must be run as root (sudo tools/install-webui.sh)."

# Every run's full output (this script's own `log`/`fail` lines plus every command it invokes)
# is captured to $LOG_FILE, not just whatever's still visible in the terminal — useful after the
# fact for a failed run, or one kicked off non-interactively. Still prints to stdout/stderr as
# before via tee, so nothing about running it interactively changes.
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
log "Logging this run to $LOG_FILE"

log "Checking for the $ARRAY_DATA_USER:$ARRAY_DATA_GROUP ($ARRAY_DATA_UID:$ARRAY_DATA_GID) account"
# nonraid-webui itself runs as root (see nonraid-webui.service — no User= override), the same way
# Unraid's own single-appliance design works, so there's no separate service account to provision
# here. What still needs a fixed identity is array/pool/cache data ownership: this app chowns and
# sets a default ACL for $ARRAY_DATA_USER:$ARRAY_DATA_GROUP on that data (see
# shares/applier/realApplier.ts's provisionArrayDir() and cache/mount.ts's mountCache()) — the
# classic Unraid/linuxserver.io nobody:users (99:100) convention most Community-Apps containers
# already default their own PUID/PGID to. Named "user" rather than "nobody" since Debian's own
# nobody account is a fixed uid 65534, not 99 — that name's already taken.
if ! getent group "$ARRAY_DATA_GROUP" >/dev/null 2>&1; then
  groupadd -g "$ARRAY_DATA_GID" "$ARRAY_DATA_GROUP"
else
  existing_gid="$(getent group "$ARRAY_DATA_GROUP" | cut -d: -f3)"
  [ "$existing_gid" = "$ARRAY_DATA_GID" ] || fail "group '$ARRAY_DATA_GROUP' already exists with gid $existing_gid, not the expected $ARRAY_DATA_GID."
fi
if ! id "$ARRAY_DATA_USER" >/dev/null 2>&1; then
  useradd -u "$ARRAY_DATA_UID" -g "$ARRAY_DATA_GID" -M -s /usr/sbin/nologin "$ARRAY_DATA_USER"
else
  existing_uid="$(id -u "$ARRAY_DATA_USER")"
  [ "$existing_uid" = "$ARRAY_DATA_UID" ] || fail "user '$ARRAY_DATA_USER' already exists with uid $existing_uid, not the expected $ARRAY_DATA_UID."
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
  xfsprogs btrfs-progs parted acl \
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

log "Installing systemd unit"
install -m 644 "$REPO_ROOT/tools/systemd/nonraid-webui.service" /etc/systemd/system/nonraid-webui.service

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
