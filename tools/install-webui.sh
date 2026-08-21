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
#
# To re-run just one part instead of the whole thing (e.g. iterating on the backend build without
# re-running apt/mergerfs/the driver build each time), pass one or more --step flags:
#   sudo tools/install-webui.sh --step build_backend --step stage_install
# A trailing "+" on a step name means "this step and everything after it", for resuming a run
# that got through the slow early steps already:
#   sudo tools/install-webui.sh --step build_backend+
#   sudo tools/install-webui.sh --list-steps   # see available step names

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
NFSD_THREADS=32
LOG_DIR=/var/log/nonraid-webui
LOG_FILE="$LOG_DIR/install-$(date +%Y%m%d-%H%M%S).log"

log() { echo "==> $*"; }
fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" = 0 ] || fail "must be run as root (sudo tools/install-webui.sh)."
}

# Every run's full output (this script's own `log`/`fail` lines plus every command it invokes)
# is captured to $LOG_FILE, not just whatever's still visible in the terminal — useful after the
# fact for a failed run, or one kicked off non-interactively. Still prints to stdout/stderr as
# before via tee, so nothing about running it interactively changes.
setup_logging() {
  mkdir -p "$LOG_DIR"
  exec > >(tee -a "$LOG_FILE") 2>&1
  log "Logging this run to $LOG_FILE"
}

# nonraid-webui itself runs as root (see nonraid-webui.service — no User= override), the same way
# other single-appliance array OS designs work, so there's no separate service account to provision
# here. What still needs a fixed identity is array/pool/cache data ownership: this app chowns and
# sets a default ACL for $ARRAY_DATA_USER:$ARRAY_DATA_GROUP on that data (see
# shares/applier/realApplier.ts's provisionArrayDir() and cache/mount.ts's mountCache()) — the
# classic linuxserver.io nobody:users (99:100) convention most Community-Apps containers
# already default their own PUID/PGID to. Named "user" rather than "nobody" since Debian's own
# nobody account is a fixed uid 65534, not 99 — that name's already taken.
ensure_array_data_account() {
  log "Checking for the $ARRAY_DATA_USER:$ARRAY_DATA_GROUP ($ARRAY_DATA_UID:$ARRAY_DATA_GID) account"
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
}

install_system_packages() {
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
    avahi-daemon \
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
}

# samba's own postinst drops a stock sample smb.conf with [homes]/[printers]/[print$] shares
# enabled by default - this app has no printer-sharing feature and no per-Unix-user
# home-directory concept, so those just show up as unexplained noise ("nobody", "print$") in
# network-browse tools alongside the shares actually configured through the app. Replace it with
# nonraid-webui's own minimal smb.conf instead - same managed-shares markers
# (backend/src/shares/applier/realApplier.ts), just without the unused stock sections above them.
# If a smb.conf from a previous install already has shares written into those markers, preserve
# that block rather than blowing it away - only the static [global] section actually needs
# refreshing.
install_smb_conf() {
  log "Installing smb.conf"
  local smb_conf=/etc/samba/smb.conf
  local smb_template="$REPO_ROOT/tools/config/smb.conf"
  # One-time backup of whatever was there before nonraid-webui ever touched this file (normally
  # samba's own stock sample) - never overwritten on later reinstalls/upgrades, so it stays the
  # actual original rather than a snapshot of nonraid-webui's own previous template.
  if [ -f "$smb_conf" ] && [ ! -f "$smb_conf.orig" ]; then
    cp "$smb_conf" "$smb_conf.orig"
  fi
  if [ -f "$smb_conf" ] && grep -q '# === nonraid-webui:managed-shares:begin ===' "$smb_conf"; then
    local smb_tmp
    smb_tmp="$(mktemp)"
    sed -n '1,/# === nonraid-webui:managed-shares:begin ===/p' "$smb_template" >"$smb_tmp"
    sed -n '/# === nonraid-webui:managed-shares:begin ===/,/# === nonraid-webui:managed-shares:end ===/p' "$smb_conf" | sed '1d;$d' >>"$smb_tmp"
    sed -n '/# === nonraid-webui:managed-shares:end ===/,$p' "$smb_template" >>"$smb_tmp"
    install -m 644 "$smb_tmp" "$smb_conf"
    rm -f "$smb_tmp"
  else
    install -m 644 "$smb_template" "$smb_conf"
  fi
}

