import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { SettingsStore } from '../settings/index.js';
import { notifyEvent } from '../settings/notify.js';
import { checkForUpdates, type ComponentUpdateStatus } from './service.js';

const COMPONENT_LABELS = { nonraid: 'NonRAID driver', nonraidWebui: 'NonRAID WebUI' } as const;
type ComponentKey = keyof typeof COMPONENT_LABELS;

/**
 * Periodically re-checks for updates (see service.ts's own checkForUpdates) and fires a
 * notification the first time either component is found behind its latest tagged release - same
 * "notify once per new state, not every tick" shape as every other scheduler in this app
 * (ParityScheduler's lastFiredDateKey, RcloneSyncScheduler's lastFiredKeys), keyed here on the
 * specific version that's available so a *later* release re-notifies instead of staying silent
 * forever once the first one's already been flagged. Same in-memory-only caveat those schedulers
 * already have too: a backend restart forgets what it already notified about and could re-fire
 * once - acceptable for a once-a-day, non-urgent notification.
 */
export class UpdateScheduler {
  private timer: NodeJS.Timeout;
  private startupTimer: NodeJS.Timeout;
  private lastNotified = new Map<ComponentKey, string>();

  constructor(
    private activity: ActivityStore,
    private settings: SettingsStore,
    intervalMs: number = config.updateSchedulerTickIntervalMs,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
    // Also check once shortly after startup rather than only after the first full interval -
    // otherwise a freshly (re)started backend stays silent about a known update for up to a day.
    this.startupTimer = setTimeout(() => this.tick(), 30_000);
    this.startupTimer.unref();
  }

  private async tick(): Promise<void> {
    const status = await checkForUpdates(true).catch(() => null);
    if (!status) return;
    await this.maybeNotify('nonraid', status.nonraid);
    await this.maybeNotify('nonraidWebui', status.nonraidWebui);
  }

  private async maybeNotify(key: ComponentKey, component: ComponentUpdateStatus): Promise<void> {
    if (component.upToDate !== false || !component.latest) return; // only a real, known "behind" state
    if (this.lastNotified.get(key) === component.latest) return; // already notified for this exact version
    this.lastNotified.set(key, component.latest);

    const label = COMPONENT_LABELS[key];
    const text = `${label} update available: ${component.latest}${component.installed ? ` (currently ${component.installed})` : ''}`;
    this.activity.log(text, 'blue', 'updateAvailable').catch(() => {});
    notifyEvent(this.settings, 'updateAvailable', `NonRAID: ${label} update available`, text);
  }
}
