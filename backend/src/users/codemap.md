# backend/src/users/

## Responsibility
Manages webui-created user accounts and groups — POSIX useradd/groupadd lifecycle plus SMB passworddb — and their per-share SMB access grants.

## Design
- `UsersClient` interface (client.ts) with `RealUsersClient` impl (realClient.ts); `createUsersClient()` factory in index.ts. Passwords never appear in argv (ps-visible) — `chpasswd`/`smbpasswd` take them on stdin via `runWithStdin()`.
- Source of truth is the host's `/etc/passwd` + `/etc/group` via `getent` (NSS-aware) — no JSON cache to drift. Only accounts with uid/gid in `[config.usersUidRangeStart, usersUidRangeEnd]` (20000–59999) count as managed; the upper bound excludes reserved accounts like `nobody`/`nogroup` (65534).
- `createUser` uses `useradd -N -M` (no private group, no home), then `chpasswd` + `smbpasswd -a -s`, then `usermod -aG`. `updateUser` replaces only managed-group membership, preserving non-managed secondary groups. `deleteUser` drops the Samba passdb entry first.
- `UsersService` (service.ts) layers validation (validate.ts) and `assertManagedGroups()` — a privilege-escalation guard that only ever adds users to app-created groups (never real ones like docker/sudo).

## Flow
- routes/users.ts → `UsersService.createUser` → validate → `assertManagedGroups` → `client.createUser` → activity log.
- `setUserAccess`/`setGroupAccess` → `validatePermission` → verify share + principal exist → `aclStore.setEntry` (explicit `'none'` stored, not "no entry") → `shares.resyncExports()`.
- `deleteUser`/`deleteGroup` → client delete → `aclStore.removePrincipal` → `shares.resyncExports()`. `getUserAccess`/`getGroupAccess` default unset grants to `'none'`.

## Integration
- Dependencies: `ShareAccessStore`, `ShareStore`, `ShareService` (`resyncExports`), `ActivityStore`, `config` (`usersTimeoutMs`, `usersShellPath`, uid/gid range).
- Constructed in index.ts; consumed by routes/users.ts. The ACLs it writes feed smb.conf generation in shares/applier/realApplier.ts.
