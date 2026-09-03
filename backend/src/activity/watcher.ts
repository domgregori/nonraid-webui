import type { CacheHealth } from '../cache/types.js';
import type { CacheService } from '../cache/service.js';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { DiskStatus, NmdDisk } from '../nmd/types.js';
import type { NotificationEventType } from '../settings/notificationCatalog.js';
import { notifyEvent } from '../settings/notify.js';
import type { SettingsStore } from '../settings/store.js';
import type { SmartHealth, SmartService } from '../smart/index.js';
import { readCpuTempCelsius } from '../system/cpuTemp.js';
import type { ActivityStore } from './store.js';

// Statuses that mean something has actually gone wrong with an assigned
// disk. DISK_NP_DSBL (no disk present, disabled) is deliberately excluded -
// that's the normal resting state of a slot someone unassigned on purpose,
// which routes/disks.ts already logs at the point of the action.
const BAD_DISK_STATUSES = new Set<DiskStatus>(['DISK_INVALID', 'DISK_WRONG', 'DISK_DSBL', 'DISK_NP_MISSING', 'DISK_DSBL_NEW']);

function diskLabel(disk: NmdDisk): string {
  return disk.disk_name || (disk.device !== 'none' ? disk.device : `slot ${disk.slot}`);
}

/** Mirrors the frontend's selectors/disks.ts:diskNeedsFormat exactly - a data disk (never
 *  parity/Q) that's DISK_OK but has no recognized filesystem yet. "unknown" is nmdctl's own
 *  sentinel for that (see get_fs_type() in tools/nmdctl), not an error. */
function diskNeedsFormat(disk: NmdDisk): boolean {
  return disk.type !== 'P' && disk.type !== 'Q' && disk.status === 'DISK_OK' && (!disk.filesystem?.type || disk.filesystem.type === 'unknown');
}

interface DiskSnapshot {
  status: DiskStatus;
  errors: number;
}

/**
 * Polls state this project doesn't otherwise watch for changes worth
 * surfacing in the activity feed: a parity check finishing on its own (not
 * via an explicit user action, which routes/parity.ts already logs), a
 * disk's error count climbing or its status turning bad, and a disk's SMART
 * health flipping from passing to failing. Everything here is a *passive*
 * observation - it never issues driver commands, only reads status and logs.
 *
 * Same background-interval shape as SystemStatsService: a self-unref'd
 * timer so it never keeps the process alive on its own.
 */
export class ActivityWatcher {
  private timer: NodeJS.Timeout;

  // `null`/unset means "not observed yet" - the first tick after startup
  // seeds these without logging anything, so restarting the backend never
  // produces a wall of false "just changed" events for pre-existing state.
  private lastSyncTimestamp: number | null = null;
  private diskSnapshots = new Map<number, DiskSnapshot>();
  private healthSnapshots = new Map<string, SmartHealth | null>();
  // Keyed by 'cpu' or a disk device path - tracks whether that source was
  // already over the threshold, so a sustained high temp logs/notifies once
  // on the crossing rather than every tick.
  private overTemp = new Map<string, boolean>();
  private lastCacheHealth: CacheHealth | null = null;
  // undefined = not observed yet (seed silently, same reasoning as every other snapshot above);
  // null = confirmed not currently erroring.
  private lastErrorState: string | null | undefined = undefined;
  // Map, not a Set, so a slot's *first* observation can be seeded without logging - same
  // undefined-means-unseen idiom as diskSnapshots/healthSnapshots above. Holds the last
  // *confirmed* (i.e. already logged, or seeded) state - see needsFormatPending below for the
  // one-tick debounce sitting in front of it.
  private needsFormatSnapshots = new Map<number, boolean>();
  // Whether the *immediately preceding* tick also saw needsFormat === true for this slot, without
  // that having been confirmed/logged yet - see checkNeedsFormat's own doc comment for why this
  // exists. Cleared the instant a tick reads false again, so only the notify side is debounced,
  // never "back to normal".
  private needsFormatPending = new Map<number, boolean>();

  constructor(
    private nmd: NmdClient,
    private smart: SmartService,
    private activity: ActivityStore,
    private settings: SettingsStore,
    private cache: CacheService,
    intervalMs: number = config.activityWatcherIntervalMs,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    let status;
    try {
      status = await this.nmd.getStatus();
    } catch {
      return; // driver unreachable this round - try again next tick
    }

    this.checkArrayError(status.array.state);
    this.checkParitySync(status.array.last_sync, status.array.counters.sync_errors);
    this.checkDisks(status.disks);
    // Only meaningful while the array is started - nmdctl only reports a disk's real filesystem
    // type once it's actually mounted, so every disk looks "unformatted" while stopped regardless
    // of what's really on it. Skipping entirely (rather than just not logging) also keeps
    // needsFormatSnapshots from recording a false negative that would fire a bogus edge on the
    // next start.
    if (status.array.state === 'STARTED') this.checkNeedsFormat(status.disks);
    await this.checkSmartHealth(status.disks);
    await this.checkTemperatures(status.disks);
    await this.checkCacheMirror();
  }