# Debian ships nfsd at 16 threads by default (an improvement over older releases' default of 8,
# but still conservative for a NAS expected to serve several clients/streams at once) - bumping
# it is a plain concurrency win with no correctness/durability tradeoff, unlike exports' sync vs
# async (left alone - see backend/src/shares/applier/realApplier.ts's writeExportsBlock() for why
# every export stays `sync`). `nfsconf --set` is the package-sanctioned way to edit /etc/nfs.conf
# - idempotent and comment-aware, unlike hand-rolled sed against a file nfs-kernel-server itself
# also owns. Only takes effect on nfs-kernel-server's next (re)start, done in enable_services.
configure_nfs_threads() {
  log "Setting nfsd thread count to $NFSD_THREADS"
  nfsconf --set nfsd threads "$NFSD_THREADS"
}

# Debian's repo package versions like "2.40.2-5"; the upstream release .deb versions like
# "2.42.0~debian-trixie" — the "~" sorts *before* nothing in Debian's own version ordering, so
# comparing the raw string against a bare "2.42.0" would wrongly conclude an already-correct
# install needs reinstalling every single run. Stripping everything from the first "~" onward
# before comparing (confirmed live against dpkg --compare-versions) avoids that.
ensure_mergerfs() {
  log "Checking mergerfs (needs $MERGERFS_MIN+ — Debian's own repo package is older and accepts an invalid High-water policy setting that crashes on the first write, see REQUIREMENTS.md)"
  local mergerfs_current mergerfs_current_bare
  mergerfs_current="$(dpkg-query -W -f='${Version}' mergerfs 2>/dev/null || true)"
  mergerfs_current_bare="${mergerfs_current%%~*}"
  if [ -n "$mergerfs_current" ] && dpkg --compare-versions "${mergerfs_current_bare:-0}" ge "$MERGERFS_MIN"; then
    log "mergerfs $mergerfs_current already installed and new enough"
  else
    local arch mergerfs_deb_url mergerfs_tmp
    arch="$(dpkg --print-architecture)"
    log "Installing mergerfs from the upstream GitHub release (arch: $arch)"
    mergerfs_deb_url="$(curl -fsSL https://api.github.com/repos/trapexit/mergerfs/releases/latest |
      grep -oP '"browser_download_url":\s*"\K[^"]+debian-trixie_'"$arch"'\.deb' | head -1)"
    [ -n "$mergerfs_deb_url" ] || fail "Could not find a mergerfs debian-trixie_$arch.deb in the latest GitHub release — check https://github.com/trapexit/mergerfs/releases manually."
    mergerfs_tmp="$(mktemp --suffix=.deb)"
    curl -fsSL -o "$mergerfs_tmp" "$mergerfs_deb_url"
    apt-get install -y "$mergerfs_tmp"
    rm -f "$mergerfs_tmp"
  fi
}

# Tailscale for the optional Tailscale settings section - not in Debian's own repos, needs their
# apt repo added first. Disabled by default (see backend/src/settings/types.ts's TailscaleSettings)
# so nothing here starts/enables tailscaled - the webui's own enable toggle does that once someone
# actually turns the feature on.
ensure_tailscale() {
  log "Checking Tailscale"
  if command -v tailscale >/dev/null 2>&1; then
    log "tailscale already installed"
    return
  fi
  log "Adding Tailscale's apt repo and installing"
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list
  apt-get update
  apt-get install -y tailscale
  systemctl disable --now tailscaled >/dev/null 2>&1 || true
}

