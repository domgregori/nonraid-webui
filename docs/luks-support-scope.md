# Scope: LUKS (disk encryption) support

## What the driver already does (confirmed from `~/Source/nonraid/tools/nmdctl`)

This is not a greenfield crypto feature — `nmdctl` already has real, working LUKS
handling built in. The webui's job is mostly UI, key management, and filling one
real gap (initial setup), not building disk-encryption mechanics from scratch.

- **Auto-unlock on mount, for data disks only.** `nmdctl`'s array-mount logic
  (`tools/nmdctl:4320-4382`) explicitly skips parity slots 0 and 29
  (`# Skip parity disks (slots 0 and 29)`, line 4326) — it only runs for data
  disks. For any data disk whose filesystem type is `crypto_LUKS`, it runs
  `cryptsetup luksOpen --key-file "$LUKS_KEYFILE" "$device" "$diskname"`
  (line 4364), then mounts the mapped `/dev/mapper/<diskname>` normally. On
  unmount it runs `cryptsetup luksClose` (line 4575).
- **One shared keyfile for the whole array.** `LUKS_KEYFILE` is a single
  global path (default `/etc/nonraid/luks-keyfile`, overridable via `-k`/
  `--keyfile`, line 97) used for every LUKS data disk in one mount pass. This
  already matches "same password/key for every drive" — nothing extra needed
  to fan a single secret out to multiple disks.
- **Graceful failure when the keyfile is missing.** If `LUKS_KEYFILE` doesn't
  exist, that disk is skipped with `"Keyfile '...' does not exist. Cannot
  open LUKS device."` (line 4358-4361) rather than a hard array-start
  failure. This is already the exact mechanism needed for a "no key stored,
  unlock manually" mode — the driver just leaves that disk closed until
  something calls `cryptsetup luksOpen` for it.
- **No automated initial setup.** There is no `nmdctl` command that formats a
  new LUKS container. The tool literally tells the operator to do it by hand
  (line 3415-3417): `cryptsetup luksFormat /dev/nmd1p1` then
  `cryptsetup open /dev/nmd1p1 nmd1p1`. **This is the real gap** — everything
  else (open/close/mount on the existing keyfile) already works; there's no
  guided way to create a new encrypted disk today.

Confirmed with a repo-wide grep of `backend/src` in nonraid-webui: there is
currently zero LUKS-related code on the webui side. This is a clean addition,
not a change to anything existing.

## Parity disk: not supported, don't try to offer it

The skip at `tools/nmdctl:4326` isn't incidental — LUKS-opening happens in the
*filesystem mount* path, and parity has no filesystem; it's raw block data
consumed directly by the kernel driver. Encrypting parity would need the
kernel module itself to open a device-mapper layer before array import even
begins — a much deeper change than anything exposed today. **Out of scope.**
The wizard and disk-detail UI should hide/grey out LUKS options on the parity
slot rather than let someone attempt it and hit a confusing failure.

## Key management: two modes, both riding the existing mechanism

