#!/usr/bin/env bash
# Decrypts a config backup archive (.nrb, or the older .tar.gz name the same feature used before
# that extension existed) downloaded from Settings -> Backups with encryption on, or restored from
# a "Download encrypted backup now" link. Exists so an admin can still get at their own backup
# without the webui running - the array being down, the host not booting, or the backup being
# opened on a different machine entirely are exactly the situations this matters for.
#
# The archive itself is nothing exotic: `tar czf` piped through `openssl enc -aes-256-cbc -pbkdf2`
# (see backend/src/system/backupCrypto.ts) - this script is a thin, documented wrapper around the
# exact same openssl invocation, not a new format. An unencrypted archive (or one already
# decrypted) is detected by gzip's own magic bytes and passed through unchanged, so this is safe
# to point at any backup archive without knowing ahead of time whether it's encrypted.
#
# Usage:
#   tools/decrypt-backup.sh nonraid-config-backup-1234567890.nrb
#   tools/decrypt-backup.sh -o restored.tar.gz path/to/backup.nrb
#   tools/decrypt-backup.sh -x -o /tmp/restored path/to/backup.nrb   # decrypt straight into a tar extract
#
# The password is never accepted as a plain command-line argument (visible to any local user via
# `ps`) - it's either typed at a hidden prompt, or read from the NRB_PASSWORD environment variable
# for scripted/non-interactive use (accept the same "visible to root via /proc/<pid>/environ"
# tradeoff any other *_PASSWORD env var convention carries).

set -euo pipefail

log() { echo "==> $*"; }
fail() {
  echo "ERROR: $*" >&2
  exit 1
}

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

OUTPUT=""
EXTRACT=0
ARCHIVE=""

while [ $# -gt 0 ]; do
  case "$1" in
    -o|--output) OUTPUT="$2"; shift 2 ;;
    -x|--extract) EXTRACT=1; shift ;;
    -h|--help) usage 0 ;;
    --) shift; break ;;
    -*) fail "Unknown option: $1 (see --help)" ;;
    *)
      [ -z "$ARCHIVE" ] || fail "Only one archive path is accepted (got a second: $1)"
      ARCHIVE="$1"
      shift
      ;;
  esac
done

[ -n "$ARCHIVE" ] || usage 1
[ -f "$ARCHIVE" ] || fail "No such file: $ARCHIVE"
command -v openssl >/dev/null 2>&1 || fail "openssl is required but not on PATH."

if [ -z "$OUTPUT" ]; then
  if [ "$EXTRACT" = 1 ]; then
    OUTPUT="${ARCHIVE%.nrb}"
    OUTPUT="${OUTPUT%.tar.gz}-extracted"
  else
    OUTPUT="${ARCHIVE%.nrb}"
    OUTPUT="${OUTPUT%.tar.gz}.tar.gz"
    [ "$OUTPUT" != "$ARCHIVE" ] || OUTPUT="${ARCHIVE}.tar.gz"
  fi
fi

# Gzip's own two-byte magic (0x1f 0x8b) - what every unencrypted archive this app writes starts
# with, whatever openssl enc's own output never does. Same check the backend itself uses
# (backupCrypto.ts's looksLikeGzip) to tell an encrypted archive from a plain one without a
# password.
first_two_bytes="$(od -An -tx1 -N2 "$ARCHIVE" | tr -d ' \n')"
if [ "$first_two_bytes" = "1f8b" ]; then
  log "This archive isn't encrypted - nothing to decrypt."
  PLAIN_TAR="$ARCHIVE"
else
  echo "Password for $ARCHIVE:"
  if [ -n "${NRB_PASSWORD:-}" ]; then
    PASSWORD="$NRB_PASSWORD"
  else
    read -r -s -p "> " PASSWORD
    echo
  fi
  [ -n "$PASSWORD" ] || fail "A password is required."

  PASSWORD_FILE="$(mktemp)"
  chmod 600 "$PASSWORD_FILE"
  printf '%s' "$PASSWORD" > "$PASSWORD_FILE"
  unset PASSWORD
  cleanup() { rm -f "$PASSWORD_FILE"; }
  trap cleanup EXIT

  if [ "$EXTRACT" = 1 ]; then
    PLAIN_TAR="$(mktemp)"
    trap 'cleanup; rm -f "$PLAIN_TAR"' EXIT
  else
    PLAIN_TAR="$OUTPUT"
  fi

  if ! openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$PASSWORD_FILE" -in "$ARCHIVE" -out "$PLAIN_TAR"; then
    rm -f "$PLAIN_TAR"
    fail "Decryption failed - wrong password, or the archive is corrupt."
  fi
fi

if [ "$EXTRACT" = 1 ]; then
  mkdir -p "$OUTPUT"
  tar -xzf "$PLAIN_TAR" -C "$OUTPUT"
  log "Extracted to $OUTPUT"
else
  [ "$PLAIN_TAR" = "$OUTPUT" ] || cp "$PLAIN_TAR" "$OUTPUT"
  log "Wrote $OUTPUT"
fi
