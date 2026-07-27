#!/bin/bash
set -e

DISK_COUNT="${DISK_COUNT:-6}"
DISK_SIZE_MB="${DISK_SIZE_MB:-512}"
# Preference order for the loopback disks' filesystem. Real nonraid disks are
# XFS, but not every host kernel this test container runs on has xfs/ext4
# support built in (some minimal/custom kernels only have btrfs) — so this
# probes and uses whatever the host actually supports, once, then reuses it.
# Override with DISK_FS_TYPE to force one.
FS_CANDIDATES="${DISK_FS_TYPE:-xfs ext4 btrfs}"
IMG_DIR=/data/disk-images

mkdir -p "$IMG_DIR"

# The container's own /dev only has a handful of loop device nodes pre-created
# even with --privileged (it's a fresh devtmpfs, not the host's /dev). Make sure
# enough exist before losetup goes looking for a free one.
for i in $(seq 0 31); do
  [ -e "/dev/loop$i" ] || mknod "/dev/loop$i" b 7 "$i"
done

mkfs_for() {
  case "$1" in
    xfs) mkfs.xfs -q "$2" ;;
    ext4) mkfs.ext4 -q "$2" ;;
    btrfs) mkfs.btrfs -q "$2" >/dev/null ;;
  esac
}

# Figure out which filesystem type this kernel actually supports, once, using
# a throwaway probe image — rather than guessing wrong on every disk.
WORKING_FS=""
for fstype in $FS_CANDIDATES; do
  probe_img="$IMG_DIR/.probe.img"
  probe_mnt="/mnt/.fsprobe"
  rm -f "$probe_img"
  mkdir -p "$probe_mnt"
  truncate -s 150M "$probe_img" # btrfs refuses anything under ~109MB
  if mkfs_for "$fstype" "$probe_img" 2>/dev/null; then
    loopdev=$(losetup -f)
    if losetup "$loopdev" "$probe_img" 2>/dev/null && mount "$loopdev" "$probe_mnt" 2>/dev/null; then
      umount "$probe_mnt"
      losetup -d "$loopdev"
      WORKING_FS="$fstype"
      rm -f "$probe_img"
      rmdir "$probe_mnt"
      echo "Using $fstype for loopback disks (probed OK on this kernel)"
      break
    fi
    losetup -d "$loopdev" 2>/dev/null || true
  fi
done
rm -f "$IMG_DIR/.probe.img"

if [ -z "$WORKING_FS" ]; then
  echo "ERROR: none of [$FS_CANDIDATES] mount on this host kernel. Set DISK_FS_TYPE to one your kernel supports." >&2
  exit 1
fi

echo "=== Provisioning $DISK_COUNT loopback disks (${DISK_SIZE_MB}MB each, $WORKING_FS) ==="
for i in $(seq 1 "$DISK_COUNT"); do
  img="$IMG_DIR/disk$i.img"
  mnt="/mnt/disk$i"
  mkdir -p "$mnt"

  if mountpoint -q "$mnt"; then
    echo "disk$i: already mounted at $mnt"
    continue
  fi

  if [ ! -f "$img" ]; then
    truncate -s "${DISK_SIZE_MB}M" "$img"
    mkfs_for "$WORKING_FS" "$img"
    echo "disk$i: created new ${DISK_SIZE_MB}MB $WORKING_FS image"
  fi

  # Loop devices are host-global, not per-container. disk-images/ is a persistent
  # volume, so a *previous* container run may have left this same image file
  # attached to a loop device that nothing detached when that container went
  # away — losetup -f would then just allocate yet another one on top, leaking
  # one loop device per container restart until the host's loop pool (usually
  # capped around 32) is exhausted. Detach any stale attachment to this exact
  # file first.
  for stale in $(losetup -j "$img" | cut -d: -f1); do
    losetup -d "$stale" 2>/dev/null || true
  done

  loopdev=$(losetup -f)
  losetup "$loopdev" "$img"
  mount "$loopdev" "$mnt"
  echo "disk$i: mounted at $mnt (loop $loopdev)"
done

mkdir -p /mnt/user
mkdir -p /var/log/samba /var/lib/samba/private /run/samba

echo "=== Starting Samba (smbd) ==="
smbd -D || echo "WARNING: smbd failed to start"

echo "=== Starting NFS (best-effort — needs nfsd support in the host kernel) ==="
mkdir -p /run/rpcbind /var/lib/nfs
if rpcbind 2>/dev/null && rpc.mountd 2>/dev/null && exportfs -ra 2>/dev/null && /usr/sbin/rpc.nfsd 8 2>/dev/null; then
  echo "NFS server started"
else
  echo "WARNING: NFS server did not fully start (this is expected on many Docker hosts —"
  echo "nfsd is a kernel-side server, not just a userspace daemon; needs host kernel support"
  echo "and typically --privileged + the host already having the nfsd module available)."
  echo "mergerfs pooling and Samba should still work fine regardless."
fi

echo "=== Ready ==="
echo "Data disks: /mnt/disk1..$DISK_COUNT"
echo "Union mount root: /mnt/user"

exec "$@"
