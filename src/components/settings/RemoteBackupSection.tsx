import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rcloneApi } from '../../api/rcloneApi';
import { useSettings } from '../../hooks/useSettings';
import type { RcloneProvider, RcloneRemote, RcloneStatus, SyncJobWithRuntime, SyncScope } from '../../types/rcloneApi';
import { PathAutocomplete } from '../shared/PathAutocomplete';
import { ToggleSwitch } from '../shared/ToggleSwitch';
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

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
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

const SCOPE_LABELS: Record<SyncScope, string> = {
  config: 'Config backups',
  configAppdata: 'Config backups + appdata',
  custom: 'Custom',
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
};

export function RemoteBackupSection() {
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
  const [remoteType, setRemoteType] = useState('');
  const [remoteName, setRemoteName] = useState('');
  const [remoteFields, setRemoteFields] = useState<Record<string, string>>({});
  const [remoteSaving, setRemoteSaving] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteAuth, setRemoteAuth] = useState<{
    name: string;
    type: string;
    authUrl: string | null;
    state: string;
  } | null>(null);
  const [removingRemote, setRemovingRemote] = useState<string | null>(null);
  // Set while editing an existing remote (as opposed to adding a new one) - reuses the same
  // provider-fields form as Add remote, just with `name`/`remoteType` fixed and pre-filled fields.
  // rclone has no "rename" or "change provider" operation on an existing remote (that's delete +
  // recreate in its own real-world model), so both stay read-only here; config/update only ever
  // touches the provider's own parameters.
  const [editingRemoteName, setEditingRemoteName] = useState<string | null>(null);
  const [remoteConfigLoading, setRemoteConfigLoading] = useState(false);

  const [editingJobId, setEditingJobId] = useState<string | 'new' | null>(null);
  const [jobDraft, setJobDraft] = useState<JobDraft>(NEW_JOB_DRAFT);
  const [jobSaving, setJobSaving] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobActionError, setJobActionError] = useState<string | null>(null);

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
    setEditingRemoteName(null);
    setShowAddRemote(true);
    setRemoteType(providers?.[0]?.name ?? '');
    setRemoteName('');
    setRemoteFields({});
    setRemoteError(null);
    setRemoteAuth(null);
  };

  const startEditRemote = async (remote: RcloneRemote) => {
    setShowAddRemote(true);
    setEditingRemoteName(remote.name);
    setRemoteType(remote.type);
    setRemoteName(remote.name);
    setRemoteFields({});
    setRemoteError(null);
    setRemoteAuth(null);
    setRemoteConfigLoading(true);
    try {
      const cfg = await rcloneApi.getRemoteConfig(remote.name);
      // Never pre-fill a password/secret field with its saved (obscured) value - leave it blank
      // with a placeholder instead; only send it back if the admin actually types a new value.
      const provider = providers?.find((p) => p.name === cfg.type);
      const prefill: Record<string, string> = {};
      for (const opt of provider?.options ?? []) {
        if (opt.isPassword) continue;
        if (cfg.parameters[opt.name] !== undefined) prefill[opt.name] = cfg.parameters[opt.name];
      }
      setRemoteFields(prefill);
    } catch (err) {
      setRemoteError((err as Error).message);
    } finally {
      setRemoteConfigLoading(false);
    }
  };

  const cancelRemoteForm = () => {
    setShowAddRemote(false);
    setEditingRemoteName(null);
    setRemoteAuth(null);
    setRemoteError(null);
  };

  const submitRemote = async () => {
    if (editingRemoteName) {
      setRemoteSaving(true);
      setRemoteError(null);
      try {
        await rcloneApi.updateRemote(editingRemoteName, remoteFields);
        cancelRemoteForm();
        await loadRemotes();
      } catch (err) {
        setRemoteError((err as Error).message);
      } finally {
        setRemoteSaving(false);
      }
      return;
    }
    if (!remoteName.trim() || !remoteType) {
      setRemoteError('Provider and name are required.');
      return;
    }
    setRemoteSaving(true);
    setRemoteError(null);
    try {
      const result = await rcloneApi.createRemote(remoteName.trim(), remoteType, remoteFields);
      if (result.done) {
        cancelRemoteForm();
        await loadRemotes();
      } else {
        setRemoteAuth({
          name: remoteName.trim(),
          type: remoteType,
          authUrl: result.authUrl,
          state: result.state ?? '',
        });
      }
    } catch (err) {
      setRemoteError((err as Error).message);
    } finally {
      setRemoteSaving(false);
    }
  };

  const continueRemoteAuth = async () => {
    if (!remoteAuth) return;
    setRemoteSaving(true);
    setRemoteError(null);
    try {
      const result = await rcloneApi.continueRemoteSetup(remoteAuth.name, remoteAuth.type, remoteAuth.state);
      if (result.done) {
        cancelRemoteForm();
        await loadRemotes();
      } else {
        setRemoteAuth({
          ...remoteAuth,
          authUrl: result.authUrl,
          state: result.state ?? '',
        });
      }
    } catch (err) {
      setRemoteError((err as Error).message);
    } finally {
      setRemoteSaving(false);
    }
  };

  const removeRemote = async (name: string) => {
    setRemovingRemote(name);
    try {
      await rcloneApi.deleteRemote(name);
      await loadRemotes();
    } catch (err) {
      setRemoteError((err as Error).message);
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
      setJobError('Name is required.');
      return;
    }
    if (!jobDraft.remoteName) {
      setJobError('Pick a destination remote.');
      return;
    }
    if (jobDraft.scope === 'custom' && !jobDraft.customPath.trim()) {
      setJobError('Enter a path to sync.');
      return;
    }
    const keepDays = Number(jobDraft.keepDays);
    if (!jobDraft.forever && (!Number.isInteger(keepDays) || keepDays < 1)) {
      setJobError('Enter a positive whole number of days.');
      return;
    }
    if (jobDraft.frequency === 'cron' && !jobDraft.cronExpression.trim()) {
      setJobError('Enter a cron expression.');
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
    };
    try {
      if (editingJobId === 'new') {
        await rcloneApi.createJob(body);
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
  if (!status) return <div className="status-note">Loading…</div>;

  if (!status.installed) {
    return (
      <div className="settings-card">
        <div className="settings-card__title">
          <span className="settings-card__title-text">
            Remote Backup <span className="badge-new">New</span>
          </span>
        </div>
        <div className="toggle-row__desc">
          The <code>rclone</code> package isn't installed on this host. Re-run <code>tools/install-webui.sh</code> to enable this section.
        </div>
      </div>
    );
  }

  const selectedProvider = providers?.find((p) => p.name === remoteType) ?? null;

  return (
    <div className="settings-card">
      <div className="settings-card__title settings-card__title--with-link">
        <span className="settings-card__title-text">
          Remote Backup <span className="badge-new">New</span>
        </span>
        <Link to="/settings#recovery" className="settings-card__title-link">
          Recovery →
        </Link>
      </div>

      <div className="toggle-row" style={{ paddingTop: 0 }}>
        <div>
          <div className="toggle-row__title">Sync backups to remote storage</div>
          <div className="toggle-row__desc" style={{ paddingBottom: 0 }}>
            S3, Backblaze B2, Google Drive, SFTP, and 70+ others via rclone. Disabled by default.
          </div>
        </div>
        <ToggleSwitch on={status.featureEnabled} onToggle={toggleEnabled} label="Remote Backup" disabled={enabling} />
      </div>
      {enableError && <div className="status-note status-note--error">{enableError}</div>}

      {status.featureEnabled && (
        <>
          {!status.running && (
            <div className="status-note status-note--error">
              rclone-rcd isn't reachable - check <code>systemctl status rclone-rcd</code> on the host.
            </div>
          )}

          <hr className="divider" />

          <div className="settings-field" style={{ paddingTop: 0 }}>
            <div className="settings-field__label">Remotes</div>
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
                    {r.status === 'ok' ? 'Connected' : r.status === 'authExpired' ? 'Auth expired' : r.status === 'error' ? 'Error' : 'Unknown'}
                  </div>
                  <div className="remote-row__actions">
                    {r.status === 'authExpired' && (
                      <button type="button" className="btn" onClick={() => loadRemotes()}>
                        Reconnect
                      </button>
                    )}
                    <button type="button" className="btn" onClick={() => startEditRemote(r)}>
                      Edit
                    </button>
                    <button type="button" className="btn btn--danger" disabled={removingRemote === r.name} onClick={() => removeRemote(r.name)}>
                      {removingRemote === r.name ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
              {remotes?.length === 0 && <div className="status-note">No remotes configured yet.</div>}
            </div>

            {!showAddRemote && (
              <button type="button" className="add-sync-btn" style={{ marginTop: 8 }} onClick={startAddRemote}>
                + Add remote
              </button>
            )}

            {showAddRemote && (
              <div className="add-remote-panel">
                <div className="add-remote-panel__title">{editingRemoteName ? `Edit remote: ${editingRemoteName}` : 'Add remote'}</div>
                {remoteConfigLoading ? (
                  <div className="status-note">Loading…</div>
                ) : !remoteAuth ? (
                  <>
                    <div className="field-grid">
                      <label className="field">
                        <span>Provider</span>
                        {editingRemoteName ? (
                          // rclone has no "change provider" on an existing remote - that's delete +
                          // recreate in its own real-world model, not an edit - so this is fixed.
                          <input className="history-input" value={selectedProvider?.description ?? remoteType} disabled />
                        ) : (
                          <select
                            className="history-input"
                            value={remoteType}
                            onChange={(e) => {
                              setRemoteType(e.target.value);
                              setRemoteFields({});
                            }}
                          >
                            {(providers ?? []).map((p) => (
                              <option key={p.name} value={p.name}>
                                {p.description}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                      <label className="field">
                        <span>Name</span>
                        <input className="history-input" value={remoteName} onChange={(e) => setRemoteName(e.target.value)} placeholder="e.g. offsite-b2" disabled={!!editingRemoteName} />
                      </label>
                      {selectedProvider?.options.map((opt) => (
                        <label className="field" key={opt.name}>
                          <span>{opt.help.split('\n')[0]}</span>
                          {opt.type === 'bool' ? (
                            <input
                              className="round-checkbox"
                              type="checkbox"
                              checked={remoteFields[opt.name] === 'true'}
                              onChange={(e) =>
                                setRemoteFields((prev) => ({
                                  ...prev,
                                  [opt.name]: String(e.target.checked),
                                }))
                              }
                            />
                          ) : (
                            <input
                              className="history-input"
                              type={opt.isPassword ? 'password' : 'text'}
                              value={remoteFields[opt.name] ?? ''}
                              onChange={(e) =>
                                setRemoteFields((prev) => ({
                                  ...prev,
                                  [opt.name]: e.target.value,
                                }))
                              }
                              placeholder={editingRemoteName && opt.isPassword ? 'Leave blank to keep the current value' : opt.default || undefined}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="settings-field__row">
                      <button type="button" className="btn btn--primary-sm" disabled={remoteSaving} onClick={submitRemote}>
                        {remoteSaving ? 'Saving…' : editingRemoteName ? 'Save' : 'Test & Save'}
                      </button>
                      <button type="button" className="btn" onClick={cancelRemoteForm}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="settings-field" style={{ padding: 0 }}>
                    <div className="toggle-row__desc">This provider needs one more step to authorize. Open the link below, finish signing in, then come back and click Continue.</div>
                    {remoteAuth.authUrl && (
                      <a href={remoteAuth.authUrl} target="_blank" rel="noreferrer">
                        {remoteAuth.authUrl}
                      </a>
                    )}
                    <div className="settings-field__row" style={{ marginTop: 8 }}>
                      <button type="button" className="btn btn--primary-sm" disabled={remoteSaving} onClick={continueRemoteAuth}>
                        {remoteSaving ? 'Checking…' : 'Continue'}
                      </button>
                      <button type="button" className="btn" onClick={cancelRemoteForm}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {remoteError && <div className="status-note status-note--error">{remoteError}</div>}
              </div>
            )}
          </div>

          <hr className="divider" />

          <div className="settings-field" style={{ paddingTop: 0 }}>
            <div className="settings-field__label">Syncs</div>
            {jobActionError && <div className="status-note status-note--error">{jobActionError}</div>}
            <div className="sync-job-list">
              {(jobs ?? []).map((job) => (editingJobId === job.id ? <JobEditor key={job.id} draft={jobDraft} setDraft={setJobDraft} remotes={remotes ?? []} hour12={hour12} saving={jobSaving} error={jobError} onSave={saveJob} onCancel={cancelJobEdit} /> : <JobCard key={job.id} job={job} remoteMissing={remotes !== null && !remotes.some((r) => r.name === job.remoteName)} onEdit={() => startEditJob(job)} onDelete={() => deleteJob(job.id)} onToggleEnabled={() => toggleJobEnabled(job)} onSyncNow={() => syncNow(job.id)} onCancelSync={() => cancelSync(job.id)} />))}
              {editingJobId === 'new' && <JobEditor draft={jobDraft} setDraft={setJobDraft} remotes={remotes ?? []} hour12={hour12} saving={jobSaving} error={jobError} onSave={saveJob} onCancel={cancelJobEdit} />}
            </div>
            {editingJobId === null && (
              <button type="button" className="add-sync-btn" style={{ marginTop: 12 }} onClick={startNewJob} disabled={(remotes ?? []).length === 0}>
                + Add sync
              </button>
            )}
            {(remotes ?? []).length === 0 && editingJobId === null && <div className="settings-field__hint">Add a remote above before creating a sync.</div>}
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
  const scheduleSummary = job.schedule.frequency === 'cron' ? `Cron · ${job.schedule.cronExpression}` : job.schedule.frequency === 'daily' ? `Daily · ${String(job.schedule.hour).padStart(2, '0')}:00` : job.schedule.frequency === 'weekly' ? `Weekly · ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][job.schedule.dayOfWeek]} · ${String(job.schedule.hour).padStart(2, '0')}:00` : `Monthly · Day ${job.schedule.dayOfMonth} · ${String(job.schedule.hour).padStart(2, '0')}:00`;

  const modifierClass = job.state === 'syncing' ? 'sync-job--enabled sync-job--syncing' : remoteMissing ? 'sync-job--error' : job.state === 'disabled' ? 'sync-job--disabled' : 'sync-job--enabled';
  const destLabel = job.scope === 'custom' ? `Custom (${job.customPath || '…'})` : SCOPE_LABELS[job.scope];

  return (
    <div className={`sync-job ${modifierClass}`}>
      <div className="sync-job__head">
        <div className="sync-job__title">
          <span className="sync-job__name">
            {destLabel} → {job.remoteName || '…'}
          </span>
          {job.state === 'syncing' ? (
            <span className="job-badge job-badge--syncing">
              <span className="status-dot status-dot--pulse" style={{ background: 'var(--color-blue)' }} />
              Syncing…
            </span>
          ) : remoteMissing ? (
            <span className="job-badge job-badge--error">Remote missing</span>
          ) : job.state === 'disabled' ? (
            <span className="job-badge job-badge--disabled">Disabled</span>
          ) : (
            <span className="job-badge job-badge--active">Active</span>
          )}
        </div>
        {job.state !== 'syncing' && <span className="sync-job__schedule">{scheduleSummary}</span>}
      </div>

      {job.state === 'syncing' && job.progress ? (
        <div className="sync-progress">
          <div className="sync-progress__row">
            <span>
              Transferring {job.progress.filesDone} of {job.progress.filesTotal || '?'} files
            </span>
            <span>
              {formatBytes(job.progress.speedBytesPerSec)}/s
              {job.progress.etaSeconds !== null ? ` · ETA ${formatEta(job.progress.etaSeconds)}` : ''}
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
              Last synced <strong>{formatRelativeTime(job.lastSyncedAt)}</strong>
              {job.lastSizeBytes !== null && <> · {formatBytes(job.lastSizeBytes)}</>}
              {job.lastFileCount !== null && <> · {job.lastFileCount} files</>}
              {job.lastErrorCount !== null && <> · {job.lastErrorCount} errors</>}
            </>
          ) : (
            'Never synced yet'
          )}
        </div>
      )}
      {job.lastError && job.state !== 'syncing' && <div className="status-note status-note--error">{job.lastError}</div>}
      {remoteMissing && job.state !== 'syncing' && <div className="status-note status-note--error">Remote "{job.remoteName}" no longer exists - re-add it, or point this sync at a different remote via Edit.</div>}

      <div className="sync-job__actions">
        {job.state === 'syncing' ? (
          <button type="button" className="btn btn--danger" onClick={onCancelSync}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn--primary-sm" disabled={job.state === 'disabled' || remoteMissing} onClick={onSyncNow}>
            Sync now
          </button>
        )}
        <button type="button" className="btn" disabled={job.state === 'syncing'} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn" disabled={job.state === 'syncing'} onClick={onToggleEnabled}>
          {job.state === 'disabled' ? 'Enable' : 'Disable'}
        </button>
        <button type="button" className="btn btn--danger" disabled={job.state === 'syncing'} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

function JobEditor({ draft, setDraft, remotes, hour12, saving, error, onSave, onCancel }: { draft: JobDraft; setDraft: (updater: (prev: JobDraft) => JobDraft) => void; remotes: RcloneRemote[]; hour12: boolean; saving: boolean; error: string | null; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="sync-job sync-job--editing">
      <div className="sync-job__head">
        <div className="sync-job__title">
          <span className="sync-job__name">{draft.name || 'Editing sync'}</span>
          <span className="job-badge job-badge--editing">Editing</span>
        </div>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input className="history-input" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Offsite config backup" />
        </label>
        <label className="field">
          <span>What to sync</span>
          <select className="history-input" value={draft.scope} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as SyncScope }))}>
            <option value="config">Config backups</option>
            <option value="configAppdata">Config backups + appdata</option>
            <option value="custom">Custom…</option>
          </select>
        </label>
        {draft.scope === 'custom' && (
          <label className="field field-grid--full">
            <span>Path</span>
            <PathAutocomplete scope="browse" value={draft.customPath} onChange={(v) => setDraft((d) => ({ ...d, customPath: v }))} placeholder="/mnt/user/..." />
          </label>
        )}
        <label className="field">
          <span>Destination</span>
          <select className="history-input" value={draft.remoteName} onChange={(e) => setDraft((d) => ({ ...d, remoteName: e.target.value }))}>
            {remotes.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Remote path (optional)</span>
          <input className="history-input" value={draft.remotePath} onChange={(e) => setDraft((d) => ({ ...d, remotePath: e.target.value }))} placeholder="bucket/subfolder" />
        </label>

        {/* Day-based, uniformly across every scope - not a "keep last N" count. Same model rclone's
            own --backup-dir versioning uses (see backend/src/rclone/service.ts's enforceRetention
            doc comment) whether this job syncs a live mirror ('custom') or uploads discrete dated
            archives ('config'/'configAppdata'). */}
        <label className="field field-grid--full">
          <span>Keep changed/deleted versions for</span>
          <div className={`settings-field__row${draft.forever ? ' retention-input--disabled' : ''}`} style={{ flexWrap: 'nowrap' }}>
            <input className="history-input" type="number" min={1} step={1} style={{ width: 100 }} value={draft.keepDays} onChange={(e) => setDraft((d) => ({ ...d, keepDays: e.target.value }))} disabled={draft.forever} />
            <span className="settings-field__hint" style={{ alignSelf: 'center' }}>
              days
            </span>
          </div>
          <div className="keep-forever-row" style={{ marginTop: 0 }}>
            <input className="round-checkbox" type="checkbox" id={`forever-${draft.name || 'new'}`} checked={draft.forever} onChange={(e) => setDraft((d) => ({ ...d, forever: e.target.checked }))} />
            <label htmlFor={`forever-${draft.name || 'new'}`}>Keep all versions forever</label>
          </div>
        </label>
      </div>

      <div className="schedule-row">
        <div className="schedule-row__label">Schedule</div>
        <ScheduleFields frequency={draft.frequency} onFrequencyChange={(f) => setDraft((d) => ({ ...d, frequency: f }))} dayOfWeek={draft.dayOfWeek} onDayOfWeekChange={(v) => setDraft((d) => ({ ...d, dayOfWeek: v }))} dayOfMonth={draft.dayOfMonth} onDayOfMonthChange={(v) => setDraft((d) => ({ ...d, dayOfMonth: v }))} hour={draft.hour} onHourChange={(v) => setDraft((d) => ({ ...d, hour: v }))} hour12={hour12} allowCron cronExpression={draft.cronExpression} onCronExpressionChange={(v) => setDraft((d) => ({ ...d, cronExpression: v }))} />
      </div>

      {error && <div className="status-note status-note--error">{error}</div>}
      <div className="sync-job__actions">
        <button type="button" className="btn btn--primary-sm" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