  /** Edge-triggered on the array entering (or changing) an ERROR:* state - see isArrayError()'s
   *  own reasoning in selectors/status.ts for why this means something genuinely needs a look,
   *  not just a normal stopped/degraded array. Deliberately doesn't log on *recovery* (state
   *  leaving ERROR:*), same "only log getting worse" reasoning as checkCacheMirror below - the
   *  dashboard's own ArrayErrorCard disappearing already communicates that. */
  private checkArrayError(state: string): void {
    const prev = this.lastErrorState;
    const isError = state.startsWith('ERROR:');
    this.lastErrorState = isError ? state : null;
    if (prev === undefined) return; // first tick - seed only, don't log pre-existing state

    if (isError && state !== prev) {
      const text = `Array error: ${state}`;
      this.activity.log(text, 'red', 'arrayError').catch(() => {});
      notifyEvent(this.settings, 'arrayError', 'NonRAID: array error', text);
    }
  }

  /**
   * Edge-triggered per slot, same seed-then-diff idiom as checkDisks above, plus a one-tick
   * debounce in front of the actual notify: needsFormat has to read true on two *consecutive*
   * ticks before this logs anything. The `status.array.state === 'STARTED'` gate in tick() above
   * only rules out the obvious case (every disk looks unformatted while the array itself is
   * stopped) - it doesn't cover a narrower race where the array as a whole is already STARTED but
   * one specific disk is still a beat behind on actually being mounted/probed, which can read as
   * blank/unknown filesystem for exactly one poll tick even though the disk is, and always was,
   * completely fine. Confirmed live: a real false alarm on a healthy, mounted, 36%-full XFS disk,
   * traced to this exact race around a backend restart. A genuinely unformatted disk stays
   * unformatted on every subsequent tick regardless, so this only ever delays a real notification
   * by one tick (activityWatcherIntervalMs, 30s by default) - it doesn't risk ever missing one.
   *
   * Only logs a slot newly *needing* format - a slot that gets formatted (leaves the set) is
   * silent, same no-recovery-event reasoning as checkCacheMirror.
   */
  private checkNeedsFormat(disks: NmdDisk[]): void {
    for (const disk of disks) {
      const needsFormat = diskNeedsFormat(disk);

      if (!needsFormat) {
        // Recovered (or never was a problem) - clear immediately. Only the rising edge needs to
        // survive two ticks; going back to "fine" is trusted the instant it's observed.
        this.needsFormatPending.set(disk.slot, false);
        this.needsFormatSnapshots.set(disk.slot, false);
        continue;
      }

      const prevConfirmed = this.needsFormatSnapshots.get(disk.slot);
      if (prevConfirmed === undefined) {
        // first observation of this slot ever - seed only, same as before debouncing existed.
        this.needsFormatSnapshots.set(disk.slot, true);
        continue;
      }
      if (prevConfirmed) continue; // already confirmed and logged - nothing new

      if (this.needsFormatPending.get(disk.slot)) {
        // True on this tick *and* the immediately preceding one - confirmed, not a blip.
        this.needsFormatSnapshots.set(disk.slot, true);
        this.needsFormatPending.set(disk.slot, false);
        const text = `Disk ${disk.slot} (${diskLabel(disk)}) needs formatting - no filesystem detected`;
        this.activity.log(text, 'amber', 'diskNeedsFormat').catch(() => {});
        notifyEvent(this.settings, 'diskNeedsFormat', 'NonRAID: disk needs formatting', text);
      } else {
        this.needsFormatPending.set(disk.slot, true);
      }
    }
  }

  /**
   * Same seed-silently-then-diff idiom as checkSmartHealth - only fires on a transition to a
   * *worse* state (healthy -> degraded/unavailable, degraded -> unavailable), not on every tick a
   * degraded mirror stays degraded, and not on recovery (no "cacheMirrorHealthy" event exists -
   * the Dashboard/Disks page already show recovery the moment it happens, same reasoning
   * notificationCatalog.ts gives for keeping this scoped to passive health events).
   */
  private async checkCacheMirror(): Promise<void> {
    let status;
    try {
      status = await this.cache.getStatus();
    } catch {
      return; // unreachable this round - try again next tick
    }

    const prev = this.lastCacheHealth;
    this.lastCacheHealth = status.health;
    if (prev === null || prev === status.health || status.health === 'not-configured') return;

    const gotWorse =
      (prev === 'healthy' && (status.health === 'degraded' || status.health === 'unavailable')) ||
      (prev === 'degraded' && status.health === 'unavailable');
    if (!gotWorse) return;

    const text =
      status.health === 'unavailable'
        ? 'Cache mirror is unavailable - both members appear to be missing or unmountable.'
        : 'Cache mirror is degraded - one member is missing. It still works with zero redundancy until replaced.';
    this.activity.log(text, 'red', 'cacheMirrorDegraded').catch(() => {});
    notifyEvent(this.settings, 'cacheMirrorDegraded', 'NonRAID: cache mirror degraded', text);
  }

