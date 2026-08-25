# backend/src/shares/applier/

## Responsibility
Reconciles the shares.json desired state onto the host's real subsystems: mergerfs pooled mounts, Samba smb.conf, and NFS /etc/exports.

## Design
- `ShareApplier` interface (client.ts): `mountShare`/`unmountShare`/`syncExports`/`getStats`/`getActiveConnectionCounts`, all driven by an `ApplyContext` (`diskMountpoints`, `minFreeSpaceGb`, `cacheMountPoint`). `index.ts`'s `createShareApplier()` returns a `RealShareApplier`.
- `RealShareApplier` shells out to mergerfs/mount/umount/smbcontrol/smbstatus/exportfs. It only ever rewrites the `# === nonraid-webui:managed-shares:begin/end ===` block via `replaceManagedBlock()` (with a `.bak` backup) — never the rest of the file — so hand-configured smb.conf/exports survive.
- `branchPaths()`: cache-first ordering when cache is active (except single-disk), cache-only shares bind to the cache branch alone. `mergerfsPolicy()` maps `AllocationMethod` → create policy (`mfs`/`ff`/`mspmfs`); cache-first shares always force `ff`.
- Before unmounting: `unexport()` (exportfs -u) and `closeSmbClients()` (smbcontrol close-share) release NFS/SMB VFS holds that would make umount fail with "target is busy".
- NFS exports: `isFuseMount()` (reads /proc/mounts) triggers a deterministic `stableFsid()` (FNV-1a) for FUSE-backed exports; `all_squash` + `anonuid/anongid` = arrayDataOwner, plus an NFSv4 pseudo-root line (`fsid=0,crossmnt`).

## Flow
- `ShareService` → `applier.mountShare(share, ctx)`: `provisionArrayDir` per branch, mkdir mountpoint, if already mounted do unexport/closeSmbClients/umount (idempotent re-mount), then single branch → `mount --bind`, multiple → mergerfs `-o allow_other,category.create=...,use_ino,minfreespace=...`.
- `ShareService.resyncExports()` → `syncExports(allShares, accessByShare)` → `writeSmbBlock()` (per-share `[name]` sections: path, `force user/group`, `valid users`/`read list`/`invalid users`, `guest ok`, ABE for hidden) + `writeExportsBlock()` (host-based `rw`/`ro` exports), then `smbcontrol smbd reload-config` (or `smbd -D`) and `exportfs -ra`.

## Integration
- Sole consumer is `ShareService` (shares/service.ts); interface + factory re-exported from shares/index.ts.
- Uses `config` (`smbConfPath`, `exportsPath`, `shareMountRoot`, `cacheMountPoint`, `arrayDataOwner/Group/Uid/Gid`) and `provisionArrayDir` from system/arrayDir.ts.
- Invoked on every share create/update/remove/rename, after user/group ACL changes via `UsersService`, and at startup via `remountAll()`.
