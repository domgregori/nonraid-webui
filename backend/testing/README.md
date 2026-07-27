# Shares test environment

A privileged Docker container that gives the backend something real to test the Shares
subsystem against — real mounted filesystems standing in for array disks, a real
`mergerfs` binary, and real `smbd`/NFS daemons — without touching your actual machine's
filesystem, mounts, or system config.

**What it is not**: a way to test `nmdctl`/nonraid itself. That needs the real kernel
module, which can't run in a container regardless of privilege level. `NMD_MODE` stays
`mock` here — this environment is specifically for the Shares pooling/export layer
(mergerfs + Samba + NFS), which is a separate concern from the array driver.

## Why the backend runs *inside* the container

`RealShareApplier` runs real `mount`, `mergerfs`, and service-reload commands. Running
the backend on your host and having it execute those commands would mean it's mounting
things and rewriting `smb.conf`/`/etc/exports` on your **actual machine** — not what you
want for testing. Running the whole backend inside this isolated, disposable container
means all of that stays contained.

## Usage

```bash
cd backend/testing
docker compose up -d       # builds the image on first run, starts everything
docker compose logs -f     # watch disk provisioning + backend startup
```

The backend is reachable at `http://localhost:3001` same as always (host networking —
see note below on why). Source is bind-mounted from `../..` so edits to backend code
take effect via `tsx watch`'s hot-reload, no rebuild needed. `node_modules` is a
separate named volume so the container keeps its own native deps (`tsx`/`esbuild`)
independent of whatever's installed on your host.

```bash
docker compose down        # stop, keep disk images/node_modules for next time
docker compose down -v     # stop and wipe everything (fresh disks next start)
```

### Poking around manually

```bash
docker exec -it nonraid-webui-shares-test bash
ls /mnt/disk1 /mnt/disk2 ...   # the simulated array disks
mount | grep mergerfs           # any pools the backend has created
smbclient -L localhost -N       # list SMB shares (once the backend creates some)
```

## What's actually provisioned

- `DISK_COUNT` (default 6) loopback-mounted disk images at `/mnt/disk1`..`/mnt/diskN`,
  `DISK_SIZE_MB` (default 512) each — override via environment in `docker-compose.yml`.
  Each is its own real mounted filesystem (independent `df` output), matching what
  `nmdctl` provides for real array disks. `MockNmdClient` (backend) already reports
  disk mountpoints as `/mnt/disk<slot>` — matches exactly, so the Shares backend can
  build real `mergerfs` commands straight from the mock array status.
- Filesystem type: probed at startup against whatever the host kernel actually
  supports, trying xfs → ext4 → btrfs in that order (real nonraid disks are XFS, but
  this container's own dev host turned out to have neither xfs nor ext4 support —
  only btrfs — so this had to be made to auto-detect rather than assume XFS). Override
  with `DISK_FS_TYPE` to force one.
- `smbd` running and ready for config.
- NFS: best-effort only. `rpc.nfsd` is a kernel-side server (not a plain userspace
  daemon) — it needs the host kernel to support it, which isn't guaranteed in Docker
  regardless of `--privileged`. The entrypoint tries and logs a clear warning if it
  doesn't come up; mergerfs and Samba testing are unaffected either way.

### Networking

Published ports (`ports:` in compose) hit an `iptables`/`nf_tables` DNAT error on this
particular dev machine — a pre-existing host Docker networking issue, unrelated to this
container. Worked around with `network_mode: host` instead, which is a reasonable
simplification for a single-purpose local test container (no port-mapping needed to
begin with). If your host doesn't have that problem, published ports would work fine
too — no need to change anything either way, but flagging it in case you *do* want SMB
(445) reachable from outside the container for manual testing with a real SMB client.

## Verified against the real Shares backend

Full lifecycle exercised through the actual `/api/shares` endpoints (not just manual
mergerfs commands) — see `backend/README.md`'s Shares section for the details: create
(real mergerfs mount, `smb.conf` regenerated, share listed by real `smbclient -L`),
rename (old pool unmounted, new one mounted, config regenerated with only the new name),
delete (unmounted, un-exported, underlying files left intact), and the offline-disks
error path (clean 409 instead of a cryptic mount failure).

Earlier manual mergerfs-only check, kept here as a quick sanity command if you want to
poke at the environment before/without the backend running:

```bash
docker exec nonraid-webui-shares-test bash -c '
  echo hi1 > /mnt/disk1/f1.txt
  echo hi2 > /mnt/disk2/f2.txt
  mkdir -p /mnt/user/testshare
  mergerfs -o category.create=mfs /mnt/disk1:/mnt/disk2 /mnt/user/testshare
  ls /mnt/user/testshare        # both files show up merged
  df -h /mnt/user/testshare     # size = sum of both branch disks (confirms stats-via-df works)
'
```
