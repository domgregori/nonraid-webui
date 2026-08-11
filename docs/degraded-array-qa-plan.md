# QA plan: degraded-array diagnosis and fix

## Purpose

Test the DEGRADED pill's dialog (`ArrayHealthDialog.tsx`, reasons from
`deriveDegradedReasons` in `selectors/status.ts`) against every real cause the
driver can report. For each cause, confirm two things:

1. The dialog names the real cause in plain words, and does not show a false
   "problem" for a disk that is only mid-rebuild.
2. An admin can take the array from degraded back to healthy using only the
   web UI — no SSH, no `nmdctl` command line.

Run on the real rig (`nonraid@nonraid.lan`), not the VM — SMART data, real
disk swaps, and real rebuild timing only exist there.

## Ground rules

- **Standing authorization**: this rig is a permanent test fixture. Unassign,
  reformat, wipe, or otherwise break disks on it freely — no per-action
  confirmation needed.
- **"UI-only" applies to the fix, not always the setup.** Some broken states
  (a truly missing disk, out-of-sync parity) can be set up through the UI
  itself. Others (a disk the driver auto-disabled after a write error) are
  hard to produce honestly without hardware failure. Where the setup step
  needs SSH, it's called out — but the **fix** must always be driven from the
  dialog and the panels it links to, nothing else.
- **One scenario at a time.** Bring the array back to fully healthy (pill
  green, no dialog reachable) before starting the next scenario, so a
  leftover reason from a prior test can't mask or fake out the next one.
- **Record actual dialog text**, not just pass/fail — copy wording verbatim
  into the result so a wording regression is as visible as a logic one.

## Baseline check (run first, and again at the end)

1. Array started, every disk `DISK_OK`, no resync active.
2. Pill reads STARTED (green), and is a disabled button — clicking it does
   nothing.
3. Confirm the phantom second-parity placeholder never leaks through: this
   rig has no second parity disk, so the driver's `health.status` is
   permanently `DEGRADED` with `Invalid: 1` baked in
   (`isPhantomSecondParityGlitch` in `selectors/status.ts` exists to hide
   exactly this). The pill must still read STARTED, not DEGRADED, in this
   state. If it ever reads DEGRADED with nothing else wrong, that's a
   regression in the phantom-glitch check, not a real disk problem — do not
   "fix" it by touching disks; fix the selector.

---

## Scenario 1 — Missing / unassigned data disk

**Status**: already exercised live this session (the real Disk 1 fault on
this rig). Re-run once as a clean confirmation pass after baseline.

**Setup** (UI): Disks page → open a data disk → Unassign Disk → Start Array
(with the slot left empty). The disk commits as unassigned;
`DISK_NP_DSBL`, not restorable.

**Expected dialog**: one reason, `"Disk N: Disabled, unassigned"`, with a
View Disk button. Wording should mention adding a disk to rebuild or
removing the slot — not "reconnect", since there's nothing to reconnect.

**UI-only fix**:
1. Click DEGRADED pill → reason card → View Disk (or navigate directly).
2. Try **Replace Disk** first — confirm it correctly refuses
   ("Slot N is empty — use Add Disk instead") rather than silently doing the
   wrong thing. This is a real backend guard; the dialog doesn't call it out,
   so confirm the disk panel's own error message is enough to redirect a
   user who tries the "wrong" button.
3. Stop the array (Header → Stop Array). If a service is holding a disk busy
   (Docker's storage lived on the array disk when this was first hit —
   Settings → Services → Docker → Stop first), confirm the array actually
   reaches STOPPED before continuing.
4. Disks page → Unassigned Devices → Add to Array → set target slot to the
   empty slot number → Add Disk.
5. Confirm the array auto-starts and a rebuild begins.

**Mid-rebuild check** (this is the regression this session's last fix
covers): while rebuilding, reopen the DEGRADED dialog. Expect exactly one
reason, `"Rebuilding Disk N from parity"`, with live progress percent — **not**
`"Disk N: Invalid"` or any wording implying the disk needs reconnecting.

