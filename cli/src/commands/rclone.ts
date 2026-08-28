import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { CommandResult, RcloneDaemonStatus, RcloneRemote, RecurringSchedule, RemoteBackupEntry, SyncJobWithRuntime, SyncScope } from '../api/types.js';

function collectParam(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function paramsToObject(pairs: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) throw new Error(`--param "${pair}" must be in key=value form.`);
    params[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return params;
}

interface ScheduleOpts {
  frequency?: string;
  dayOfWeek?: string;
  dayOfMonth?: string;
  hour?: string;
  cron?: string;
  scheduleEnabled?: boolean;
  scheduleDisabled?: boolean;
}

function buildSchedule(opts: ScheduleOpts): Partial<RecurringSchedule> | undefined {
  if (!opts.frequency && opts.scheduleEnabled === undefined && opts.scheduleDisabled === undefined && !opts.dayOfWeek && !opts.dayOfMonth && !opts.hour && !opts.cron) {
    return undefined;
  }
  const schedule: Partial<RecurringSchedule> = {};
  if (opts.scheduleEnabled) schedule.enabled = true;
  if (opts.scheduleDisabled) schedule.enabled = false;
  if (opts.frequency) schedule.frequency = opts.frequency as RecurringSchedule['frequency'];
  if (opts.dayOfWeek !== undefined) schedule.dayOfWeek = Number(opts.dayOfWeek);
  if (opts.dayOfMonth !== undefined) schedule.dayOfMonth = Number(opts.dayOfMonth);
  if (opts.hour !== undefined) schedule.hour = Number(opts.hour);
  if (opts.cron !== undefined) schedule.cronExpression = opts.cron;
  return schedule;
}

function addScheduleOptions<T extends Command>(cmd: T): T {
  return cmd
    .option('--frequency <freq>', 'daily | weekly | monthly | cron')
    .option('--day-of-week <n>', '0 (Sun) - 6 (Sat), for weekly')
    .option('--day-of-month <n>', '1-28, for monthly')
    .option('--hour <n>', '0-23, server local time')
    .option('--cron <expr>', "5-field cron expression, for frequency 'cron'")
    .option('--schedule-enabled', 'enable the schedule')
    .option('--schedule-disabled', 'disable the schedule');
}

export function registerRcloneCommand(program: Command): void {
  const rclone = program.command('rclone').description('remote backup (rclone) - remotes and sync jobs');

  rclone
    .command('status')
    .description('rclone daemon status')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const s = await client.get<RcloneDaemonStatus>('/rclone/status');
        console.log(`Installed: ${s.installed}  Running: ${s.running}  Feature enabled: ${s.featureEnabled}`);
      }),
    );

  rclone
    .command('enable')
    .description('enable the Remote Backup feature (starts rclone-rcd)')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        await client.put('/rclone/enabled', { enabled: true });
        console.log('Remote Backup enabled.');
      }),
    );

  rclone
    .command('disable')
    .description('disable the Remote Backup feature (stops rclone-rcd)')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        await client.put('/rclone/enabled', { enabled: false });
        console.log('Remote Backup disabled.');
      }),
    );

  rclone
    .command('providers')
    .description('list every backend rclone supports')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const providers = await client.get<{ name: string; description: string; oauth: boolean }[]>('/rclone/providers');
        printTable(
          ['NAME', 'DESCRIPTION', 'OAUTH'],
          providers.map((p) => [p.name, p.description, p.oauth ? 'yes' : 'no']),
        );
      }),
    );

  const remote = rclone.command('remote').description('configured rclone remotes');

  remote
    .command('ls')
    .description('list configured remotes')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const remotes = await client.get<RcloneRemote[]>('/rclone/remotes');
        printTable(
          ['NAME', 'TYPE', 'STATUS', 'MESSAGE'],
          remotes.map((r) => [r.name, r.type, r.status, r.statusMessage ?? '-']),
        );
      }),
    );

  remote
    .command('add <name> <type>')
    .description('create a remote (non-OAuth providers only - S3/B2/SFTP/WebDAV/...)')
    .option('--param <key=value>', 'a provider config field, repeatable', collectParam, [] as string[])
    .action(
      runAction(async (name: string, type: string, opts: { param: string[] }) => {
        const client = await resolveClient();
        const result = await client.post<{ done: boolean }>('/rclone/remotes', { name, type, parameters: paramsToObject(opts.param) });
        console.log(result.done ? `Remote "${name}" created.` : `Remote "${name}" needs further OAuth setup - use the web UI to finish it.`);
      }),
    );

  remote
    .command('show <name>')
    .description("show a remote's saved config")
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        const config = await client.get(`/rclone/remotes/${encodeURIComponent(name)}`);
        console.log(JSON.stringify(config, null, 2));
      }),
    );

  remote
    .command('set <name>')
    .description('merge fields into an existing remote (provider type is not editable this way)')
    .requiredOption('--param <key=value>', 'a provider config field, repeatable', collectParam, [] as string[])
    .action(
      runAction(async (name: string, opts: { param: string[] }) => {
        const client = await resolveClient();
        await client.put(`/rclone/remotes/${encodeURIComponent(name)}`, { parameters: paramsToObject(opts.param) });
        console.log(`Remote "${name}" updated.`);
      }),
    );

  remote
    .command('rm <name>')
    .description('delete a remote (any sync job pointing at it starts reporting an error, not deleted)')
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        await client.delete(`/rclone/remotes/${encodeURIComponent(name)}`);
        console.log(`Remote "${name}" deleted.`);
      }),
    );

  const job = rclone.command('job').description('remote backup sync jobs');

  job
    .command('ls')
    .description('list sync jobs with live runtime state')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const jobs = await client.get<SyncJobWithRuntime[]>('/rclone/jobs');
        printTable(
          ['ID', 'NAME', 'SCOPE', 'REMOTE', 'ENABLED', 'STATE', 'LAST SYNC'],
          jobs.map((j) => [j.id, j.name, j.scope, `${j.remoteName}:${j.remotePath}`, j.enabled ? 'yes' : 'no', j.state, j.lastSyncedAt ? new Date(j.lastSyncedAt).toISOString() : '-']),
        );
      }),
    );

  addScheduleOptions(job.command('create <name>'))
    .description('create a sync job')
    .requiredOption('--scope <scope>', 'config | configAppdata | custom')
    .requiredOption('--remote <remoteName>', 'a configured remote name')
    .option('--remote-path <path>', 'subpath under the remote', '')
    .option('--custom-path <path>', "local path to mirror, required when --scope custom")
    .option('--keep-days <n>', 'retention in days', '30')
    .option('--forever', 'never prune (overrides --keep-days)')
    .option('--encrypt', 'password-encrypt archives (config/configAppdata scope only)')
    .option('--password <password>', 'encryption password')
    .action(
      runAction(async (name: string, opts: ScheduleOpts & { scope: SyncScope; remote: string; remotePath?: string; customPath?: string; keepDays: string; forever?: boolean; encrypt?: boolean; password?: string }) => {
        const client = await resolveClient();
        const body = {
          name,
          scope: opts.scope,
          customPath: opts.customPath ?? '',
          remoteName: opts.remote,
          remotePath: opts.remotePath ?? '',
          // The create route (unlike update) requires every RecurringSchedule field, even ones
          // that are meaningless for the chosen frequency - confirmed live against
          // validateScheduleBody() in backend/src/routes/rclone.ts. Fill full defaults, then
          // overlay whatever the user actually passed.
          schedule: { enabled: false, frequency: 'daily', dayOfWeek: 0, dayOfMonth: 1, hour: 3, cronExpression: '', ...buildSchedule(opts) },
          retention: { keepDays: Number(opts.keepDays), forever: !!opts.forever },
          encryption: { enabled: !!opts.encrypt, ...(opts.password ? { password: opts.password } : {}) },
        };
        const created = await client.post<SyncJobWithRuntime>('/rclone/jobs', body);
        console.log(`Sync job "${name}" created (id ${created.id}).`);
      }),
    );

  addScheduleOptions(job.command('update <id>'))
    .description('update a sync job - only given fields are changed')
    .option('--remote <remoteName>', 'a configured remote name')
    .option('--remote-path <path>', 'subpath under the remote')
    .option('--custom-path <path>', 'local path to mirror')
    .option('--keep-days <n>', 'retention in days')
    .option('--forever', 'never prune')
    .option('--encrypt', 'turn on archive encryption')
    .option('--no-encrypt', 'turn off archive encryption')
    .option('--password <password>', 'encryption password (blank/omitted keeps the current saved one)')
    .action(
      runAction(
        async (
          id: string,
          opts: ScheduleOpts & { remote?: string; remotePath?: string; customPath?: string; keepDays?: string; forever?: boolean; encrypt?: boolean; password?: string },
        ) => {
          const client = await resolveClient();
          const body: Record<string, unknown> = {};
          if (opts.remote !== undefined) body.remoteName = opts.remote;
          if (opts.remotePath !== undefined) body.remotePath = opts.remotePath;
          if (opts.customPath !== undefined) body.customPath = opts.customPath;
          const scheduleOverride = buildSchedule(opts);
          const retentionOverride =
            opts.keepDays !== undefined || opts.forever !== undefined
              ? { ...(opts.keepDays !== undefined ? { keepDays: Number(opts.keepDays) } : {}), ...(opts.forever !== undefined ? { forever: opts.forever } : {}) }
              : undefined;
          // The backend validates `schedule`/`retention` as complete objects whenever present in
          // the patch, not field-by-field (confirmed live: patching just retention.keepDays 400s
          // with "retention.forever must be a boolean"). Fetch the job's current values first and
          // merge the requested change on top, so a single-field change here doesn't need to
          // restate every other field.
          if (scheduleOverride || retentionOverride) {
            const jobs = await client.get<SyncJobWithRuntime[]>('/rclone/jobs');
            const current = jobs.find((j) => j.id === id);
            if (!current) throw new Error(`No sync job with id "${id}".`);
            if (scheduleOverride) body.schedule = { ...current.schedule, ...scheduleOverride };
            if (retentionOverride) body.retention = { ...current.retention, ...retentionOverride };
          }
          if (opts.encrypt !== undefined || opts.password !== undefined) {
            body.encryption = { ...(opts.encrypt !== undefined ? { enabled: opts.encrypt } : {}), ...(opts.password !== undefined ? { password: opts.password } : {}) };
          }
          await client.put(`/rclone/jobs/${encodeURIComponent(id)}`, body);
          console.log(`Sync job "${id}" updated.`);
        },
      ),
    );

  job
    .command('rm <id>')
    .description('delete a sync job record (never touches what it already synced)')
    .action(
      runAction(async (id: string) => {
        const client = await resolveClient();
        await client.delete(`/rclone/jobs/${encodeURIComponent(id)}`);
        console.log(`Sync job "${id}" deleted.`);
      }),
    );

  job
    .command('enable <id>')
    .description('enable a sync job')
    .action(
      runAction(async (id: string) => {
        const client = await resolveClient();
        await client.put(`/rclone/jobs/${encodeURIComponent(id)}/enabled`, { enabled: true });
        console.log(`Sync job "${id}" enabled.`);
      }),
    );

  job
    .command('disable <id>')
    .description('disable a sync job')
    .action(
      runAction(async (id: string) => {
        const client = await resolveClient();
        await client.put(`/rclone/jobs/${encodeURIComponent(id)}/enabled`, { enabled: false });
        console.log(`Sync job "${id}" disabled.`);
      }),
    );

  job
    .command('sync <id>')
    .description('run a sync job now, outside its schedule (blocks until it finishes)')
    .action(
      runAction(async (id: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/rclone/jobs/${encodeURIComponent(id)}/sync`);
        console.log(result.message ?? 'Sync finished.');
      }),
    );

  job
    .command('cancel <id>')
    .description('cancel this job\'s in-progress sync')
    .action(
      runAction(async (id: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/rclone/jobs/${encodeURIComponent(id)}/cancel`);
        console.log(result.message ?? 'Cancelled.');
      }),
    );

  job
    .command('backups <id>')
    .description('list archives this job has already uploaded to its remote')
    .action(
      runAction(async (id: string) => {
        const client = await resolveClient();
        const backups = await client.get<RemoteBackupEntry[]>(`/rclone/jobs/${encodeURIComponent(id)}/backups`);
        printTable(
          ['NAME', 'SIZE(MB)', 'MODIFIED', 'ENCRYPTED'],
          backups.map((b) => [b.name, (b.sizeBytes / 1e6).toFixed(1), b.modTime, b.encrypted ? 'yes' : 'no']),
        );
      }),
    );
}
