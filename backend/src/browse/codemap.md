# backend/src/browse/

## Responsibility
File browser over the whole /mnt tree — list, size, download, mkdir, rename, copy, move, delete, upload — with strict path-safety enforcement.

## Design
- `BrowseService` (service.ts) implements every operation; paths.ts is the only place request paths become filesystem paths. `resolveExisting()` realpaths the path and re-checks it stays within `config.browseRoot` (the traversal ceiling, symlink-safe); `resolveForCreate()` validates the final segment as a plain name (`assertValidSegmentName`) with the same root check. `isMountPoint()` (dev id differs from parent) guards ops the OS would refuse with EBUSY.
- `list()` classifies entries with `locationType` (`pool`/`disk`/`cache`/`boot`) via `isMountPoint` + share-name matching, and annotates physical branch locations via `ShareService.locateShareEntries` — both the merged view and a raw disk's per-pool branches.
- `chownArrayOwner()` re-owns backend-created content away from root:root (the setgid bit already covers the group).
- move/copy/saveUpload fall back to copy+chown+rm on cross-device rename failure (`EXDEV`, or FUSE's `ENOTCONN`). `remove()` delegates share mount points to `ShareService.removeMountPointWithData`.
- suggest.ts: `suggestDirectories()` — directory-only path completion, symlink-safe, roots supplied by the route's `scope` param (binds vs browse).

## Flow
- routes/browse.ts → service methods → paths.ts resolution → fs ops. Bulk copy/move/delete streams NDJSON progress in the route, calling `copy`/`move`/`remove` per item; client abort sets a cancel flag.
- `saveUpload`: multer streams to OS temp dir; service validates the destination, `rename`s (or `copyFile`+`unlink`) into place, and removes the temp file on any error.

## Integration
- Depends on `ShareService` (`removeMountPointWithData`, `locateShareEntries`, `getShareNames`) and `config` (`browseRoot`, `browseDefaultPath`, `shareMountRoot`, `cacheMountPoint`).
- Consumed by routes/browse.ts (`browseRouter`), which also serves /browse/suggest site-wide (Docker/Apps bind mounts, backup destinations, Browse's move dialog). Constructed in index.ts.