**Pass**: dialog reason text before the fix names the real problem; the fix
completes fully from UI panels already on screen; mid-rebuild reason reads
as progress, not as a problem; once the rebuild finishes, pill returns to
STARTED and the disk card shows Active + SMART OK.

Also worth one repeat of steps 1–5 using **Replace Disk** instead of Add
Disk (start from a disk that still has a stale identity in the slot, e.g.
right after Unassign but before a Start commits it) — confirms
`isResyncTarget`'s regex matches a replace-triggered rebuild the same as an
add-triggered one, since both produce the same `"recon D<N>"` resync action.

**Found live, 2026-08-11**: re-adding the *same* disk back into the *same*
slot it was just unassigned from (as opposed to a genuinely different spare
disk) can put the array into `ERROR:TOO_MANY_MISSING_DISKS` — worse than
DEGRADED, and outside `ArrayHealthDialog`'s scope by design (it only
activates on DEGRADED). Reproduced twice: first attempt errored, `Settings`
→ `Array` → `Reload Driver` (or the dashboard's own `Array error` banner,
which offers the same action inline) recovered it cleanly back to the
expected DEGRADED baseline, and the identical Add Disk steps then succeeded
on retry. Root cause not confirmed (driver-side stale-counter timing, per
Reload Driver's own doc comment in `SettingsPage.tsx`), but the recovery
path is real and UI-only. Not filed as a bug against this feature — the
dashboard's existing `ArrayErrorBanner` already exists specifically for
this class of problem — but worth a scenario of its own if `ERROR`-state
diagnosis ever gets the same dialog treatment DEGRADED just got.

---

## Scenario 2 — Parity out of sync (the original motivating case)

This is the scenario that started the whole feature — "if a parity check is
needed, have a button to start it." Test it thoroughly.

**Setup** (needs SSH — there's no UI action that corrupts on-disk data on
purpose): pick a data disk with a comfortable amount of free space. Write a
small amount of garbage into free space on the underlying block device,
*below the filesystem*, so no file is corrupted, only parity is now wrong for
those blocks:
```
ssh nonraid@nonraid.lan
sudo dd if=/dev/urandom of=/dev/<data-disk-partition> bs=1M seek=<far past used data> count=4 conv=notrunc
```
Confirm the target offset is well past `df`'s reported used space on that
disk first, so nothing real is at risk.

Then, from the UI, run a **non-correcting** check
(`nmdApi.parityCheck('NOCORRECT')` — exposed wherever the Parity page offers
a check-only option) so the mismatch is recorded without being silently
auto-fixed in the same run. If the UI only exposes a single "Start Parity
Check" that always corrects, use that instead and treat this scenario as
"sync errors appear only transiently mid-run" rather than a settled degraded
state — note which is actually true in the result.

**Expected dialog**: `"Parity out of sync — N error(s) found"`, with a
**Start Correcting Parity Check** button.

**UI-only fix**:
1. Click the button in the dialog.
2. Confirm it disables/relabels to "Starting…" then the dialog's own text
   swaps to "A parity check is already running" once `resync.active` flips
   true — don't need to leave and re-enter the dialog for this to update.
3. Let the correcting check finish (or confirm progress is visible on the
   Parity Check card while the dialog stays reachable).

**Pass**: the exact button described when this feature was requested exists,
is reachable from the dialog with no extra navigation, and the same
`parityAction('CORRECT')` call already used by the dashboard's own Parity
Check card is what fires — confirm by watching the Parity Check card update
in lockstep with the dialog's button state.

---

## Scenario 3 — Multiple simultaneous reasons

**Setup**: combine two already-tested scenarios — e.g. leave one data disk
unassigned (Scenario 1's setup) and separately induce sync errors on a
different disk (Scenario 2's setup) before starting the array.

**Expected dialog**: both reasons listed as separate cards, each with its
own action (View Disk vs Start Correcting Parity Check) — not merged, not
only the first one shown.

**UI-only fix**: resolve one reason fully, reopen the dialog, confirm only
the remaining reason still shows, then resolve that one too.

**Pass**: reason list is additive and independent; fixing one doesn't hide
or block fixing the other; dialog always reflects current live state on
reopen.

---

## Scenario 4 — I/O errors on an otherwise-healthy disk

**Setup**: hard to induce honestly without real media damage, which is out
of proportion even under standing destructive-authorization (that covers
unassign/reformat/wipe, not deliberately degrading disk hardware). Two
options, in order of preference:
- Skip live triggering; instead verify by temporarily pointing
  `deriveDegradedReasons` at a hand-built `NmdStatusResponse` fixture with a
  `DISK_OK` disk that has `errors > 0`, either in a quick throwaway unit
  test or a REPL-style check — confirm the reason text
  (`"Disk N: M I/O error(s) logged"`) and that it does **not** also trip the
  DISK_ISSUE_DETAIL branch (status is still `DISK_OK`, only the `errors`
  branch should fire).
- If a spare disk can be sacrificed, a `dmsetup` error-injection target
  (`dmsetup create baddisk --table "0 <sectors> error"`) presented to the
  array in place of a real device would produce genuine I/O errors without
  touching real media — optional stretch goal, not required for this pass.

**Pass**: reason text confirmed correct by one of the above; note in the
result which method was used, since this scenario doesn't get a live rig
confirmation by default.

---

## Deferred / lower priority

These are real `DISK_ISSUE_DETAIL` branches but need either physical disk
swaps or an array topology change to trigger honestly. Note their expected
behavior from code review now; schedule a live pass only if a session with
physical access to the rig's drive bays is already happening for other
reasons.

- **Wrong disk** (`DISK_WRONG`) — needs physically swapping which disk is
  connected to which slot's cable/port without telling the array first.
- **Invalid disk, non-rebuild cause** (`DISK_INVALID` while `resync.active`
  is false) — needs a disk that's a genuine size/identity mismatch for its
  slot, not just a disk mid-rebuild (which this session already covers).
- **Parity-slot rebuild** (`resync.action` = `"recon P"`) — same code path
  as Scenario 1's mid-rebuild check, just targeting the parity disk instead
  of a data disk. Confirmed identical logic by reading `isResyncTarget`, but
  a live pass would take as long as a full parity rebuild (~1h+ on this
  rig's parity disk) — worth doing once, not every pass.
- **New-disk clear** (`resync.action` = `"clear D<N>"`) — needs an actual
  new, never-before-seen disk added to a brand-new slot (not a slot that was
  previously assigned), which needs expanding `total_slots` first. Lower
  priority since the regex match is identical to the `"recon"` case already
  tested.

## Result log

Track each scenario as: date run, pass/fail, exact dialog text observed, and
any deviation from what's described above. Keep this at the bottom of this
file rather than a separate tracker, so the plan and its results never drift
apart.

### 2026-08-11

- **Baseline check**: PASS. Pill read STARTED (green) despite the
  permanent "Invalid: 1" placeholder noise (`health.details`), confirming
  `isPhantomSecondParityGlitch` correctly suppresses it.
- **Scenario 1, Add Disk path (Disk 1, PNY SSD, fresh identity)**: PASS.
  Dialog: `"Disk 1: Disabled, unassigned"` / *"Unassigned, and the array has
  started since — its identity is cleared. Add a disk to this slot to
  rebuild, or remove the slot from the array."* Replace Disk correctly
  refused with `"Slot 1 is empty — use Add Disk instead."`. Add Disk via
  Unassigned Devices succeeded once the array was stopped first (`"Stop the
  array before adding a disk."` guard fired once, exactly as expected).
  Mid-rebuild dialog correctly read `"Rebuilding Disk 1 from parity"`, not
  a false problem.
- **Scenario 1, Add Disk path (Disk 3, same disk back into its old slot)**:
  PASS, after one recoverable `ERROR:TOO_MANY_MISSING_DISKS` detour — see
  the "Found live" note above. Dialog on the settled DEGRADED state:
  `"Disk 3: Disabled, unassigned"`, identical wording to Disk 1's case.
  Reload Driver (UI-only, via the dashboard's `Array error` banner)
  recovered it; the same Add Disk steps then succeeded and the mid-rebuild
  dialog again correctly read `"Rebuilding Disk 3 from parity"`.
- **Scenario 1, Replace Disk repeat**: PASS, but hardware-limited. Unassigned
  Disk 1 (array stopped), then clicked Replace Disk while its identity was
  still stale/uncommitted. The picker correctly refused to offer Disk 1's own
  device back to itself: `"No unclaimed devices found yet."` — this rig has
  no spare physical disk, so a genuine replacement can't be exercised
  honestly here. Reverted via Restore This Disk. Confirms the picker's guard
  (never offer a device that still claims an existing identity) works, but a
  real rebuild-via-Replace pass needs a spare disk on hand — not done this
  session.
- **New finding, stale `missing` counter after Unassign→Restore→Start (not a
  planned scenario — hit incidentally)**: Unassign Disk 1 → Restore This Disk
  (before ever starting the array, so the identity was never actually lost)
  → Start Array. Every disk came back `DISK_OK` (confirmed via
  `GET /api/status`), but the pill still read **DEGRADED**, and the dialog
  showed the generic fallback verbatim: *"Array reports degraded / Missing:
  1, Invalid: 1, Disabled: 1"* — no per-disk reason, no button, no hint that
  Reload Driver fixes it.
  Root cause, confirmed by reading `selectors/status.ts`: `isDegraded()`
  checks `counters.missing > 0` *before* consulting
  `isPhantomSecondParityGlitch()` — a real missing disk should always win,
  but that means a **stale** `missing` counter (no disk actually missing)
  can't be suppressed the way the permanent `Invalid:1`/`Disabled:1` noise
  already is. `deriveDegradedReasons()` then finds no disk with
  `status !== 'DISK_OK'` to explain it and falls through to the unhelpful
  generic branch.
  **Fix, UI-only**: Settings → Array → Reload Driver, no Docker/LXC running
  so no need for its "stop containers first" checkbox. Result banner:
  *"Driver reloaded and 4 disk(s) re-imported with their existing identities
  — the array's configuration didn't change."* Pill returned to STARTED;
  `GET /api/status` afterward showed `health.status: "HEALTHY"`,
  every counter 0 (even the normally-permanent `Invalid:1` cleared).
  Same underlying driver-side stale-counter class already noted above for
  re-adding a disk into its old slot (`ERROR:TOO_MANY_MISSING_DISKS`), but
  this is a distinct trigger (no Add Disk needed, just Unassign→Restore) and
  a distinct symptom (DEGRADED with a dead-end dialog, not ERROR with a
  banner that already offers the fix inline).
  **Fixed in code same session**: `isPhantomSecondParityGlitch()` replaced
  with a broader `isPhantomDegradedGlitch()` in `selectors/status.ts` —
  trusts per-disk `status` (and `sync_errors`) as ground truth over the
  aggregate counters generally, instead of special-casing only the
  second-parity placeholder pattern. `isDegraded()`'s separate
  `counters.missing > 0` hard-return-true fast path was removed; a genuinely
  missing disk still can't be masked, since that disk's own `status` is
  never `DISK_OK`. **Verified live**: repeated the exact same
  Unassign→Restore→Start repro after deploying the fix —
  `GET /api/status` showed the identical stale state
  (`health.status: "DEGRADED"`, `counters.missing: 1`, every disk
  `DISK_OK`), but the pill now correctly read STARTED, not DEGRADED.
  Cleaned up with Reload Driver afterward to clear the stale counter for
  real before continuing.
- **Scenarios 2–4**: not yet run.
