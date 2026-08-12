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
# Everything nonraid-webui's own features shell out to at runtime — see ../nonraid/REQUIREMENTS.md
# for the authoritative list and why each one's needed. Installed up front so every feature works
# immediately after this script finishes, not just whichever ones a fresh install happens to touch
# first. apt-get install is naturally idempotent — already-installed packages are just skipped.
apt-get install -y \
  rsync openssl gpg curl \
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
  [ "$node_ok" -eq 1 ] || fail "$NODE_BIN is still v$node_version after installing from NodeSource — need 20.6+ or 21.7+ (not 18.x, not 21.0-21.6). See ../nonraid/REQUIREMENTS.md."
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
