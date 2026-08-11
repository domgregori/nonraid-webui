import { COLORS, tint } from '../styles/colors';
import type { NmdDisk, NmdStatusResponse } from '../types/nmdApi';

// Per-slot explanation shown in the "why is the array degraded" dialog — keyed on the driver's own
// raw disk status string. Deliberately not the same wording as selectors/disks.ts's short
// STATUS_LABELS chips — these need to explain the problem and hint at the fix, not just name it.
const DISK_ISSUE_DETAIL: Partial<Record<string, { title: string; detail: string }>> = {
  DISK_NP_MISSING: {
    title: 'Missing',
    detail: 'Not present. Data is being emulated live from parity. Replace the disk to rebuild it and restore full protection.',
  },
  DISK_DSBL: {
    title: 'Disabled',
    detail: 'Dropped from the array, usually after a write error. Data is emulated from parity. Replace the disk to rebuild it.',
  },
  DISK_NP_DSBL: {
    title: 'Disabled, unassigned',
    detail: 'Unassigned, and the array has started since — its identity is cleared. Add a disk to this slot to rebuild, or remove the slot from the array.',
  },
  DISK_INVALID: {
    title: 'Invalid',
    detail: "Doesn't match what this slot expects (wrong size or identity). Reconnect the correct disk, or replace it if it's meant to be new.",
  },
  DISK_WRONG: {
    title: 'Wrong disk',
    detail: 'A different disk than expected is connected to this slot. Reconnect the correct disk, or replace it.',
  },
  DISK_NEW: { title: 'New', detail: "Not yet part of the array. It needs to clear before it's fully in." },
  DISK_DSBL_NEW: { title: 'New, disabled', detail: "Added but currently disabled. It needs to clear before it's fully in." },
};

export interface DegradedReason {
  key: string;
  title: string;
  detail: string;
  /** Set when this reason points at one disk — the dialog offers a "View Disk" button using this. */
  diskId?: string;
  /** Set when the fix is a correcting parity check — the dialog offers a "Start" button for it. */
  startParityCheck?: boolean;
}

// resync.action is a raw driver token like "recon D1" (rebuilding data slot 1), "recon P"/"recon Q"
// (rebuilding a parity disk), or "clear D1" (zeroing a newly-added disk before it joins) — confirmed
// against tools/nmdctl's format_resync_action(). Matched here so a disk mid-rebuild, which reports a
// transient DISK_INVALID/DISK_NEW status until the rebuild finishes, isn't reported as if it were a
// real problem needing reconnection — confirmed live: adding a fresh disk to fill a missing slot
// shows exactly this transient DISK_INVALID state for the whole rebuild.
function isResyncTarget(status: NmdStatusResponse, disk: NmdDisk): boolean {
  if (!status.resync.active) return false;
  const match = status.resync.action.trim().match(/^(?:recon|clear)\s+(D(\d+)|P|Q)$/);
  if (!match) return false;
  if (match[2]) return disk.type !== 'P' && disk.type !== 'Q' && disk.slot === Number(match[2]);
  return disk.type === match[1];
}

/**
 * Explains, per-cause, why isDegraded() is currently true — read directly from per-disk status and
 * array counters rather than the driver's own `health.details` string, since that string bundles in
 * the harmless stale-counter noise isPhantomDegradedGlitch works around (see its own comment) and
 * isn't actionable UI copy anyway.
 */
export function deriveDegradedReasons(status: NmdStatusResponse): DegradedReason[] {
  const reasons: DegradedReason[] = [];
  let rebuildingLabel: string | null = null;

  for (const disk of status.disks) {
    const label = disk.type === 'P' ? 'Parity 1' : disk.type === 'Q' ? 'Parity 2' : `Disk ${disk.slot}`;
    if (isResyncTarget(status, disk)) {
      rebuildingLabel = label;
      continue;
    }
    if (disk.status !== 'DISK_OK') {
      const known = DISK_ISSUE_DETAIL[disk.status];
      reasons.push({
        key: `disk-${disk.slot}`,
        title: `${label}: ${known?.title ?? disk.status}`,
        detail: known?.detail ?? 'This disk is in an abnormal state.',
        diskId: String(disk.slot),
      });
    } else if (disk.errors > 0) {
      reasons.push({
        key: `disk-errors-${disk.slot}`,
        title: `${label}: ${disk.errors} I/O error${disk.errors === 1 ? '' : 's'} logged`,
        detail: 'Still active, but has recorded read/write errors. Worth checking its SMART health.',
        diskId: String(disk.slot),
      });
    }
  }

  const { sync_errors } = status.array.counters;
  if (sync_errors > 0) {
    reasons.push({
      key: 'sync-errors',
      title: `Parity out of sync — ${sync_errors} error${sync_errors === 1 ? '' : 's'} found`,
      detail: "The last parity check found data that doesn't match parity. Run a correcting check to fix it.",
      startParityCheck: true,
    });
  }

  if (rebuildingLabel) {
    reasons.push({
      key: 'rebuilding',
      title: `Rebuilding ${rebuildingLabel} from parity`,
      detail: `In progress — ${Math.round(status.resync.progress_percent)}% complete. The array stays degraded until this finishes.`,
    });
  }

  // Shouldn't normally happen (every counter that can make isDegraded() true is covered above),
  // but falls back to the driver's own message rather than showing an empty dialog if it ever does.
  if (reasons.length === 0 && status.array.health.details) {
    reasons.push({ key: 'unknown', title: 'Array reports degraded', detail: status.array.health.details });
  }

  return reasons;
}

