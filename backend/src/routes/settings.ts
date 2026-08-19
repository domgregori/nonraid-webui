import { Router, type Express } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import { NOTIFICATION_EVENTS, sendAppriseNotification, type SettingsStore } from '../settings/index.js';
import type { ShareService } from '../shares/index.js';

const KNOWN_EVENT_TYPES = new Set<string>(NOTIFICATION_EVENTS.map((e) => e.id));

/** Shared by paritySchedule, backupSchedule, and cacheSchedule - all three are RecurringSchedule patches. */
function validateSchedulePatch(fieldName: string, schedule: Record<string, unknown>): void {
  const { enabled, frequency, dayOfWeek, dayOfMonth, hour } = schedule;
  if ('enabled' in schedule && typeof enabled !== 'boolean') {
    throw new Error(`${fieldName}.enabled must be a boolean.`);
  }
  if ('frequency' in schedule && frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly') {
    throw new Error(`${fieldName}.frequency must be "daily", "weekly", or "monthly".`);
  }
  if ('dayOfWeek' in schedule && (!Number.isInteger(dayOfWeek) || (dayOfWeek as number) < 0 || (dayOfWeek as number) > 6)) {
    throw new Error(`${fieldName}.dayOfWeek must be an integer 0-6 (Sunday-Saturday).`);
  }
  if ('dayOfMonth' in schedule && (!Number.isInteger(dayOfMonth) || (dayOfMonth as number) < 1 || (dayOfMonth as number) > 28)) {
    throw new Error(`${fieldName}.dayOfMonth must be an integer 1-28.`);
  }
  if ('hour' in schedule && (!Number.isInteger(hour) || (hour as number) < 0 || (hour as number) > 23)) {
    throw new Error(`${fieldName}.hour must be an integer 0-23.`);
  }
}

export function settingsRouter(store: SettingsStore, nmd: NmdClient, activity: ActivityStore, shares: ShareService, app: Express): Router {
  const router = Router();

  router.get('/settings', async (_req, res) => {
    try {
      res.json(await store.get());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.get('/settings/notification-events', (_req, res) => {
    res.json(NOTIFICATION_EVENTS);
  });

  // Applies turboWrite live before persisting it, so a failed apply (e.g. the
  // array isn't started, or the driver module isn't loaded) doesn't silently
  // save a setting nothing actually honored - the whole request fails
  // together rather than partially succeeding.
  router.put('/settings', async (req, res) => {
    try {
      const patch = req.body ?? {};
      if (typeof patch.turboWrite === 'boolean') {
        await nmd.setWriteMethod(patch.turboWrite);
        activity.log(patch.turboWrite ? 'Turbo write enabled' : 'Turbo write disabled', 'blue').catch(() => {});
      }
      // Express re-reads 'trust proxy' on every request, so this takes effect immediately -
      // no restart needed, unlike TLS enable/disable. config.trustProxy is updated too since
      // webauthn.ts's requireWebauthnConfig() reads it directly, not via app.get().
      if (typeof patch.trustProxy === 'boolean') {
        app.set('trust proxy', patch.trustProxy);
        config.trustProxy = patch.trustProxy;
        activity.log(patch.trustProxy ? 'Trust reverse proxy enabled' : 'Trust reverse proxy disabled', 'blue').catch(() => {});
      }
      if ('minFreeSpaceGb' in patch) {
        if (typeof patch.minFreeSpaceGb !== 'number' || !Number.isInteger(patch.minFreeSpaceGb) || patch.minFreeSpaceGb < 0) {
          throw new Error('minFreeSpaceGb must be a non-negative integer (GB).');
        }
      }
      if (patch.paritySchedule) {
        validateSchedulePatch('paritySchedule', patch.paritySchedule);
      }
      if (patch.cacheSchedule) {
        validateSchedulePatch('cacheSchedule', patch.cacheSchedule);
      }
      if (patch.backupSchedule) {
        validateSchedulePatch('backupSchedule', patch.backupSchedule);
        const { destDir, retain } = patch.backupSchedule;
        if ('destDir' in patch.backupSchedule && typeof destDir !== 'string') {
          throw new Error('backupSchedule.destDir must be a string.');
        }
        if ('retain' in patch.backupSchedule && (!Number.isInteger(retain) || (retain as number) < 1)) {
          throw new Error('backupSchedule.retain must be a positive integer.');
        }
      }
      if (patch.notifications?.eventTypes) {
        for (const [key, channels] of Object.entries(patch.notifications.eventTypes)) {
          if (!KNOWN_EVENT_TYPES.has(key)) {
            throw new Error(`Unknown notification event type "${key}".`);
          }
          if (typeof channels !== 'object' || channels === null) {
            throw new Error(`notifications.eventTypes.${key} must be an object with apprise/webui booleans.`);
          }
          const { apprise, webui } = channels as Record<string, unknown>;
          if ('apprise' in channels && typeof apprise !== 'boolean') {
            throw new Error(`notifications.eventTypes.${key}.apprise must be a boolean.`);
          }
          if ('webui' in channels && typeof webui !== 'boolean') {
            throw new Error(`notifications.eventTypes.${key}.webui must be a boolean.`);
          }
        }
      }
      if (patch.tempAlerts) {
        const { cpuWarnAboveCelsius, diskWarnAboveCelsius } = patch.tempAlerts;
        const isValidThreshold = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
        if ('cpuWarnAboveCelsius' in patch.tempAlerts && !isValidThreshold(cpuWarnAboveCelsius)) {
          throw new Error('tempAlerts.cpuWarnAboveCelsius must be a number 0-100.');
        }
        if ('diskWarnAboveCelsius' in patch.tempAlerts && !isValidThreshold(diskWarnAboveCelsius)) {
          throw new Error('tempAlerts.diskWarnAboveCelsius must be a number 0-100.');
        }
      }
      const updated = await store.update(patch);
      if ('minFreeSpaceGb' in patch) {
        // mergerfs's minfreespace is a mount option - only takes effect on
        // (re)mount, so reapply every currently-mounted share now rather
        // than leaving them on the old value until the next backend restart.
        await shares.remountAll();
        activity.log(`Minimum free space set to ${patch.minFreeSpaceGb} GB`, 'blue').catch(() => {});
      }
      res.json(updated);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/settings/notifications/test', async (req, res) => {
    try {
      // Tests whatever's currently in the form, not what's already saved - lets the user check a
      // URL works before committing to it. Falls back to the persisted URLs when the body doesn't
      // include one (e.g. a bare test-with-saved-config call).
      const { appriseUrls } = req.body as { appriseUrls?: unknown };
      const urls = typeof appriseUrls === 'string' ? appriseUrls : (await store.get()).notifications.appriseUrls;
      res.json(await sendAppriseNotification(urls, 'NonRAID', 'Test notification from the nonraid dashboard.'));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
