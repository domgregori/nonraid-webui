import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { rcloneApi } from '../../api/rcloneApi';
import { useSettings } from '../../hooks/useSettings';
import type { RcloneProvider, RcloneRemote, RcloneStatus, RemoteBackupEntry, SyncJobWithRuntime, SyncScope } from '../../types/rcloneApi';
import { PathAutocomplete } from '../shared/PathAutocomplete';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { AddRemoteForm } from './AddRemoteForm';
import { ScheduleFields } from './ScheduleFields';

const POLL_INTERVAL_MS = 3000;

const PROVIDER_SWATCH_COLORS = ['b2', 'gdrive', 'sftp'] as const;
function providerSwatchClass(type: string): string {
  // A handful of the most common providers get their own explicit color (matching the mockup's
  // b2/gdrive/sftp examples); everything else falls back to a stable hash across the same three
  // tints rather than adding a fourth/fifth color just for swatches - rclone has 69 providers, far
  // more than this app's palette should grow dedicated colors for.
  if (type === 'b2') return 'provider-swatch--b2';
  if (type === 'drive') return 'provider-swatch--gdrive';
  if (type === 'sftp') return 'provider-swatch--sftp';
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return `provider-swatch--${PROVIDER_SWATCH_COLORS[hash % PROVIDER_SWATCH_COLORS.length]}`;
}
function providerAbbrev(type: string): string {
  return type.slice(0, 2).toUpperCase();
}

