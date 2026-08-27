import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { validateCronExpression } from '../settings/cronMatch.js';
import type { SettingsStore } from '../settings/index.js';
import { resolveEncryptionPatch, redactEncryption } from '../settings/backupEncryption.js';
import { passwordErrorCode } from '../system/backupCrypto.js';
import { runSudoMaybe } from '../system/procUtil.js';
import type { RcloneClient } from '../rclone/index.js';
import type { RcloneService } from '../rclone/service.js';
import type { NewSyncJob, SyncJobPatch } from '../rclone/syncJobStore.js';
import type { SyncJob } from '../rclone/types.js';

function handleError(err: unknown, res: import('express').Response): void {
  res.status(502).json({ error: (err as Error).message });
}

function handleRestorePreviewError(err: unknown, res: import('express').Response): void {
  res.status(400).json({ error: (err as Error).message, code: passwordErrorCode(err) });
}

// Never round-trips the real (obscured) password back to the client - see
// settings/backupEncryption.ts's redactEncryption() doc comment.
function redactSyncJob<T extends SyncJob>(job: T): Omit<T, 'encryption'> & { encryption: { enabled: boolean; hasPassword: boolean } } {
  const { encryption, ...rest } = job;
  return { ...rest, encryption: redactEncryption(encryption) };
}

function validateScheduleBody(schedule: Record<string, unknown>): void {
  const { enabled, frequency, dayOfWeek, dayOfMonth, hour, cronExpression } = schedule;
  if (typeof enabled !== 'boolean') throw new Error('schedule.enabled must be a boolean.');
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'cron') {
    throw new Error('schedule.frequency must be "daily", "weekly", "monthly", or "cron".');
  }
  if (!Number.isInteger(dayOfWeek) || (dayOfWeek as number) < 0 || (dayOfWeek as number) > 6) throw new Error('schedule.dayOfWeek must be 0-6.');
  if (!Number.isInteger(dayOfMonth) || (dayOfMonth as number) < 1 || (dayOfMonth as number) > 28) throw new Error('schedule.dayOfMonth must be 1-28.');
  if (!Number.isInteger(hour) || (hour as number) < 0 || (hour as number) > 23) throw new Error('schedule.hour must be 0-23.');
  if (typeof cronExpression !== 'string') throw new Error('schedule.cronExpression must be a string.');
  if (frequency === 'cron') validateCronExpression(cronExpression);
}

function validateRetentionBody(retention: Record<string, unknown>): void {
  const { keepDays, forever } = retention;
  if (typeof forever !== 'boolean') throw new Error('retention.forever must be a boolean.');
  if (!Number.isInteger(keepDays) || (keepDays as number) < 1) throw new Error('retention.keepDays must be a positive integer.');
}

function validateJobBody(body: Record<string, unknown>): void {
  const { name, scope, customPath, remoteName, remotePath, schedule, retention } = body;
  if (typeof name !== 'string' || !name.trim()) throw new Error('name is required.');
  if (scope !== 'config' && scope !== 'configAppdata' && scope !== 'custom') throw new Error('scope must be "config", "configAppdata", or "custom".');
  if (scope === 'custom' && (typeof customPath !== 'string' || !customPath.trim())) throw new Error('customPath is required when scope is "custom".');
  if (typeof remoteName !== 'string' || !remoteName.trim()) throw new Error('remoteName is required.');
  if (typeof remotePath !== 'string') throw new Error('remotePath must be a string.');
  if (!schedule || typeof schedule !== 'object') throw new Error('schedule is required.');
  validateScheduleBody(schedule as Record<string, unknown>);
  if (!retention || typeof retention !== 'object') throw new Error('retention is required.');
  validateRetentionBody(retention as Record<string, unknown>);
}

