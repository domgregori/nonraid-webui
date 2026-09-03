import { Router, type Express } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { resolveTrustProxyValue } from '../auth/index.js';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { RcloneClient } from '../rclone/client.js';
import { redactEncryption, resolveEncryptionPatch } from '../settings/backupEncryption.js';
import { validateCronExpression } from '../settings/cronMatch.js';
import { NOTIFICATION_EVENTS, sendAppriseNotification, type AppSettings, type SettingsStore } from '../settings/index.js';
import type { ShareService } from '../shares/index.js';
import { applySpinDownTimeout } from '../system/hdparm.js';

const KNOWN_EVENT_TYPES = new Set<string>(NOTIFICATION_EVENTS.map((e) => e.id));

/** Shared by paritySchedule, backupSchedule, and cacheSchedule - all three are RecurringSchedule
 *  patches. Parity/Cache never actually send frequency: 'cron' (their own ScheduleFields usage
 *  doesn't offer that option), but the shape allows it structurally the same as Backups/rclone
 *  sync jobs, so it's validated here too rather than only for backupSchedule. */
function validateSchedulePatch(fieldName: string, schedule: Record<string, unknown>): void {
  const { enabled, frequency, dayOfWeek, dayOfMonth, hour, cronExpression } = schedule;
  if ('enabled' in schedule && typeof enabled !== 'boolean') {
    throw new Error(`${fieldName}.enabled must be a boolean.`);
  }
  if ('frequency' in schedule && frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'cron') {
    throw new Error(`${fieldName}.frequency must be "daily", "weekly", "monthly", or "cron".`);
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
  if ('cronExpression' in schedule) {
    if (typeof cronExpression !== 'string') {
      throw new Error(`${fieldName}.cronExpression must be a string.`);
    }
    if (frequency === 'cron' || (frequency === undefined && cronExpression)) {
      validateCronExpression(cronExpression);
    }
  }
}

function validateBackupDestination(fieldName: string, destination: Record<string, unknown>): void {
  const { mode, diskSlot, customPath } = destination;
  if ('mode' in destination && mode !== 'boot' && mode !== 'array' && mode !== 'custom') {
    throw new Error(`${fieldName}.mode must be "boot", "array", or "custom".`);
  }
  if ('diskSlot' in destination && diskSlot !== null && !Number.isInteger(diskSlot)) {
    throw new Error(`${fieldName}.diskSlot must be an integer or null.`);
  }
  if (mode === 'array' && (diskSlot === null || diskSlot === undefined)) {
    throw new Error(`${fieldName}.diskSlot is required when mode is "array".`);
  }
  if ('customPath' in destination && typeof customPath !== 'string') {
    throw new Error(`${fieldName}.customPath must be a string.`);
  }
  if (mode === 'custom' && !(customPath as string | undefined)?.trim()) {
    throw new Error(`${fieldName}.customPath is required when mode is "custom".`);
  }
}

// Never round-trips the real (obscured) Local Backups encryption password back to the client -
// see settings/backupEncryption.ts's redactEncryption() doc comment. The only field this touches;
// every other AppSettings field passes through unchanged. Returns `unknown` (rather than trying to
// express "AppSettings but with one nested field's type swapped" generically) since this only ever
// feeds straight into res.json(), which doesn't care.
function redactSettings(settings: AppSettings): unknown {
  const { encryption, ...restSchedule } = settings.backupSchedule;
  return { ...settings, backupSchedule: { ...restSchedule, encryption: redactEncryption(encryption) } };
}

export function settingsRouter(store: SettingsStore, nmd: NmdClient, activity: ActivityStore, shares: ShareService, app: Express, rclone: RcloneClient): Router {
  const router = Router();

  router.get('/settings', async (_req, res) => {
    try {
      res.json(redactSettings(await store.get()));
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
      // webauthn.ts's requireWebauthnConfig() reads it directly, not via app.get(). Runs before
      // store.update() below persists anything, so an address that fails to resolve (bad
      // hostname) rejects the whole request rather than saving a value that wouldn't actually work.
      if (typeof patch.trustProxy === 'boolean' || typeof patch.trustProxyAddress === 'string') {
        const current = await store.get();
        const trustProxy = typeof patch.trustProxy === 'boolean' ? patch.trustProxy : current.trustProxy;
        const trustProxyAddress = typeof patch.trustProxyAddress === 'string' ? patch.trustProxyAddress : current.trustProxyAddress;
        app.set('trust proxy', trustProxy ? (await resolveTrustProxyValue(trustProxyAddress)) ?? true : false);
        config.trustProxy = trustProxy;
        activity.log(trustProxy ? 'Trust reverse proxy enabled' : 'Trust reverse proxy disabled', 'blue').catch(() => {});
      }
      if ('minFreeSpaceGb' in patch) {
        if (typeof patch.minFreeSpaceGb !== 'number' || !Number.isInteger(patch.minFreeSpaceGb) || patch.minFreeSpaceGb < 0) {
          throw new Error('minFreeSpaceGb must be a non-negative integer (GB).');
        }
      }
      if ('spinDownTimeoutMinutes' in patch) {
        if (typeof patch.spinDownTimeoutMinutes !== 'number' || !Number.isInteger(patch.spinDownTimeoutMinutes) || patch.spinDownTimeoutMinutes < 0) {
          throw new Error('spinDownTimeoutMinutes must be a non-negative integer.');
        }
      }
      if (patch.diskLabels) {
        if (typeof patch.diskLabels !== 'object') {
          throw new Error('diskLabels must be an object mapping disk_id to a label.');
        }
        for (const [key, value] of Object.entries(patch.diskLabels)) {
          if (typeof value !== 'string' || value.length > 40) {
            throw new Error(`diskLabels.${key} must be a string of 40 characters or fewer.`);
          }
        }
      }
      if (patch.containerWebUiUrls) {
        if (typeof patch.containerWebUiUrls !== 'object') {
          throw new Error('containerWebUiUrls must be an object mapping container name to a URL.');
        }
        for (const [key, value] of Object.entries(patch.containerWebUiUrls)) {
          if (typeof value !== 'string' || value.length > 500) {
            throw new Error(`containerWebUiUrls.${key} must be a string of 500 characters or fewer.`);
          }
          // Empty string removes the override (see mergeStringRecord) - only a real value needs
          // the shape check.
          if (value && !/^https?:\/\//i.test(value)) {
            throw new Error(`containerWebUiUrls.${key} must start with http:// or https://.`);
          }
        }
      }
      if ('appLinkHost' in patch) {
        if (typeof patch.appLinkHost !== 'string' || patch.appLinkHost.length > 253) {
          throw new Error('appLinkHost must be a string of 253 characters or fewer.');
        }
        // A bare host - the port comes from each container's own detected/published port, and the
        // protocol always defaults to http (matching today's window.location.hostname behavior), so
        // "://" or "/" here means someone pasted a full URL by mistake rather than just the host.
        if (patch.appLinkHost.trim() && /[:/]/.test(patch.appLinkHost.trim())) {
          throw new Error('appLinkHost must be a bare hostname or IP, not a full URL - no "://", port, or path.');
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
        const { scope, destination, retain, retainForever, encryption } = patch.backupSchedule;
        if ('scope' in patch.backupSchedule && scope !== 'config' && scope !== 'configAppdata') {
          throw new Error('backupSchedule.scope must be "config" or "configAppdata".');
        }
        if (destination) {
          validateBackupDestination('backupSchedule.destination', destination);
        }
        if ('retain' in patch.backupSchedule && (!Number.isInteger(retain) || (retain as number) < 1)) {
          throw new Error('backupSchedule.retain must be a positive integer.');
        }
        if ('retainForever' in patch.backupSchedule && typeof retainForever !== 'boolean') {
          throw new Error('backupSchedule.retainForever must be a boolean.');
        }
        if (encryption) {
          const existing = (await store.get()).backupSchedule.encryption;
          patch.backupSchedule.encryption = await resolveEncryptionPatch(rclone, encryption, existing);
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
      if ('spinDownTimeoutMinutes' in patch) {
        // Best-effort, same as array-start/boot-time reapplication (see routes/array.ts,
        // index.ts) - a disk not responding to hdparm shouldn't fail the whole settings save.
        await applySpinDownTimeout(nmd, patch.spinDownTimeoutMinutes).catch(() => {});
        activity.log(patch.spinDownTimeoutMinutes > 0 ? `Idle spin-down set to ${patch.spinDownTimeoutMinutes} min` : 'Idle spin-down disabled', 'blue').catch(() => {});
      }
      res.json(redactSettings(updated));
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
