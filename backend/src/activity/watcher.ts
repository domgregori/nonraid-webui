import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { DiskStatus, NmdDisk } from '../nmd/types.js';
import { sendAppriseNotification } from '../settings/notify.js';
import type { SettingsStore } from '../settings/store.js';
import type { SmartHealth, SmartService } from '../smart/index.js';
import { readCpuTempCelsius } from '../system/cpuTemp.js';
import type { ActivityStore } from './store.js';

// Statuses that mean something has actually gone wrong with an assigned
// disk. DISK_NP_DSBL (no disk present, disabled) is deliberately excluded —
// that's the normal resting state of a slot someone unassigned on purpose,
// which routes/disks.ts already logs at the point of the action.
const BAD_DISK_STATUSES = new Set<DiskStatus>(['DISK_INVALID', 'DISK_WRONG', 'DISK_DSBL', 'DISK_NP_MISSING', 'DISK_DSBL_NEW']);

function diskLabel(disk: NmdDisk): string {
  return disk.disk_name || (disk.device !== 'none' ? disk.device : `slot ${disk.slot}`);
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
 * observation — it never issues driver commands, only reads status and logs.
 *
 * Same background-interval shape as SystemStatsService: a self-unref'd
 * timer so it never keeps the process alive on its own.
 */
export class ActivityWatcher {
  private timer: NodeJS.Timeout;

  // `null`/unset means "not observed yet" — the first tick after startup
  // seeds these without logging anything, so restarting the backend never
  // produces a wall of false "just changed" events for pre-existing state.
  private lastSyncTimestamp: number | null = null;
  private diskSnapshots = new Map<number, DiskSnapshot>();
  private healthSnapshots = new Map<string, SmartHealth | null>();
  // Keyed by 'cpu' or a disk device path — tracks whether that source was
  // already over the threshold, so a sustained high temp logs/notifies once
  // on the crossing rather than every tick.
  private overTemp = new Map<string, boolean>();

  constructor(
    private nmd: NmdClient,
    private smart: SmartService,
    private activity: ActivityStore,
    private settings: SettingsStore,
    intervalMs: number = config.activityWatcherIntervalMs,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  /** Best-effort — a bad/unreachable apprise target must never break this watcher's tick. */
  private async notify(title: string, body: string): Promise<void> {
    try {
      const settings = await this.settings.get();
      if (!settings.notifications.enabled || !settings.notifications.appriseUrls.trim()) return;
      await sendAppriseNotification(settings.notifications.appriseUrls, title, body);
    } catch {
      // swallowed — the activity log entry is the record of what happened either way
    }
  }

  private async tick(): Promise<void> {
    let status;
    try {
      status = await this.nmd.getStatus();
    } catch {
      return; // driver unreachable this round — try again next tick
    }

    this.checkParitySync(status.array.last_sync, status.array.counters.sync_errors);
    this.checkDisks(status.disks);
    await this.checkSmartHealth(status.disks);
    await this.checkTemperatures(status.disks);
  }

  private checkParitySync(lastSync: { timestamp: number; status: string }, syncErrors: number): void {
    const seen = this.lastSyncTimestamp;
    this.lastSyncTimestamp = lastSync.timestamp;

    if (seen === null || lastSync.timestamp === seen || lastSync.timestamp === 0) return;

    if (lastSync.status === 'errors') {
      const text = `Parity check finished with ${syncErrors} sync error${syncErrors === 1 ? '' : 's'}`;
      this.activity.log(text, 'red').catch(() => {});
      this.notify('NonRAID: parity errors', text);
    } else if (lastSync.status === 'completed') {
      this.activity.log('Parity check finished with no errors', 'green').catch(() => {});
      this.notify('NonRAID: parity check complete', 'Parity check finished with no errors');
    }
  }

  private checkDisks(disks: NmdDisk[]): void {
    for (const disk of disks) {
      const prev = this.diskSnapshots.get(disk.slot);
      this.diskSnapshots.set(disk.slot, { status: disk.status, errors: disk.errors });
      if (!prev) continue; // first observation of this slot — seed only

      if (disk.errors > prev.errors) {
        const text = `Disk ${disk.slot} (${diskLabel(disk)}) reported new errors — total now ${disk.errors}`;
        this.activity.log(text, 'red').catch(() => {});
        this.notify('NonRAID: disk errors', text);
        continue; // one log line per tick per disk is plenty
      }

      const wasBad = BAD_DISK_STATUSES.has(prev.status);
      const isBad = BAD_DISK_STATUSES.has(disk.status);
      if (isBad && !wasBad) {
        const text = `Disk ${disk.slot} (${diskLabel(disk)}) status changed to ${disk.status}`;
        this.activity.log(text, 'red').catch(() => {});
        this.notify('NonRAID: disk status changed', text);
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
      return; // SMART unreachable this round — try again next tick
    }

    for (const disk of disks) {
      if (!disk.device || disk.device === 'none') continue;
      const health = healths[disk.device] ?? null;
      const prev = this.healthSnapshots.has(disk.device) ? this.healthSnapshots.get(disk.device) : undefined;
      this.healthSnapshots.set(disk.device, health);

      if (prev === 'passed' && health === 'failed') {
        const text = `SMART health check failed for disk ${disk.slot} (${diskLabel(disk)})`;
        this.activity.log(text, 'red').catch(() => {});
        this.notify('NonRAID: SMART health failed', text);
      }
    }
  }

  private checkOneTemp(key: string, label: string, celsius: number | null, threshold: number): void {
    if (celsius === null) return;
    const wasOver = this.overTemp.get(key) ?? false;
    const isOver = celsius >= threshold;
    this.overTemp.set(key, isOver);
    if (isOver && !wasOver) {
      const text = `${label} temperature is ${Math.round(celsius)}°C, at or above the ${threshold}°C alert threshold`;
      this.activity.log(text, 'amber').catch(() => {});
      this.notify('NonRAID: temperature alert', text);
    }
  }

  private async checkTemperatures(disks: NmdDisk[]): Promise<void> {
    const settings = await this.settings.get();
    if (!settings.tempAlerts.enabled) return;
    const threshold = settings.tempAlerts.warnAboveCelsius;

    this.checkOneTemp('cpu', 'CPU', readCpuTempCelsius(), threshold);

    const devices = disks.filter((d) => d.device && d.device !== 'none').map((d) => d.device);
    if (devices.length === 0) return;
    let temps: Record<string, number | null>;
    try {
      temps = await this.smart.getTemperatures(devices);
    } catch {
      return; // SMART unreachable this round — try again next tick
    }
    for (const disk of disks) {
      if (!disk.device || disk.device === 'none') continue;
      this.checkOneTemp(disk.device, `Disk ${disk.slot} (${diskLabel(disk)})`, temps[disk.device] ?? null, threshold);
    }
  }
}