export function rcloneRouter(client: RcloneClient, service: RcloneService, settingsStore: SettingsStore, activity: ActivityStore): Router {
  const router = Router();

  router.get('/rclone/status', async (_req, res) => {
    try {
      const [settings, installed, running] = await Promise.all([settingsStore.get(), client.isInstalled(), client.ping()]);
      res.json({ installed, running, featureEnabled: settings.remoteBackup.enabled });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Separate from the generic PUT /settings, same precedent as PUT /tailscale/enabled: this has a
  // real side effect (starting/stopping rclone-rcd.service) beyond just persisting a preference.
  router.put('/rclone/enabled', async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean.' });
      return;
    }
    try {
      await settingsStore.update({ remoteBackup: { enabled } });
      await runSudoMaybe('systemctl', [enabled ? 'enable' : 'disable', '--now', 'rclone-rcd']).catch(() => {});
      activity.log(`Remote Backup ${enabled ? 'enabled' : 'disabled'}`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Remote Backup ${enabled ? 'enabled' : 'disabled'}.` });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/rclone/providers', async (_req, res) => {
    try {
      res.json(await client.listProviders());
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/rclone/remotes', async (_req, res) => {
    try {
      const remotes = await client.listRemotes();
      const withStatus = await Promise.all(
        remotes.map(async (r) => {
          const check = await client.checkRemote(r.name);
          return { name: r.name, type: r.type, status: check.status, statusMessage: check.message };
        }),
      );
      res.json(withStatus);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/rclone/remotes', async (req, res) => {
    const { name, type, parameters } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required.' });
      return;
    }
    if (typeof type !== 'string' || !type.trim()) {
      res.status(400).json({ error: 'type is required.' });
      return;
    }
    try {
      const result = await client.createRemote(name.trim(), type, parameters ?? {});
      if (result.done) {
        activity.log(`Remote "${name}" added (${type})`, 'blue').catch(() => {});
      }
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/rclone/remotes/:name/continue', async (req, res) => {
    const { type, state, result: answer } = req.body ?? {};
    if (typeof type !== 'string' || typeof state !== 'string') {
      res.status(400).json({ error: 'type and state are required.' });
      return;
    }
    try {
      const result = await client.continueRemoteSetup(req.params.name, type, state, typeof answer === 'string' ? answer : '');
      if (result.done) {
        activity.log(`Remote "${req.params.name}" finished authorizing`, 'blue').catch(() => {});
      }
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/rclone/remotes/:name', async (req, res) => {
    try {
      res.json(await client.getRemoteConfig(req.params.name));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put('/rclone/remotes/:name', async (req, res) => {
    const { parameters } = req.body ?? {};
    if (!parameters || typeof parameters !== 'object') {
      res.status(400).json({ error: 'parameters is required.' });
      return;
    }
    try {
      await client.updateRemote(req.params.name, parameters);
      activity.log(`Remote "${req.params.name}" updated`, 'blue').catch(() => {});
      res.json({ ok: true, message: 'Remote updated.' });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete('/rclone/remotes/:name', async (req, res) => {
    try {
      await client.deleteRemote(req.params.name);
      activity.log(`Remote "${req.params.name}" removed`, 'amber').catch(() => {});
      res.json({ ok: true, message: 'Remote removed.' });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/rclone/jobs', async (_req, res) => {
    try {
      res.json((await service.listJobsWithRuntime()).map(redactSyncJob));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/rclone/jobs', async (req, res) => {
    try {
      validateJobBody(req.body ?? {});
      const body = req.body;
      const encryption = await resolveEncryptionPatch(client, body.encryption, null);
      const job: NewSyncJob = {
        name: body.name.trim(),
        enabled: body.enabled ?? true,
        scope: body.scope,
        customPath: body.customPath ?? '',
        remoteName: body.remoteName,
        remotePath: body.remotePath ?? '',
        schedule: body.schedule,
        retention: body.retention,
        encryption: encryption ?? { enabled: false, passwordObscured: null },
      };
      const created = await service.createJob(job);
      activity.log(`Sync job "${created.name}" created`, 'blue').catch(() => {});
      res.status(201).json(redactSyncJob(created));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.put('/rclone/jobs/:id', async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (body.schedule) validateScheduleBody(body.schedule as Record<string, unknown>);
      if (body.retention) validateRetentionBody(body.retention as Record<string, unknown>);
      const patch: SyncJobPatch = { ...body } as SyncJobPatch;
      if (body.encryption) {
        const existingJob = await service.store.get(req.params.id);
        patch.encryption = await resolveEncryptionPatch(client, body.encryption, existingJob?.encryption ?? null);
      }
      const updated = await service.updateJob(req.params.id, patch);
      res.json(redactSyncJob(updated));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete('/rclone/jobs/:id', async (req, res) => {
    try {
      await service.deleteJob(req.params.id);
      activity.log('Sync job deleted', 'amber').catch(() => {});
      res.json({ ok: true, message: 'Sync job deleted.' });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put('/rclone/jobs/:id/enabled', async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean.' });
      return;
    }
    try {
      const updated = await service.updateJob(req.params.id, { enabled });
      res.json(redactSyncJob(updated));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/rclone/jobs/:id/sync', async (req, res) => {
    try {
      await service.runJobNow(req.params.id);
      res.json({ ok: true, message: 'Sync completed.' });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/rclone/jobs/:id/cancel', async (_req, res) => {
    try {
      await service.cancelCurrent();
      res.json({ ok: true, message: 'Cancel requested.' });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Recovery hub's "restore from a remote backup" picker: what a 'config'/'configAppdata' scope
  // job has already uploaded to its remote target, then (once one's picked) a preview built from
  // a copy pulled down into private staging - same preview/token shape and downstream
  // review/commit as every other restore source. Both 400 rather than 502 on failure - a bad job
  // id/archive name or a 'custom' scope job is a request-shaped error, not an rclone-side one.
  router.get('/rclone/jobs/:id/backups', async (req, res) => {
    try {
      res.json(await service.listJobBackups(req.params.id));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/rclone/jobs/:id/backups/:name/restore-preview', async (req, res) => {
    try {
      const password = typeof req.body?.password === 'string' ? req.body.password : null;
      res.json(await service.previewJobBackup(req.params.id, req.params.name, password));
    } catch (err) {
      handleRestorePreviewError(err, res);
    }
  });

  // Onboarding's disaster-recovery path: browse an arbitrary remote+path directly, with no sync
  // job behind it - a from-scratch install has no jobs configured yet, so the by-job routes above
  // (GET /rclone/jobs/:id/backups etc.) have nothing to key off of. Same
  // listBackupsAt()/previewBackupAt() logic those routes use under the hood, just reached without
  // a job id. Both 400 rather than 502 on failure, same reasoning as the by-job routes: a bad
  // remote name/path or archive name is a request-shaped error, not an rclone-side one.
  router.post('/rclone/browse-backups', async (req, res) => {
    const { remoteName, remotePath } = req.body ?? {};
    if (typeof remoteName !== 'string' || !remoteName.trim()) {
      res.status(400).json({ error: 'remoteName is required.' });
      return;
    }
    try {
      res.json(await service.listBackupsAt(remoteName, typeof remotePath === 'string' ? remotePath : ''));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/rclone/browse-backups/restore-preview', async (req, res) => {
    const { remoteName, remotePath, name, password } = req.body ?? {};
    if (typeof remoteName !== 'string' || !remoteName.trim()) {
      res.status(400).json({ error: 'remoteName is required.' });
      return;
    }
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required.' });
      return;
    }
    try {
      res.json(await service.previewBackupAt(remoteName, typeof remotePath === 'string' ? remotePath : '', name, typeof password === 'string' ? password : null, 'browse'));
    } catch (err) {
      handleRestorePreviewError(err, res);
    }
  });

  return router;
}