/**
 * The driver's own health.status/counters aren't trustworthy as ground truth for whether the array
 * actually has a problem — confirmed two different ways live: a single-parity array's unused
 * second-parity (Q) slot is permanently counted as "invalid" + "disabled" (nmdctl's own status
 * output even warns "Driver internal state is inconsistent ... but all individual disks are
 * DISK_OK status"), and separately, a plain Unassign-then-Restore-before-Start cycle (2026-08-11)
 * left counters.missing stuck at 1 with every disk genuinely DISK_OK afterward — no Add Disk or
 * repeat-slot involved, just stale internal state Reload Driver clears. Per-disk status/errors and
 * sync_errors are what the rest of deriveDegradedReasons() below keys off, so trust those instead:
 * if every disk is DISK_OK with zero logged errors and there are no recorded parity mismatches,
 * there's no real problem, regardless of what the aggregate counters claim. A disk that's genuinely
 * missing, wrong, invalid, etc. always reports a non-DISK_OK status of its own, and a disk with
 * logged I/O errors always has `errors > 0` even while still DISK_OK, so neither can be masked here
 * — confirmed via a fixture check, 2026-08-11 (an inherited gap from this function's predecessor,
 * not introduced by the generalization above: a `DISK_OK` disk with `errors > 0` was already being
 * swallowed as a phantom glitch even though deriveDegradedReasons() below has always had a correct,
 * separate branch for exactly this case — it just never got a chance to run).
 */
function isPhantomDegradedGlitch(status: NmdStatusResponse): boolean {
  return (
    status.array.counters.sync_errors === 0 &&
    status.disks.every((d) => d.status === 'DISK_OK' && d.errors === 0)
  );
}

export function isDegraded(status: NmdStatusResponse): boolean {
  if (status.array.health.status !== 'DEGRADED') return false;
  return !isPhantomDegradedGlitch(status);
}

// The kernel driver itself bakes this prefix into the state name for the
// handful of states that mean something needs a human look (confirmed
// against md_unraid.c this session — TOO_MANY_MISSING_DISKS,
// INVALID_EXPANSION, PARITY_NOT_BIGGEST, NEW_DISK_TOO_SMALL, NO_DATA_DISKS —
// every other abnormal state doesn't carry it). Distinct from DEGRADED:
// this means the array likely isn't even running right now, not just
// running with reduced protection.
export function isArrayError(status: NmdStatusResponse): boolean {
  return status.array.state.startsWith('ERROR:');
}

export function deriveArrayStatus(status: NmdStatusResponse | null) {
  if (!status) return { text: 'LOADING', color: COLORS.textDim, pillBg: tint(COLORS.textDim, 14) };

  const arrayStarted = status.array.state === 'STARTED';
  let text: string;
  let color: string;
  if (isArrayError(status)) {
    text = 'ERROR';
    color = COLORS.red;
  } else if (!arrayStarted) {
    text = 'STOPPED';
    color = COLORS.textDim;
  } else if (isDegraded(status)) {
    text = 'DEGRADED';
    color = COLORS.red;
  } else if (status.resync.active) {
    text = 'PARITY CHECK';
    color = COLORS.amber;
  } else {
    text = 'STARTED';
    color = COLORS.green;
  }
  return { text, color, pillBg: tint(color, 14) };
}

export function deriveProtection(status: NmdStatusResponse | null) {
  if (!status) return { short: '—', color: COLORS.textDim, text: 'Loading array status…' };

  const arrayStarted = status.array.state === 'STARTED';
  if (!arrayStarted) {
    return { short: 'Stopped', color: COLORS.textDim, text: 'Array stopped — all disks unmounted.' };
  }

  if (isDegraded(status)) {
    const missing = status.array.counters.missing;
    return {
      short: 'Degraded',
      color: COLORS.red,
      text:
        status.array.health.details ||
        `${missing} disk${missing === 1 ? '' : 's'} missing. Data is emulated from parity — replace the disk to restore full protection.`,
    };
  }

  const { has_parity, has_second_parity } = status.array.size;
  if (has_second_parity) {
    return { short: 'Dual Parity', color: COLORS.green, text: 'Both parity disks active — array can survive up to two simultaneous disk failures.' };
  }
  if (has_parity) {
    return { short: 'Single Parity', color: COLORS.green, text: 'Parity disk active — array can survive one disk failure.' };
  }
  return { short: 'No Parity', color: COLORS.amber, text: 'No parity disk assigned — a disk failure means data loss.' };
}

export function deriveToggleButton(status: NmdStatusResponse | null) {
  const arrayStarted = status?.array.state === 'STARTED';
  const label = arrayStarted ? 'Stop Array' : 'Start Array';
  const bg = arrayStarted ? tint(COLORS.red, 15) : COLORS.green;
  const fg = arrayStarted ? COLORS.red : COLORS.bg;
  const border = arrayStarted ? COLORS.red : COLORS.green;
  return { label, bg, fg, border };
}
