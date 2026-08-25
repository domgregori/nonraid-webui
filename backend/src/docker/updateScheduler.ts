import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { SettingsStore } from '../settings/index.js';
import { notifyEvent } from '../settings/notify.js';
import type { DockerClient } from './client.js';
import { checkContainerUpdate, type ContainerUpdateStatus } from './updateCheck.js';

/**
 * Periodically re-checks every container's image for an update (see updateCheck.ts) and fires a
 * notification the first time a container is found to have one available - same "notify once per
 * new state, not every tick" shape as UpdateScheduler (backend/src/update/scheduler.ts), keyed
 * here on the specific freshly-pulled image id so a *later* update re-notifies instead of staying
 * silent forever once the first one's already been flagged. Same in-memory-only caveat every
 * scheduler in this app already has: a backend restart forgets what it already notified about and
 * could re-fire once - acceptable for a once-a-day, non-urgent notification.
 */
export class DockerUpdateScheduler {
  private timer: NodeJS.Timeout;
  private startupTimer: NodeJS.Timeout;
  private lastNotified = new Map<string, string>();

  constructor(
    private docker: DockerClient,
    private activity: ActivityStore,
    private settings: SettingsStore,
    intervalMs: number = config.dockerUpdateSchedulerTickIntervalMs,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
    // Also check once shortly after startup rather than only after the first full interval -
    // otherwise a freshly (re)started backend stays silent about a known update for up to a day.
    this.startupTimer = setTimeout(() => this.tick(), 30_000);
    this.startupTimer.unref();
  }

  private async tick(): Promise<void> {
    const containers = await this.docker.listContainers().catch(() => null);
    if (!containers) return;
    for (const container of containers) {
      const status = await checkContainerUpdate(this.docker, container.id).catch(() => null);
      if (!status) continue;
      await this.maybeNotify(container.id, container.name, status);
    }
  }

  private async maybeNotify(containerId: string, containerName: string, status: ContainerUpdateStatus): Promise<void> {
    if (!status.updateAvailable || !status.latestImageId) return; // false or null (unknown/check failed) - nothing to notify about
    if (this.lastNotified.get(containerId) === status.latestImageId) return; // already notified about this exact available image
    this.lastNotified.set(containerId, status.latestImageId);

    const text = `Update available for container "${containerName}"`;
    this.activity.log(text, 'blue', 'dockerUpdateAvailable').catch(() => {});
    notifyEvent(this.settings, 'dockerUpdateAvailable', 'NonRAID: Docker update available', text);
  }
}
