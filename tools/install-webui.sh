#!/usr/bin/env bash
# Builds and installs nonraid-webui as a systemd service. Safe to re-run for
# updates: never touches this checkout's own node_modules (prunes a staged
# copy in /opt instead), never overwrites an already-customized
# /etc/nonraid/config.toml, and always ends with `systemctl restart` so
# first-install and every later update take the same code path.
#
# Run from inside a nonraid-webui checkout, as root:
#   sudo tools/install-webui.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
INSTALL_ROOT=/opt/nonraid-webui
NODE_BIN=/usr/bin/node

log() { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "must be run as root (sudo tools/install-webui.sh)."

log "Checking for the NonRAID kernel driver and nmdctl"

# This only installs the webui itself — it's useless without the actual
# NonRAID kernel driver (md_nonraid/nonraid6_pq) and the nmdctl CLI already
# on this host. `modinfo` checks the driver is built/installed even if not
# currently loaded (e.g. right after boot, before nonraid.service starts it);
# `command -v` checks nmdctl is on PATH. Either missing means array-related
# pages will just show errors until both exist — ask before proceeding rather
# than silently installing something that can't work yet.
if ! modinfo md_nonraid >/dev/null 2>&1 || ! command -v nmdctl >/dev/null 2>&1; then
  cat >&2 <<'EOF'

The NonRAID kernel driver and/or nmdctl were not detected on this host.
nonraid-webui needs both already installed and working — this script only
installs the webui itself. See https://github.com/qvr/nonraid for driver and
nmdctl installation instructions.
EOF
  read -r -p "Continue installing nonraid-webui anyway? [y/N] " reply
  case "$reply" in
    [yY] | [yY][eE][sS]) log "Continuing without a confirmed driver/nmdctl install." ;;
    *) fail "Aborted. Install the NonRAID driver and nmdctl first, then re-run this script." ;;
  esac
fi

log "Checking prerequisites"

[ -x "$NODE_BIN" ] || fail "$NODE_BIN not found. Install Node.js 20.6+ (or 21.7+) system-wide, e.g. from NodeSource — see ../nonraid/REQUIREMENTS.md."

# Node requirement is unusual: 20.6+ OR 21.7+ (not 18.x, not 21.0-21.6) —
# kept as the known-good floor this app has been verified against. (No
# longer strictly required by process.loadEnvFile specifically — that call
# was removed along with .env file support — but not yet re-verified against
# anything older, so the check stays as-is.)
node_version="$("$NODE_BIN" -v)"
node_version="${node_version#v}"
node_major="${node_version%%.*}"
node_minor_rest="${node_version#*.}"
node_minor="${node_minor_rest%%.*}"
node_ok=0
if [ "$node_major" -eq 20 ] && [ "$node_minor" -ge 6 ]; then node_ok=1; fi
if [ "$node_major" -eq 21 ] && [ "$node_minor" -ge 7 ]; then node_ok=1; fi
if [ "$node_major" -ge 22 ]; then node_ok=1; fi
[ "$node_ok" -eq 1 ] || fail "$NODE_BIN is v$node_version — need 20.6+ or 21.7+ (not 18.x, not 21.0-21.6). See ../nonraid/REQUIREMENTS.md."

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

log "Reloading systemd and (re)starting the service"
systemctl daemon-reload
systemctl enable nonraid-webui
systemctl restart nonraid-webui

echo
systemctl status nonraid-webui --no-pager || true
echo
log "Done. Visit http://<this-host>:3001/ — first boot shows the admin account setup screen."
log "Reminder: HTTPS can be enabled from Settings -> Security once you're ready — the session cookie's Secure flag auto-flips at boot once this app's own TLS is enabled, no manual config.toml edit needed."