  private checkParitySync(lastSync: { timestamp: number; status: string }, syncErrors: number): void {
    const seen = this.lastSyncTimestamp;
    this.lastSyncTimestamp = lastSync.timestamp;

    if (seen === null || lastSync.timestamp === seen || lastSync.timestamp === 0) return;

    if (lastSync.status === 'errors') {
      const text = `Parity check finished with ${syncErrors} sync error${syncErrors === 1 ? '' : 's'}`;
      this.activity.log(text, 'red', 'parityErrors').catch(() => {});
      notifyEvent(this.settings, 'parityErrors', 'NonRAID: parity errors', text);
    } else if (lastSync.status === 'completed') {
      this.activity.log('Parity check finished with no errors', 'green', 'parityCompleted').catch(() => {});
      notifyEvent(this.settings, 'parityCompleted', 'NonRAID: parity check complete', 'Parity check finished with no errors');
    }
  }

  private checkDisks(disks: NmdDisk[]): void {
    for (const disk of disks) {
      const prev = this.diskSnapshots.get(disk.slot);
      this.diskSnapshots.set(disk.slot, { status: disk.status, errors: disk.errors });
      if (!prev) continue; // first observation of this slot - seed only

      if (disk.errors > prev.errors) {
        const text = `Disk ${disk.slot} (${diskLabel(disk)}) reported new errors - total now ${disk.errors}`;
        this.activity.log(text, 'red', 'diskErrors').catch(() => {});
        notifyEvent(this.settings, 'diskErrors', 'NonRAID: disk errors', text);
        continue; // one log line per tick per disk is plenty
      }

      const wasBad = BAD_DISK_STATUSES.has(prev.status);
      const isBad = BAD_DISK_STATUSES.has(disk.status);
      if (isBad && !wasBad) {
        const text = `Disk ${disk.slot} (${diskLabel(disk)}) status changed to ${disk.status}`;
        this.activity.log(text, 'red', 'diskFailed').catch(() => {});
        notifyEvent(this.settings, 'diskFailed', 'NonRAID: disk failed', text);
      }
    }
  }

  private async checkSmartHealth(disks: NmdDisk[]): Promise<void> {
    const devices = disks.filter((d) => d.device && d.device !== 'none').map((d) => d.device);
    if (devices.length === 0) return;

    let healths: Record<string, SmartHealth | null>;
    try {
      healths = await this.smart.getHealthStatuses(devices);
    } catch {
      return; // SMART unreachable this round - try again next tick
    }

    for (const disk of disks) {
      if (!disk.device || disk.device === 'none') continue;
      const health = healths[disk.device] ?? null;
      const prev = this.healthSnapshots.has(disk.device) ? this.healthSnapshots.get(disk.device) : undefined;
      this.healthSnapshots.set(disk.device, health);

      if (prev === 'passed' && health === 'failed') {
        const text = `SMART health check failed for disk ${disk.slot} (${diskLabel(disk)})`;
        this.activity.log(text, 'red', 'smartFailed').catch(() => {});
        notifyEvent(this.settings, 'smartFailed', 'NonRAID: SMART health failed', text);
      }
    }
  }

  private checkOneTemp(key: string, label: string, celsius: number | null, threshold: number, eventType: NotificationEventType): void {
    if (celsius === null) return;
    const wasOver = this.overTemp.get(key) ?? false;
    const isOver = celsius >= threshold;
    this.overTemp.set(key, isOver);
    if (isOver && !wasOver) {
      const text = `${label} temperature is ${Math.round(celsius)}°C, at or above the ${threshold}°C alert threshold`;
      this.activity.log(text, 'amber', eventType).catch(() => {});
      notifyEvent(this.settings, eventType, 'NonRAID: temperature alert', text);
    }
  }

  private async checkTemperatures(disks: NmdDisk[]): Promise<void> {
    const settings = await this.settings.get();
    // Deliberately no separate "is temp watching on" gate - this always evaluates, same as every
    // other monitored condition here (parity, SMART, etc). notifyEvent's own eventTypes.tempAlertCpu/
    // tempAlertDisk checks are the on/off switches, matching how every other event in the catalog works.
    const { cpuWarnAboveCelsius, diskWarnAboveCelsius } = settings.tempAlerts;

    this.checkOneTemp('cpu', 'CPU', readCpuTempCelsius(), cpuWarnAboveCelsius, 'tempAlertCpu');

    const devices = disks.filter((d) => d.device && d.device !== 'none').map((d) => d.device);
    if (devices.length === 0) return;
    let temps: Record<string, number | null>;
    try {
      temps = await this.smart.getTemperatures(devices);
    } catch {
      return; // SMART unreachable this round - try again next tick
    }
    for (const disk of disks) {
      if (!disk.device || disk.device === 'none') continue;
      this.checkOneTemp(disk.device, `Disk ${disk.slot} (${diskLabel(disk)})`, temps[disk.device] ?? null, diskWarnAboveCelsius, 'tempAlertDisk');
    }
  }
}