**Stored (auto-unlock).** A keyfile persists at `LUKS_KEYFILE_PATH`
(reuse `nmdctl`'s own default path so no `-k` override is needed), root-owned,
`0600`. Array start/reboot auto-opens every LUKS data disk with no prompt —
this is already exactly what the driver does today once that file exists.
**Be honest in the UI copy about what this protects against**: a keyfile
sitting on the running machine protects a stolen/lost *disk*, not a
compromised *machine* — anyone with root already has the key. Don't imply
otherwise.

**Manual (unlock on demand).** No keyfile ever touches disk. On boot, LUKS
data disks stay closed (the driver already handles this gracefully, see
above) — the UI shows a clear "N encrypted disks are locked" state. The admin
enters the passphrase through the UI; the backend runs `cryptsetup luksOpen`
with the passphrase piped over stdin (reuse `spawnWithPipedStdin` from
`backend/src/system/procUtil.ts` — the same pattern already used for
`openssl enc`), never as a keyfile, never as an argv string (visible in `ps`).
This is the mode that actually satisfies "can't be extracted if the machine
is compromised," since nothing sensitive is stored at rest.

**Switching modes is a real operation, not a settings toggle.** Moving from
manual to stored (or back) means adding/removing an actual LUKS key slot on
*every* existing encrypted disk (`cryptsetup luksAddKey` / `luksRemoveKey`),
not just changing a webui setting. Model it as its own wizard step with its
own confirmation, not a boolean flip.

**Recovery.** LUKS supports multiple key slots. The format wizard should
always create a second key slot with a human-memorable recovery passphrase,
shown once, with an explicit "write this down" step — independent of whichever
of the two modes above is chosen for day-to-day unlock. Losing the only key
to an encrypted disk is unrecoverable data loss; this is the mandatory
safety net.

## The wizard: v1 ships exactly one path — new/blank disk → LUKS

The UI insertion point is **not** the unassigned-device picker
(`AddDiskDialog`) — that dialog only assigns a raw device to a slot (queued,
async); no filesystem work happens there. The LUKS-vs-plain choice belongs in
`DiskDetailPanel.tsx`'s existing `needsFormat` → "Format Disk (XFS)" action
(`handleFormat` → `nmdApi.formatDisk()`), which is the actual point a
filesystem gets created.

**New (blank) disk → LUKS.** `cryptsetup luksFormat` the raw partition,
`luksOpen` it, then format the filesystem on the mapped device instead of the
raw partition — same as the existing format step, redirected at
`/dev/mapper/<name>`. Verified end-to-end on the rig against the real
installed `cryptsetup` (2.7.5, Debian 13/trixie): `luksFormat` and `luksOpen`
with the passphrase piped over stdin, `mkfs.xfs` on the mapped device, lock
(`luksClose`)/unlock (reopen + remount) round-trip with data intact, and
adding a second recovery-passphrase key slot via `luksAddKey` — all clean.
This is the only path in v1's scope.

### Two other paths were considered and both are explicitly cut from v1

**"LUKS + rebuild" (format a spare disk with LUKS, then use Replace Disk to
let parity rebuild repopulate it) is not just deferred — it's unsound and
should never be built as described.** Read against `backend/src/nmd/
realClient.ts`'s `replaceDisk()`/`commitNewDisk()`: Replace Disk triggers a
raw, block-level parity reconstruction of the disk being replaced's own
former bytes onto the new device, with zero awareness of filesystems. Pre-
formatting the spare with a LUKS header first gains nothing — rebuild
overwrites it with the reconstructed **plaintext** content of the old disk.
The result is a plaintext disk that walked through a LUKS-branded wizard,
which is worse than not having the feature (false confidence that data got
encrypted when it didn't). Do not resurrect this without a fundamentally
different mechanism.

**Encrypt an existing disk's data in place (`cryptsetup reencrypt
--encrypt`) is structurally blocked, not merely unconfirmed — this is now
settled, not open.** Live-tested on the rig against the real installed
cryptsetup 2.7.5 (isolated loopback filesystem with known test data, not the
live array): the operation completes and produces a valid LUKS header, but
the underlying filesystem is destroyed (`mount: can't read superblock`).
`--reduce-device-size` (required whenever there's no detached header) only
preserves data if the filesystem was already shrunk to fit inside the
reduced size *before* the operation runs — cryptsetup says as much itself
("Encryption without detached header is not possible without data device
size reduction"). That shrink step is a supported dance for ext4/btrfs, but
**this app's own `formatDisk()` always formats new array disks as XFS, and
XFS has no shrink capability at all** (confirmed on the rig: no `xfs_shrink`
binary exists; `xfs_growfs` is grow-only). A detached header
(`--header <file>`, stored off-disk) would sidestep the shrink requirement,
but `nmdctl`'s own mount-time LUKS-open call (`tools/nmdctl:4364`) is
hardcoded to `cryptsetup luksOpen --key-file "$LUKS_KEYFILE" "$device"
"$diskname"` with no `--header` option — a detached-header disk would never
auto-mount through the driver's existing mechanism, defeating the "stored
keyfile, auto-unlock at boot" mode this whole feature depends on. Cutting
this from v1 is a settled decision, not to be revisited without new
evidence (e.g. a future `nmdctl` version that accepts a header path, or the
driver moving off XFS as its default).

**Future direction for "encrypt an existing disk's data" (explicitly out of
v1 scope):** evacuate, then treat the slot as a fresh blank disk. This app
already has a complete `backend/src/emptyDisk/` service that moves every
file off a slot onto the rest of the array (tracked job, respects share
configs). The chain would be: Empty Disk that slot → unassign it → add a
new LUKS-formatted disk into the same slot via the ordinary blank-disk-to-
LUKS flow above (the *add* path, not *replace* — parity treats it as a
genuinely new/cleared disk, not a reconstruction target) → optionally copy
the evacuated data back. Slower and more disruptive than a true in-place
conversion, but built entirely from mechanisms that already exist and are
already trustworthy. Left for a later iteration, not this branch.

## Backend surface (new)

- `backend/src/luks/` — thin wrapper around `cryptsetup`, using `spawn`/
  `spawnWithPipedStdin` from `system/procUtil.ts` (never `execFile` with a
  passphrase as an argv string). Operations: `format`, `open` (stdin-piped
  passphrase, or keyfile), `close`, `addKey`, `removeKey`, `status` (per
  device, via `cryptsetup status` / `blkid`).
- `backend/src/routes/luks.ts` — REST surface for the above. Gate anything
  that touches key material behind the same step-up re-auth popup already
  used for the SSH-keys manager in Settings > Security, rather than a new
  mechanism.
- `config.ts` — add `luksKeyfilePath` (default matches `nmdctl`'s own
  default, so nothing needs an explicit `-k` override unless changed).

## Frontend

- New per-disk state, threaded the same way `transport`/`isUsb` were added
  this session (`selectors/disks.ts` → `DiskViewModel` → `DiskCard`/
  `DiskDetailPanel`): `encryption: 'none' | 'luks-locked' | 'luks-open'`.
- Lock/unlock badge on `DiskCard`, matching the existing `· USB` tag pattern.
- Dashboard-level count of locked disks, prominent when > 0 (those disks
  can't serve data until unlocked).
- The format wizard itself (LUKS on/off choice → passphrase + recovery-
  passphrase display, on the existing per-disk Format action), and a
  "Change unlock method" flow for switching stored ⇄ manual.

## CLI (`nonraid-tool`)

Already a much richer command set than just `login`/`logout`/`version`
(commander-based, `cli/src/index.ts`, calls the webui API — not a direct
system tool) — `registerDiskCommand` etc. already exist. Added `luks`
subcommands the same way: `luks status`, `luks unlock <slot>` (prompts
interactively, never accepts the passphrase as a bare flag), `luks lock
<slot>`, `luks format <slot>` (blank-disk-to-LUKS only, per the v1 scope
above — by slot, not device path, since the LUKS device is always
deterministically `/dev/nmd<slot>p1`, matching nmdctl's own convention).

`format` is step-up gated server-side, which needs a real session cookie —
this CLI otherwise authenticates purely via a Bearer token (see
`cli/src/context.ts`), which `requireStepUp` doesn't accept (confirmed
against `backend/src/auth/service.ts`'s `requireSession`/`verifyStepUp`:
it's cookie-only, the same reason SSH key management was never exposed via
this CLI either). `luks format` reuses the same `passwordLogin`/`stepUpFetch`
helpers (`cli/src/api/sessionAuth.ts`) the `login` and `logout --revoke`
commands already use for their own step-up-gated calls, rather than
inventing a new mechanism — it prompts fresh for the admin's account
password (and a 2FA code only if the backend actually asks for one).

## Open questions — resolved

- ~~Does the installed `cryptsetup` version on target systems support
  `reencrypt --encrypt`?~~ **Resolved and moot**: 2.7.5 on the rig does
  support the flag syntactically, but it's structurally unusable against
  this app's XFS-formatted disks regardless of version — see above. Settled,
  not to be re-litigated without new evidence.
- ~~What happens to a share/mergerfs pool when one of its member disks is
  locked?~~ **Resolved by reading `shares/service.ts`**: `buildContext()`
  already excludes any disk without a mountpoint starting with `/` from
  every mergerfs branch — a locked LUKS disk (`filesystem.mountpoint ===
  "unmounted"`) is already handled identically to any other unmounted disk,
  with zero new code. A live single-disk lock/relock smoke test against the
  rig's actual mounted array was attempted but stopped short (stopping the
  live Docker daemon to free the mountpoint was correctly blocked as a
  disruptive action against a real host with a running workload); the
  mechanism this app already uses for the equivalent problem elsewhere —
  `unmountArrayWithContainerRetry`/`restoreStoppedContainers` in
  `backend/src/system/arrayLifecycle.ts`, which stops Docker/LXC and retries
  when a disk unmount is busy, then restores them — is the pattern the new
  single-disk lock operation should reuse (generalized to one mountpoint
  rather than all array disks), not something to reinvent.

## Still open

- Real-world LUKS overhead on a spinning disk — this app already has
  `benchmarkRead`/`benchmarkWrite` (`system/benchmark.ts`); run a real
  before/after once a LUKS disk exists on the rig. Not blocking for v1.