function formatRelativeTime(ms: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('RemoteBackupSection.justNow');
  if (minutes < 60) return t('RemoteBackupSection.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('RemoteBackupSection.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('RemoteBackupSection.daysAgo', { count: days });
}
function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/**
 * The "existing backups found" notice's own message - handles all three mix edge cases the same
 * way (surface it, never block): the new job's own encryption setting agrees with everything
 * already there (nothing extra to say), disagrees entirely (a nudge, since it's likely a mistake -
 * two jobs pointed at the same path, or "meant to turn encryption on/off"), or it's a genuine mix
 * of both (report the real split, not a collapsed single state).
 */
function describeExistingBackups(
  count: number,
  encryptedCount: number,
  jobEncryptionEnabled: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const unencryptedCount = count - encryptedCount;
  if (encryptedCount === 0 && unencryptedCount === 0) return '';
  if (encryptedCount > 0 && unencryptedCount > 0) {
    return t('RemoteBackupSection.mixEncryptedAndUnencrypted', { encryptedCount, unencryptedCount });
  }
  if (jobEncryptionEnabled && unencryptedCount > 0) {
    return t('RemoteBackupSection.willAddEncryptedAlongside', { unencryptedCount });
  }
  if (!jobEncryptionEnabled && encryptedCount > 0) {
    return t('RemoteBackupSection.wontEncryptAlongsideExisting', { encryptedCount });
  }
  return '';
}

const SCOPE_LABEL_KEYS: Record<SyncScope, string> = {
  config: 'RemoteBackupSection.scopeConfig',
  configAppdata: 'RemoteBackupSection.scopeConfigAppdata',
  custom: 'RemoteBackupSection.scopeCustom',
};

interface JobDraft {
  name: string;
  scope: SyncScope;
  customPath: string;
  remoteName: string;
  remotePath: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'cron';
  dayOfWeek: number;
  dayOfMonth: number;
  hour: number;
  cronExpression: string;
  keepDays: string;
  forever: boolean;
  // Only meaningful when scope !== 'custom' - see SyncJob.encryption's own doc comment (backend's
  // rclone/types.ts) for why a 'custom' scope (live folder mirror) never offers this. `encryptPassword`
  // is always blank to start, even when editing an already-encrypted job - never round-tripped
  // from the server (see SyncJobEncryption's own doc comment); `hadPassword` (not itself editable)
  // is what drives the "leave blank to keep the current password" placeholder vs. "required" hint.
  encryptEnabled: boolean;
  encryptPassword: string;
  hadPassword: boolean;
}

function draftFromJob(job: SyncJobWithRuntime): JobDraft {
  return {
    name: job.name,
    scope: job.scope,
    customPath: job.customPath,
    remoteName: job.remoteName,
    remotePath: job.remotePath,
    frequency: job.schedule.frequency,
    dayOfWeek: job.schedule.dayOfWeek,
    dayOfMonth: job.schedule.dayOfMonth,
    hour: job.schedule.hour,
    cronExpression: job.schedule.cronExpression,
    keepDays: String(job.retention.keepDays),
    forever: job.retention.forever,
    encryptEnabled: job.encryption.enabled,
    encryptPassword: '',
    hadPassword: job.encryption.hasPassword,
  };
}

const NEW_JOB_DRAFT: JobDraft = {
  name: '',
  scope: 'config',
  customPath: '',
  remoteName: '',
  remotePath: '',
  frequency: 'daily',
  dayOfWeek: 0,
  dayOfMonth: 1,
  hour: 3,
  cronExpression: '',
  keepDays: '30',
  forever: false,
  encryptEnabled: false,
  encryptPassword: '',
  hadPassword: false,
};

export function RemoteBackupSection() {
  const { t } = useTranslation('settings');
  const { settings } = useSettings();
  const hour12 = settings?.timeFormat !== '24h';

  const [status, setStatus] = useState<RcloneStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  const [remotes, setRemotes] = useState<RcloneRemote[] | null>(null);
  const [providers, setProviders] = useState<RcloneProvider[] | null>(null);
  const [jobs, setJobs] = useState<SyncJobWithRuntime[] | null>(null);

  const [showAddRemote, setShowAddRemote] = useState(false);
  const [removingRemote, setRemovingRemote] = useState<string | null>(null);
  const [removeRemoteError, setRemoveRemoteError] = useState<string | null>(null);
  // Set while editing an existing remote (as opposed to adding a new one) - passed straight
  // through to AddRemoteForm's own `editingRemote` prop, which pre-fills and locks the
  // name/provider fields. rclone has no "rename" or "change provider" operation on an existing
  // remote (that's delete + recreate in its own real-world model), so both stay read-only there.
  const [editingRemote, setEditingRemote] = useState<RcloneRemote | null>(null);

  const [editingJobId, setEditingJobId] = useState<string | 'new' | null>(null);
  const [jobDraft, setJobDraft] = useState<JobDraft>(NEW_JOB_DRAFT);
  const [jobSaving, setJobSaving] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobActionError, setJobActionError] = useState<string | null>(null);
  // Set right after creating a new job whose target already has archives sitting in it from
  // some other source (a prior install, a job pointed at the same remote/path, etc.) - jobs don't
  // know about each other's history, so without this a fresh job silently starts adding to
  // whatever's already there with no indication it's not the first thing to ever land here.
  // `encryptedCount`/`jobEncryptionEnabled` are what let the notice call out an
  // encrypted/unencrypted mix (see describeExistingBackups() below) - not just a plain count.
  const [existingBackupsFound, setExistingBackupsFound] = useState<{ jobName: string; count: number; encryptedCount: number; jobEncryptionEnabled: boolean } | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = () =>
    rcloneApi
      .getStatus()
      .then(setStatus)
      .catch((err) => setLoadError((err as Error).message));
  const loadRemotes = () =>
    rcloneApi
      .getRemotes()
      .then(setRemotes)
      .catch(() => {});
  const loadJobs = () =>
    rcloneApi
      .getJobs()
      .then(setJobs)
      .catch(() => {});

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    if (!status?.featureEnabled) return;
    loadRemotes();
    loadJobs();
    rcloneApi
      .getProviders()
      .then(setProviders)
      .catch(() => {});
    pollTimer.current = setInterval(() => {
      loadRemotes();
      loadJobs();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.featureEnabled]);

  const toggleEnabled = async () => {
    if (!status) return;
    setEnabling(true);
    setEnableError(null);
    try {
      await rcloneApi.setEnabled(!status.featureEnabled);
      await loadStatus();
    } catch (err) {
      setEnableError((err as Error).message);
    } finally {
      setEnabling(false);
    }
  };

  const startAddRemote = () => {
    setEditingRemote(null);
    setShowAddRemote(true);
  };

  const startEditRemote = (remote: RcloneRemote) => {
    setEditingRemote(remote);
    setShowAddRemote(true);
  };

  const cancelRemoteForm = () => {
    setShowAddRemote(false);
    setEditingRemote(null);
  };

  const handleRemoteAdded = async () => {
    cancelRemoteForm();
    await loadRemotes();
  };

  const removeRemote = async (name: string) => {
    setRemovingRemote(name);
    setRemoveRemoteError(null);
    try {
      await rcloneApi.deleteRemote(name);
      await loadRemotes();
    } catch (err) {
      setRemoveRemoteError((err as Error).message);
    } finally {
      setRemovingRemote(null);
    }
  };

  const startNewJob = () => {
    setJobDraft({ ...NEW_JOB_DRAFT, remoteName: remotes?.[0]?.name ?? '' });
    setEditingJobId('new');
    setJobError(null);
  };

  const startEditJob = (job: SyncJobWithRuntime) => {
    setJobDraft(draftFromJob(job));
    setEditingJobId(job.id);
    setJobError(null);
  };

  const cancelJobEdit = () => {
    setEditingJobId(null);
    setJobError(null);
  };

  const saveJob = async () => {
    if (!jobDraft.name.trim()) {
      setJobError(t('RemoteBackupSection.nameRequired'));
      return;
    }
    if (!jobDraft.remoteName) {
      setJobError(t('RemoteBackupSection.pickDestinationRemote'));
      return;
    }
    if (jobDraft.scope === 'custom' && !jobDraft.customPath.trim()) {
      setJobError(t('RemoteBackupSection.enterPathToSync'));
      return;
    }
    const keepDays = Number(jobDraft.keepDays);
    if (!jobDraft.forever && (!Number.isInteger(keepDays) || keepDays < 1)) {
      setJobError(t('RemoteBackupSection.enterPositiveWholeNumber'));
      return;
    }
    if (jobDraft.frequency === 'cron' && !jobDraft.cronExpression.trim()) {
      setJobError(t('RemoteBackupSection.enterCronExpression'));
      return;
    }
    // Custom-scope jobs mirror a folder file-by-file, never a single archive - encryption isn't
    // offered for them (see SyncJob.encryption's own doc comment), so it's always off regardless
    // of whatever the toggle happened to show before the scope was switched.
    const encryptionEnabled = jobDraft.scope !== 'custom' && jobDraft.encryptEnabled;
    if (encryptionEnabled && !jobDraft.encryptPassword.trim() && !jobDraft.hadPassword) {
      setJobError(t('RemoteBackupSection.enterPasswordToEnableEncryption'));
      return;
    }
    setJobSaving(true);
    setJobError(null);
    const body = {
      name: jobDraft.name.trim(),
      enabled: true,
      scope: jobDraft.scope,
      customPath: jobDraft.customPath.trim(),
      remoteName: jobDraft.remoteName,
      remotePath: jobDraft.remotePath.trim(),
      schedule: {
        enabled: true,
        frequency: jobDraft.frequency,
        dayOfWeek: jobDraft.dayOfWeek,
        dayOfMonth: jobDraft.dayOfMonth,
        hour: jobDraft.hour,
        cronExpression: jobDraft.cronExpression.trim(),
      },
      retention: { keepDays: keepDays || 1, forever: jobDraft.forever },
      encryption: { enabled: encryptionEnabled, password: jobDraft.encryptPassword.trim() || undefined },
    };
    try {
      if (editingJobId === 'new') {
        const created = await rcloneApi.createJob(body);
        setExistingBackupsFound(null);
        // Only 'config'/'configAppdata' jobs produce a listable archive at all (see
        // listJobBackups' own scope check) - a fresh 'custom' mirror job has nothing to probe for.
        if (created.scope !== 'custom') {
          rcloneApi
            .listJobBackups(created.id)
            .then((entries: RemoteBackupEntry[]) => {
              if (entries.length > 0) {
                setExistingBackupsFound({
                  jobName: created.name,
                  count: entries.length,
                  encryptedCount: entries.filter((e) => e.encrypted).length,
                  jobEncryptionEnabled: created.encryption.enabled,
                });
              }
            })
            .catch(() => {});
        }
      } else if (editingJobId) {
        await rcloneApi.updateJob(editingJobId, body);
      }
      setEditingJobId(null);
      await loadJobs();
    } catch (err) {
      setJobError((err as Error).message);
    } finally {
      setJobSaving(false);
    }
  };

  const deleteJob = async (id: string) => {
    setJobActionError(null);
    try {
      await rcloneApi.deleteJob(id);
      await loadJobs();
    } catch (err) {
      setJobActionError((err as Error).message);
    }
  };

  const toggleJobEnabled = async (job: SyncJobWithRuntime) => {
    setJobActionError(null);
    try {
      await rcloneApi.setJobEnabled(job.id, !job.enabled);
      await loadJobs();
    } catch (err) {
      setJobActionError((err as Error).message);
    }
  };

  const syncNow = async (id: string) => {
    setJobActionError(null);
    // Fire-and-forget on purpose: this resolves only once the whole sync finishes (the backend
    // request stays open for the duration), but the polling loop above already picks up the
    // 'syncing' state/live progress within POLL_INTERVAL_MS regardless of when this promise
    // itself settles - awaiting it here would just delay the "started" UI feedback for no benefit.
    rcloneApi
      .syncNow(id)
      .then(loadJobs)
      .catch((err) => setJobActionError((err as Error).message));
    await loadJobs();
  };

  const cancelSync = async (id: string) => {
    setJobActionError(null);
    try {
      await rcloneApi.cancelSync(id);
      await loadJobs();
    } catch (err) {
      setJobActionError((err as Error).message);
    }
  };

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!status) return <div className="status-note">{t('RemoteBackupSection.loading')}</div>;

  if (!status.installed) {
    return (
      <div className="settings-card">
        <div className="settings-card__title">
          <span className="settings-card__title-text">{t('RemoteBackupSection.title')}</span>
        </div>
        <div className="toggle-row__desc">
          {t('RemoteBackupSection.notInstalled1')} <code>rclone</code> {t('RemoteBackupSection.notInstalled2')} <code>tools/install-webui.sh</code>{' '}
          {t('RemoteBackupSection.notInstalled3')}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-card">
      <div className="settings-card__title settings-card__title--with-link">
        <span className="settings-card__title-text">
          {t('RemoteBackupSection.title')} <span className="badge-new">{t('RemoteBackupSection.new')}</span>
        </span>
        <Link to="/settings#recovery" className="settings-card__title-link">
          {t('RemoteBackupSection.recoveryLink')}
        </Link>
      </div>

      <div className="toggle-row" style={{ paddingTop: 0 }}>
        <div>
          <div className="toggle-row__title">{t('RemoteBackupSection.syncBackupsTitle')}</div>
          <div className="toggle-row__desc" style={{ paddingBottom: 0 }}>
            {t('RemoteBackupSection.syncBackupsDesc')}{' '}
            <a href="https://rclone.org/docs/" target="_blank" rel="noreferrer">
              {t('RemoteBackupSection.rcloneDocsLink')}
            </a>
          </div>
        </div>
        <ToggleSwitch on={status.featureEnabled} onToggle={toggleEnabled} label={t('RemoteBackupSection.title')} disabled={enabling} />
      </div>
      {enableError && <div className="status-note status-note--error">{enableError}</div>}

      {status.featureEnabled && (
        <>
          {!status.running && (
            <div className="status-note status-note--error">
              {t('RemoteBackupSection.rcloneNotReachable1')} <code>systemctl status rclone-rcd</code> {t('RemoteBackupSection.rcloneNotReachable2')}
            </div>
          )}

          <hr className="divider" />

          <div className="settings-field" style={{ paddingTop: 0 }}>
            <div className="settings-field__label">{t('RemoteBackupSection.remotes')}</div>
            <div className="remote-list">
              {(remotes ?? []).map((r) => (
                <div className="remote-row" key={r.name}>
                  <div className={`remote-row__icon ${providerSwatchClass(r.type)}`}>{providerAbbrev(r.type)}</div>
                  <div className="remote-row__body">
                    <div className="remote-row__name">{r.name}</div>
                    <div className="remote-row__meta">{providers?.find((p) => p.name === r.type)?.description ?? r.type}</div>
                  </div>
                  <div className="remote-row__status">
                    <span
                      className="status-dot"
                      style={{
                        background: r.status === 'ok' ? 'var(--color-green)' : r.status === 'authExpired' ? 'var(--color-red)' : 'var(--color-text-dim)',
                      }}
                    />
                    {r.status === 'ok'
                      ? t('RemoteBackupSection.connected')
                      : r.status === 'authExpired'
                        ? t('RemoteBackupSection.authExpired')
                        : r.status === 'error'
                          ? t('RemoteBackupSection.error')
                          : t('RemoteBackupSection.unknown')}
                  </div>
                  <div className="remote-row__actions">
                    {r.status === 'authExpired' && (
                      <button type="button" className="btn" onClick={() => loadRemotes()}>
                        {t('RemoteBackupSection.reconnect')}
                      </button>
                    )}
                    <button type="button" className="btn" onClick={() => startEditRemote(r)}>
                      {t('RemoteBackupSection.edit')}
                    </button>
                    <button type="button" className="btn btn--danger" disabled={removingRemote === r.name} onClick={() => removeRemote(r.name)}>
                      {removingRemote === r.name ? t('RemoteBackupSection.removing') : t('RemoteBackupSection.remove')}
                    </button>
                  </div>
                </div>
              ))}
              {remotes?.length === 0 && <div className="status-note">{t('RemoteBackupSection.noRemotesConfigured')}</div>}
            </div>
            {removeRemoteError && <div className="status-note status-note--error">{removeRemoteError}</div>}

            {!showAddRemote && (
              <button type="button" className="add-sync-btn" style={{ marginTop: 8 }} onClick={startAddRemote}>
                {t('RemoteBackupSection.addRemote')}
              </button>
            )}

            {showAddRemote && <AddRemoteForm key={editingRemote?.name ?? 'new'} providers={providers ?? []} editingRemote={editingRemote} onAdded={handleRemoteAdded} onCancel={cancelRemoteForm} />}
          </div>

          <hr className="divider" />

          <div className="settings-field" style={{ paddingTop: 0 }}>
            <div className="settings-field__label">{t('RemoteBackupSection.syncs')}</div>
            {existingBackupsFound && (
              <div className="status-note">
                {t('RemoteBackupSection.foundExistingBackups', { count: existingBackupsFound.count })}{' '}
                {describeExistingBackups(existingBackupsFound.count, existingBackupsFound.encryptedCount, existingBackupsFound.jobEncryptionEnabled, t)}{' '}
                {t('RemoteBackupSection.alreadyAtDestination', { jobName: existingBackupsFound.jobName })}{' '}
                <Link to="/settings#recovery">{t('RemoteBackupSection.settingsRecoveryLink')}</Link>.{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setExistingBackupsFound(null);
                  }}
                >
                  {t('RemoteBackupSection.dismiss')}
                </a>
              </div>
            )}
            {jobActionError && <div className="status-note status-note--error">{jobActionError}</div>}
            <div className="sync-job-list">
              {(jobs ?? []).map((job) => (editingJobId === job.id ? <JobEditor key={job.id} draft={jobDraft} setDraft={setJobDraft} remotes={remotes ?? []} hour12={hour12} saving={jobSaving} error={jobError} onSave={saveJob} onCancel={cancelJobEdit} /> : <JobCard key={job.id} job={job} remoteMissing={remotes !== null && !remotes.some((r) => r.name === job.remoteName)} onEdit={() => startEditJob(job)} onDelete={() => deleteJob(job.id)} onToggleEnabled={() => toggleJobEnabled(job)} onSyncNow={() => syncNow(job.id)} onCancelSync={() => cancelSync(job.id)} />))}
              {editingJobId === 'new' && <JobEditor draft={jobDraft} setDraft={setJobDraft} remotes={remotes ?? []} hour12={hour12} saving={jobSaving} error={jobError} onSave={saveJob} onCancel={cancelJobEdit} />}
            </div>
            {editingJobId === null && (
              <button type="button" className="add-sync-btn" style={{ marginTop: 12 }} onClick={startNewJob} disabled={(remotes ?? []).length === 0}>
                {t('RemoteBackupSection.addSync')}
              </button>
            )}
            {(remotes ?? []).length === 0 && editingJobId === null && (
              <div className="settings-field__hint">{t('RemoteBackupSection.addRemoteBeforeSync')}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function JobCard({
  job,
  remoteMissing,
  onEdit,
  onDelete,
  onToggleEnabled,
  onSyncNow,
  onCancelSync,
}: {
  job: SyncJobWithRuntime;
  // True when this job's own remoteName no longer matches any configured remote (it was removed
  // out from under this job) - see RcloneClient.deleteRemote()/removeRemote() above. The job
  // record itself is left alone (still referencing the now-gone name) rather than auto-deleted or
  // auto-disabled, same "don't silently mutate a saved record" reasoning as everywhere else in
  // this app - this just surfaces it clearly instead of quietly failing next Sync now.
  remoteMissing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onSyncNow: () => void;
  onCancelSync: () => void;
}) {
  const { t } = useTranslation('settings');
  const dayAbbrevKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const scheduleSummary =
    job.schedule.frequency === 'cron'
      ? t('RemoteBackupSection.scheduleCron', { expr: job.schedule.cronExpression })
      : job.schedule.frequency === 'daily'
        ? t('RemoteBackupSection.scheduleDaily', { hour: String(job.schedule.hour).padStart(2, '0') })
        : job.schedule.frequency === 'weekly'
          ? t('RemoteBackupSection.scheduleWeekly', {
              day: t(`RemoteBackupSection.dayAbbrev_${dayAbbrevKeys[job.schedule.dayOfWeek]}`),
              hour: String(job.schedule.hour).padStart(2, '0'),
            })
          : t('RemoteBackupSection.scheduleMonthly', { day: job.schedule.dayOfMonth, hour: String(job.schedule.hour).padStart(2, '0') });

  const modifierClass = job.state === 'syncing' ? 'sync-job--enabled sync-job--syncing' : remoteMissing ? 'sync-job--error' : job.state === 'disabled' ? 'sync-job--disabled' : 'sync-job--enabled';
  const destLabel = job.scope === 'custom' ? t('RemoteBackupSection.scopeCustomWithPath', { path: job.customPath || '…' }) : t(SCOPE_LABEL_KEYS[job.scope]);

  return (
    <div className={`sync-job ${modifierClass}`}>
      <div className="sync-job__head">
        <div className="sync-job__title">
          <span className="sync-job__name">
            {destLabel} → {job.remoteName || '…'}
          </span>
          {job.encryption.enabled && (
            <span className="job-badge job-badge--encrypted" title={t('RemoteBackupSection.encryptedTooltip')}>
              {t('RemoteBackupSection.encrypted')}
            </span>
          )}
          {job.state === 'syncing' ? (
            <span className="job-badge job-badge--syncing">
              <span className="status-dot status-dot--pulse" style={{ background: 'var(--color-blue)' }} />
              {t('RemoteBackupSection.syncingEllipsis')}
            </span>
          ) : remoteMissing ? (
            <span className="job-badge job-badge--error">{t('RemoteBackupSection.remoteMissing')}</span>
          ) : job.state === 'disabled' ? (
            <span className="job-badge job-badge--disabled">{t('RemoteBackupSection.disabled')}</span>
          ) : (
            <span className="job-badge job-badge--active">{t('RemoteBackupSection.active')}</span>
          )}
        </div>
        {job.state !== 'syncing' && <span className="sync-job__schedule">{scheduleSummary}</span>}
      </div>

      {job.state === 'syncing' && job.progress ? (
        <div className="sync-progress">
          <div className="sync-progress__row">
            <span>{t('RemoteBackupSection.transferringFiles', { done: job.progress.filesDone, total: job.progress.filesTotal || '?' })}</span>
            <span>
              {t('RemoteBackupSection.speedPerSec', { speed: formatBytes(job.progress.speedBytesPerSec) })}
              {job.progress.etaSeconds !== null ? ` · ${t('RemoteBackupSection.eta', { eta: formatEta(job.progress.etaSeconds) })}` : ''}
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-track__fill"
              style={{
                width: `${job.progress.totalBytes > 0 ? Math.min(100, (job.progress.bytes / job.progress.totalBytes) * 100) : 0}%`,
              }}
            />
          </div>
          {job.progress.transferringName && (
            <div className="sync-progress__row">
              <span className="sync-progress__file">{job.progress.transferringName}</span>
              <span>{formatBytes(job.progress.bytes)}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="sync-job__stats">
          <span
            className="status-dot"
            style={{
              background: job.state === 'disabled' ? 'var(--color-text-dim)' : 'var(--color-green)',
            }}
          />
          {job.lastSyncedAt ? (
            <>
              {t('RemoteBackupSection.lastSynced')} <strong>{formatRelativeTime(job.lastSyncedAt, t)}</strong>
              {job.lastSizeBytes !== null && <> · {formatBytes(job.lastSizeBytes)}</>}
              {job.lastFileCount !== null && <> · {t('RemoteBackupSection.filesCount', { count: job.lastFileCount })}</>}
              {job.lastErrorCount !== null && <> · {t('RemoteBackupSection.errorsCount', { count: job.lastErrorCount })}</>}
            </>
          ) : (
            t('RemoteBackupSection.neverSyncedYet')
          )}
        </div>
      )}
      {job.lastError && job.state !== 'syncing' && <div className="status-note status-note--error">{job.lastError}</div>}
      {remoteMissing && job.state !== 'syncing' && (
        <div className="status-note status-note--error">{t('RemoteBackupSection.remoteNoLongerExists', { remoteName: job.remoteName })}</div>
      )}

      <div className="sync-job__actions">
        {job.state === 'syncing' ? (
          <button type="button" className="btn btn--danger" onClick={onCancelSync}>
            {t('RemoteBackupSection.cancel')}
          </button>
        ) : (
          <button type="button" className="btn btn--primary-sm" disabled={job.state === 'disabled' || remoteMissing} onClick={onSyncNow}>
            {t('RemoteBackupSection.syncNow')}
          </button>
        )}
        <button type="button" className="btn" disabled={job.state === 'syncing'} onClick={onEdit}>
          {t('RemoteBackupSection.edit')}
        </button>
        <button type="button" className="btn" disabled={job.state === 'syncing'} onClick={onToggleEnabled}>
          {job.state === 'disabled' ? t('RemoteBackupSection.enable') : t('RemoteBackupSection.disable')}
        </button>
        <button type="button" className="btn btn--danger" disabled={job.state === 'syncing'} onClick={onDelete}>
          {t('RemoteBackupSection.delete')}
        </button>
      </div>
    </div>
  );
}

function JobEditor({ draft, setDraft, remotes, hour12, saving, error, onSave, onCancel }: { draft: JobDraft; setDraft: (updater: (prev: JobDraft) => JobDraft) => void; remotes: RcloneRemote[]; hour12: boolean; saving: boolean; error: string | null; onSave: () => void; onCancel: () => void }) {
  const { t } = useTranslation('settings');
  return (
    <div className="sync-job sync-job--editing">
      <div className="sync-job__head">
        <div className="sync-job__title">
          <span className="sync-job__name">{draft.name || t('RemoteBackupSection.editingSync')}</span>
          <span className="job-badge job-badge--editing">{t('RemoteBackupSection.editing')}</span>
        </div>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>{t('RemoteBackupSection.name')}</span>
          <input
            className="history-input"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder={t('RemoteBackupSection.namePlaceholder')}
          />
        </label>
        <label className="field">
          <span>{t('RemoteBackupSection.whatToSync')}</span>
          <select
            className="history-input"
            value={draft.scope}
            onChange={(e) => {
              const scope = e.target.value as SyncScope;
              // Encryption isn't offered for 'custom' scope (a live file-by-file mirror, not a
              // single archive - see SyncJob.encryption's own doc comment) - switching to it turns
              // the toggle back off rather than leaving a stale "on" that saveJob() would silently
              // ignore anyway.
              setDraft((d) => ({ ...d, scope, encryptEnabled: scope === 'custom' ? false : d.encryptEnabled }));
            }}
          >
            <option value="config">{t('RemoteBackupSection.scopeConfig')}</option>
            <option value="configAppdata">{t('RemoteBackupSection.scopeConfigAppdata')}</option>
            <option value="custom">{t('RemoteBackupSection.scopeCustomEllipsis')}</option>
          </select>
        </label>
        {draft.scope === 'custom' && (
          <label className="field field-grid--full">
            <span>{t('RemoteBackupSection.path')}</span>
            <PathAutocomplete scope="browse" value={draft.customPath} onChange={(v) => setDraft((d) => ({ ...d, customPath: v }))} placeholder="/mnt/user/..." />
          </label>
        )}
        <label className="field">
          <span>{t('RemoteBackupSection.destination')}</span>
          <select className="history-input" value={draft.remoteName} onChange={(e) => setDraft((d) => ({ ...d, remoteName: e.target.value }))}>
            {remotes.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('RemoteBackupSection.remotePathOptional')}</span>
          <input
            className="history-input"
            value={draft.remotePath}
            onChange={(e) => setDraft((d) => ({ ...d, remotePath: e.target.value }))}
            placeholder="bucket/subfolder"
          />
        </label>

        {/* Day-based, uniformly across every scope - not a "keep last N" count. Same model rclone's
            own --backup-dir versioning uses (see backend/src/rclone/service.ts's enforceRetention
            doc comment) whether this job syncs a live mirror ('custom') or uploads discrete dated
            archives ('config'/'configAppdata'). */}
        <label className="field field-grid--full">
          <span>{t('RemoteBackupSection.keepVersionsFor')}</span>
          <div className={`settings-field__row${draft.forever ? ' retention-input--disabled' : ''}`} style={{ flexWrap: 'nowrap' }}>
            <input className="history-input" type="number" min={1} step={1} style={{ width: 100 }} value={draft.keepDays} onChange={(e) => setDraft((d) => ({ ...d, keepDays: e.target.value }))} disabled={draft.forever} />
            <span className="settings-field__hint" style={{ alignSelf: 'center' }}>
              {t('RemoteBackupSection.days')}
            </span>
          </div>
          <div className="keep-forever-row" style={{ marginTop: 0 }}>
            <input className="round-checkbox" type="checkbox" id={`forever-${draft.name || 'new'}`} checked={draft.forever} onChange={(e) => setDraft((d) => ({ ...d, forever: e.target.checked }))} />
            <label htmlFor={`forever-${draft.name || 'new'}`}>{t('RemoteBackupSection.keepForever')}</label>
          </div>
        </label>

        {/* Not offered for 'custom' scope - see the scope <select>'s own onChange comment above. */}
        {draft.scope !== 'custom' && (
          <label className="field field-grid--full">
            <span>{t('RemoteBackupSection.encryption')}</span>
            <div className="keep-forever-row" style={{ marginTop: 0 }}>
              <input
                className="round-checkbox"
                type="checkbox"
                id={`encrypt-${draft.name || 'new'}`}
                checked={draft.encryptEnabled}
                onChange={(e) => setDraft((d) => ({ ...d, encryptEnabled: e.target.checked }))}
              />
              <label htmlFor={`encrypt-${draft.name || 'new'}`}>{t('RemoteBackupSection.encryptionCheckboxLabel')}</label>
            </div>
            {draft.encryptEnabled && (
              <input
                className="history-input"
                type="password"
                style={{ marginTop: 8 }}
                value={draft.encryptPassword}
                onChange={(e) => setDraft((d) => ({ ...d, encryptPassword: e.target.value }))}
                placeholder={draft.hadPassword ? t('RemoteBackupSection.keepCurrentPassword') : t('RemoteBackupSection.password')}
              />
            )}
          </label>
        )}
      </div>

      <div className="schedule-row">
        <div className="schedule-row__label">{t('RemoteBackupSection.schedule')}</div>
        <ScheduleFields frequency={draft.frequency} onFrequencyChange={(f) => setDraft((d) => ({ ...d, frequency: f }))} dayOfWeek={draft.dayOfWeek} onDayOfWeekChange={(v) => setDraft((d) => ({ ...d, dayOfWeek: v }))} dayOfMonth={draft.dayOfMonth} onDayOfMonthChange={(v) => setDraft((d) => ({ ...d, dayOfMonth: v }))} hour={draft.hour} onHourChange={(v) => setDraft((d) => ({ ...d, hour: v }))} hour12={hour12} allowCron cronExpression={draft.cronExpression} onCronExpressionChange={(v) => setDraft((d) => ({ ...d, cronExpression: v }))} />
      </div>

      {error && <div className="status-note status-note--error">{error}</div>}
      <div className="sync-job__actions">
        <button type="button" className="btn btn--primary-sm" disabled={saving} onClick={onSave}>
          {saving ? t('RemoteBackupSection.saving') : t('RemoteBackupSection.save')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t('RemoteBackupSection.cancel')}
        </button>
      </div>
    </div>
  );
}