# rclone, for the optional Remote Backup settings section - Debian 13's own repo package is stale
# (1.60.1, confirmed live via `apt-cache policy rclone` on the test rig), same situation as
# mergerfs above, so this installs from rclone's own official installer instead (which, on a
# Debian/apt host, itself downloads and installs the latest upstream .deb - confirmed live, no
# `unzip` dependency needed the way the installer's generic zip-based path would). Idempotent:
# skips straight to generating the RC daemon's credentials if `rclone` is already on PATH, so a
# re-run doesn't reinstall (and doesn't regenerate an already-configured install's rcd password).
ensure_rclone() {
  log "Checking rclone"
  if ! command -v rclone >/dev/null 2>&1; then
    log "Installing rclone from the official installer"
    curl -fsSL https://rclone.org/install.sh | bash
  else
    log "rclone already installed ($(rclone version | head -1))"
  fi

  log "Checking rclone-rcd credentials"
  mkdir -p /etc/rclone
  local rc_env_file=/etc/default/rclone-rcd
  if [ ! -e "$rc_env_file" ]; then
    log "Generating rclone-rcd RC credentials"
    {
      echo "RCLONE_RC_USER=nonraid"
      echo "RCLONE_RC_PASS=$(openssl rand -hex 24)"
    } >"$rc_env_file"
    chmod 600 "$rc_env_file"
  else
    log "$rc_env_file already exists - leaving it as-is"
  fi
}

install_node() {
  log "Installing Node.js 22.x from Nodejs"
  mkdir -p /usr/local/lib/nodejs
  wget -q -O /tmp/nodejs.tar.xz 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz'
  tar -xJf /tmp/nodejs.tar.xz -C /usr/local/lib/nodejs

  ln -sfn /usr/local/lib/nodejs/node-v22.23.2-linux-x64 /usr/local/lib/nodejs/current

  ln -sfn /usr/local/lib/nodejs/current/bin/node /usr/bin/node
  ln -sfn /usr/local/lib/nodejs/current/bin/npm /usr/bin/npm
  ln -sfn /usr/local/lib/nodejs/current/bin/npx /usr/bin/npx
  ln -sfn /usr/local/lib/nodejs/current/bin/corepack /usr/bin/corepack

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

# Unusual floor: 20.6+ OR 21.7+ OR 22+ (not 18.x, not 21.0-21.6) — kept as the known-good version
# this app has actually been verified against, not yet re-tested against anything older.
ensure_node() {
  log "Checking Node.js"
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
}

fetch_nonraid_source() {
  log "Fetching NonRAID from $NONRAID_REPO_URL (main branch)"
  if [ -d "$NONRAID_SRC_DIR/.git" ]; then
    # An existing checkout only shows up here on a re-run/update, or when one was pre-seeded onto
    # an install image (see nonraid-os's build/build-image.sh) so the install still has something
    # to build against with no network at all. Either way, a failed fetch isn't fatal the way it
    # is below when there's nothing to fall back on: warn and keep building from what's already
    # there rather than aborting the whole install.
    if git -C "$NONRAID_SRC_DIR" fetch origin main; then
      git -C "$NONRAID_SRC_DIR" reset --hard origin/main
      chown -R root:root "$NONRAID_SRC_DIR"
    else
      log "Could not reach $NONRAID_REPO_URL (offline?) — building from the existing checkout at $NONRAID_SRC_DIR as-is"
    fi
  else
    rm -rf "$NONRAID_SRC_DIR"
    git clone --branch main "$NONRAID_REPO_URL" "$NONRAID_SRC_DIR"
    chown -R root:root "$NONRAID_SRC_DIR"
  fi
}

build_nonraid_driver() {
  local nonraid_version kversion dkms_src_dir
  nonraid_version="$(grep '^PACKAGE_VERSION=' "$NONRAID_SRC_DIR/dkms.conf" | cut -d= -f2)"
  kversion="$(uname -r)"
  [ -n "$nonraid_version" ] || fail "Could not read PACKAGE_VERSION from $NONRAID_SRC_DIR/dkms.conf"

  log "Building and installing the NonRAID kernel module via DKMS ($nonraid_version for $kversion)"
  # Always rebuilds from whatever was just pulled, rather than skipping when dkms already has this
  # exact module+version+kernel combination installed (the pattern mergerfs/Node above use): this is
  # a personal fork under active iteration, and a real fix landing here won't reliably come with a
  # PACKAGE_VERSION bump every time — skip-if-present would silently keep running stale, already-
  # superseded driver code after a `git pull`-only update. dkms remove is a no-op (the `|| true`)
  # the first time this ever runs, when nothing is registered yet.
  dkms_src_dir="/usr/src/nonraid-dkms-$nonraid_version"
  dkms remove "nonraid-dkms/$nonraid_version" -k "$kversion" >/dev/null 2>&1 || true
  rm -rf "$dkms_src_dir"
  mkdir -p "$dkms_src_dir"
  cp -r "$NONRAID_SRC_DIR/md_nonraid" "$NONRAID_SRC_DIR/raid6" "$NONRAID_SRC_DIR/dkms.conf" "$NONRAID_SRC_DIR/Makefile" "$dkms_src_dir/"
  dkms install "nonraid-dkms/$nonraid_version" -k "$kversion"
}

# Kept as its own canonical step (unchanged name/position) for a full install - just a thin wrapper
# now that fetch/build are independently callable, e.g. by update_driver below.
install_nonraid_driver() {
  fetch_nonraid_source
  build_nonraid_driver
}

install_nmdctl() {
  log "Installing nmdctl"
  install -m 755 "$NONRAID_SRC_DIR/tools/nmdctl" /usr/local/bin/nmdctl
}

install_nonraid_systemd_units() {
  log "Installing the NonRAID systemd units"
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
}

# Kept as its own canonical step (unchanged name/position) for a full install - a thin wrapper now
# that nmdctl/the unit files are independently installable, e.g. by update_script below.
install_nmdctl_and_units() {
  install_nmdctl
  install_nonraid_systemd_units
}

check_required_tools() {
  log "Checking other required tools"
  local tool
  for tool in rsync systemctl npm; do
    command -v "$tool" >/dev/null 2>&1 || fail "'$tool' not found on PATH — required to install."
  done
}

build_backend() {
  log "Building backend"
  (cd "$BACKEND_DIR" && npm ci && npm run build)
}

build_frontend() {
  log "Building frontend"
  (cd "$REPO_ROOT" && npm ci && npm run build)
}

stage_backend() {
  log "Staging backend into $INSTALL_ROOT/backend"
  mkdir -p "$INSTALL_ROOT/backend"
  rsync -a --delete "$BACKEND_DIR/dist/" "$INSTALL_ROOT/backend/dist/"
  rsync -a --delete "$BACKEND_DIR/node_modules/" "$INSTALL_ROOT/backend/node_modules/"
  cp "$BACKEND_DIR/package.json" "$BACKEND_DIR/package-lock.json" "$INSTALL_ROOT/backend/"
  # Pruned in the staged copy only — never in $BACKEND_DIR itself, which would
  # silently strip tsx/typescript out of this checkout's own working
  # node_modules and break `npm run dev`/`npm run typecheck` right after.
  (cd "$INSTALL_ROOT/backend" && npm prune --omit=dev)
}

stage_frontend() {
  log "Staging frontend into $INSTALL_ROOT/frontend-dist"
  mkdir -p "$INSTALL_ROOT/frontend-dist"
  rsync -a --delete "$REPO_ROOT/dist/" "$INSTALL_ROOT/frontend-dist/"
}

# Kept as its own canonical step (unchanged name/position) for a full install - a thin wrapper now
# that backend/frontend staging are independently callable, e.g. by update_backend/update_frontend
# below.
stage_install() {
  stage_backend
  stage_frontend
}

install_webui_systemd_unit() {
  log "Installing systemd unit"
  install -m 644 "$REPO_ROOT/tools/systemd/nonraid-webui.service" /etc/systemd/system/nonraid-webui.service

  log "Installing Avahi service-type file for SMB share discovery"
  mkdir -p /etc/avahi/services
  install -m 644 "$REPO_ROOT/tools/config/avahi-samba.service" /etc/avahi/services/samba.service

  if [ ! -e /etc/nonraid/config.toml ]; then
    log "Installing default config (/etc/nonraid/config.toml)"
    mkdir -p /etc/nonraid
    install -m 644 "$REPO_ROOT/tools/config/nonraid-webui.toml.example" /etc/nonraid/config.toml
  else
    log "/etc/nonraid/config.toml already exists — leaving it as-is"
  fi
}

# Own systemd unit, not a child process of the webui backend - same reasoning as tailscaled: the
# webui restarts itself for TLS/timezone-change flows, and an in-progress remote sync shouldn't die
# because of that. Installed-but-off by default, same as tailscaled - the webui's own enable
# toggle (`PUT /rclone/enabled`) is what actually starts it once someone turns Remote Backup on.
install_rclone_systemd_unit() {
  log "Installing rclone-rcd systemd unit"
  install -m 644 "$REPO_ROOT/tools/systemd/rclone-rcd.service" /etc/systemd/system/rclone-rcd.service
  systemctl daemon-reload
  systemctl disable --now rclone-rcd >/dev/null 2>&1 || true
}

start_system_services() {
  log "Starting system services"
  # samba/nfs-kernel-server/docker.io/avahi-daemon's own postinst scripts already enable+start their
  # services by default on Debian — this is the same "make sure, don't just assume" belt-and-suspenders
  # as the nonraid.service line above, explicit rather than relying on package-manager defaults that
  # could vary. Also re-triggers avahi-daemon to pick up the service file just installed above if it
  # was already running from a previous install. mergerfs and lxc/lxc-templates have no persistent
  # daemon of their own to start (mergerfs is mounted per-share on demand by nonraid-webui itself;
  # lxc containers are started individually via the LXC tab, not a single system-wide service).
  systemctl enable --now smbd nmbd nfs-kernel-server docker avahi-daemon
  systemctl reload-or-restart avahi-daemon
  # nfs-kernel-server's own ExecReload only re-runs `exportfs -r` (exports, not nfsd itself) -
  # the thread count configure_nfs_threads just wrote to /etc/nfs.conf is only read by rpc.nfsd
  # at its own startup, so an already-running server needs a real restart, not reload, to pick it
  # up. A plain `enable --now` above is a no-op here since the service is already active on a
  # re-run.
  systemctl restart nfs-kernel-server
}

restart_webui() {
  log "Reloading systemd and (re)starting nonraid-webui"
  systemctl daemon-reload
  systemctl enable nonraid-webui
  systemctl restart nonraid-webui
}

# Kept as its own canonical step (unchanged name/position) for a full install - a thin wrapper now
# that the system-services and nonraid-webui-only restart are independently callable, e.g. by
# update_backend/update_frontend below (which only need the latter, not a full samba/nfs/docker/
# avahi restart every time).
start_services() {
  start_system_services
  restart_webui
}

print_summary() {
  echo
  systemctl status nonraid-webui --no-pager || true
  echo
  log "Done. Visit http://<this-host>:3001/ — first boot shows the admin account setup screen."
  log "Reminder: HTTPS can be enabled from Settings -> Security once you're ready — the session cookie's Secure flag auto-flips at boot once this app's own TLS is enabled, no manual config.toml edit needed."
}

# Convenience shortcuts for updating one already-installed piece without re-running (or even
# knowing the exact ordering of) the steps that make it up - never part of a full install/update
# run, only ever reached via --step, and none of them touch apt/mergerfs/Node.
update_backend() {
  build_backend
  stage_backend
  restart_webui
}

update_frontend() {
  build_frontend
  stage_frontend
  restart_webui
}

# The kernel module - rebuilds/reinstalls it via DKMS, same as install_nonraid_driver in a full
# run. Deliberately does not unload/reload the *live* module (that's a separate, disruptive
# operation - stops the array, needs Docker/LXC out of the way first - triggered from the app
# itself via Settings > Services, not this script) - a freshly built module on disk takes effect
# on next boot or explicit reload either way.
update_driver() {
  fetch_nonraid_source
  build_nonraid_driver
}

# This script's own repo (nonraid-webui, $REPO_ROOT - not $NONRAID_SRC_DIR, the separate kernel
# driver checkout update_driver pulls). A plain `git pull` rather than fetch+reset --hard like
# fetch_nonraid_source above: this is the checkout someone's actively developing in, quite possibly
# with local edits/commits of their own, so failing on a conflict instead of silently discarding
# work is the right default here. Only pulls the latest source - run update_backend/update_frontend
# afterward to actually rebuild and redeploy from it.
update_script() {
  log "Pulling latest nonraid-webui in $REPO_ROOT"
  chown -R root:root "$NONRAID_SRC_DIR"
  git -C "$REPO_ROOT" pull
}

# Canonical run order, and the full set of names --step accepts - deliberately just the
# "top-level" steps main() would otherwise call directly, not every helper function in this file
# (install_node/check_node_version are internal to ensure_node and wouldn't do anything useful
# run alone, so they're not listed here).
STEPS=(
  ensure_array_data_account
  install_system_packages
  install_smb_conf
  configure_nfs_threads
  ensure_mergerfs
  ensure_tailscale
  ensure_rclone
  ensure_node
  install_nonraid_driver
  install_nmdctl_and_units
  check_required_tools
  build_backend
  build_frontend
  stage_install
  install_webui_systemd_unit
  install_rclone_systemd_unit
  start_services
  print_summary
)

# Update-one-thing shortcuts - valid --step targets, but deliberately excluded from STEPS: running
# these as part of a full install/update would be redundant with (and land in a nonsensical spot
# relative to) the canonical steps above, which already do everything these call.
SHORTCUTS=(
  update_backend
  update_frontend
  update_driver
  update_script
)

usage() {
  cat <<EOF
Usage: $0 [--step NAME]... [--list-steps] [-h|--help]

With no arguments, runs the full install/update end to end.

  --step NAME   Run only this step instead of the full sequence. Repeat to
                run several - they always run in their normal relative
                order, regardless of the order given on the command line.
                A trailing "+" (--step NAME+) means this step and every
                step after it, for resuming a run partway through - only
                valid for the numbered steps below, not a shortcut.
  --list-steps  Print the available step/shortcut names, one per line, and exit.
  -h, --help    Show this help.

Steps, in the order a full run executes them:
$(printf '  %s\n' "${STEPS[@]}")

Shortcuts for updating one already-installed piece (never run as part of a
full install/update - only reachable via --step):
$(printf '  %s\n' "${SHORTCUTS[@]}")
EOF
}

is_valid_step() {
  local name="$1" s
  for s in "${STEPS[@]}" "${SHORTCUTS[@]}"; do
    [ "$s" = "$name" ] && return 0
  done
  return 1
}

is_shortcut() {
  local name="$1" s
  for s in "${SHORTCUTS[@]}"; do
    [ "$s" = "$name" ] && return 0
  done
  return 1
}

# Appends NAME (a plain step) or, for NAME+, every step from NAME through the end of STEPS, onto
# the caller's `selected` array - relies on that being an already-declared array in scope (bash has
# no clean pass-an-array-by-reference short of namerefs, and this is only ever called from main()'s
# own arg-parsing loop, so a global-ish convention is simplest here).
add_selected_step() {
  local raw="$1" name
  if [[ "$raw" == *+ ]]; then
    name="${raw%+}"
    is_valid_step "$name" || fail "unknown step '$name' — see --list-steps."
    is_shortcut "$name" && fail "'$name+' isn't valid - '+' only makes sense on a numbered step, not a shortcut (a shortcut has no fixed position to run 'from')."
    local found=0 s
    for s in "${STEPS[@]}"; do
      if [ "$found" -eq 1 ] || [ "$s" = "$name" ]; then
        found=1
        selected+=("$s")
      fi
    done
  else
    is_valid_step "$raw" || fail "unknown step '$raw' — see --list-steps."
    selected+=("$raw")
  fi
}

main() {
  local -a selected=()
  while [ $# -gt 0 ]; do
    case "$1" in
    --step)
      [ -n "${2:-}" ] || fail "--step requires a step name — see --list-steps."
      add_selected_step "$2"
      shift 2
      ;;
    --list-steps)
      printf '%s\n' "${STEPS[@]}" "${SHORTCUTS[@]}"
      exit 0
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument '$1' — see --help."
      ;;
    esac
  done

  require_root
  setup_logging

  local -a to_run=()
  if [ "${#selected[@]}" -eq 0 ]; then
    to_run=("${STEPS[@]}")
  else
    # Walk STEPS (then SHORTCUTS) in canonical order rather than the order --step was given, and
    # drop duplicates from a step passed more than once - so e.g. --step start_services --step
    # ensure_node still builds/starts in a sane order, not literally as typed. Any shortcuts
    # selected run after every plain step, in the order listed in SHORTCUTS.
    local step sel
    for step in "${STEPS[@]}" "${SHORTCUTS[@]}"; do
      for sel in "${selected[@]}"; do
        if [ "$step" = "$sel" ]; then
          to_run+=("$step")
          break
        fi
      done
    done
    log "Running selected step(s) only: ${to_run[*]}"
  fi

  for step in "${to_run[@]}"; do
    "$step"
  done
}

main "$@"
