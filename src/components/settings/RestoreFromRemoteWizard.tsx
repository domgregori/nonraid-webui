import { useEffect, useState } from 'react';
import { rcloneApi } from '../../api/rcloneApi';
import type { RemoteBackupEntry, SyncJobWithRuntime } from '../../types/rcloneApi';
import type { BackupCategoryId, RestorePreview } from '../../types/systemApi';
import { formatFileSize, formatRelativeTime } from '../../utils/format';
import { ConfigRestoreWizard } from './ConfigRestoreWizard';

interface RestoreFromRemoteWizardProps {
  onClose: () => void;
  onRestored?: () => void;
  // Threaded straight through to ConfigRestoreWizard - see its own doc comment on this prop.
  focusCategory?: BackupCategoryId;
}

const SCOPE_LABEL: Record<string, string> = { config: 'Config backups', configAppdata: 'Config backups + appdata' };

/**
 * "Recover from a remote backup" - two picker steps (which sync job, then which archive it's
 * already uploaded) ahead of the same ConfigRestoreWizard review/confirm/result flow every other
 * restore source shares. Only Remote Backup jobs scoped to 'config'/'configAppdata' are offered -
 * a 'custom' scope job mirrors an arbitrary folder live and has no single archive to restore from
 * (see rclone/service.ts's listJobBackups()).
 */
export function RestoreFromRemoteWizard({ onClose, onRestored, focusCategory }: RestoreFromRemoteWizardProps) {
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [jobs, setJobs] = useState<SyncJobWithRuntime[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [job, setJob] = useState<SyncJobWithRuntime | null>(null);

  const [loadingArchives, setLoadingArchives] = useState(false);
  const [archives, setArchives] = useState<RemoteBackupEntry[]>([]);
  const [archivesError, setArchivesError] = useState<string | null>(null);

  const [previewingName, setPreviewingName] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);

  // Set when the picked archive's own sidecar (RemoteBackupEntry.encrypted, from its `.meta.json`
  // downloaded alongside the listing - see rclone/service.ts's listJobBackups()) says it's
  // encrypted - the archive picker swaps for a one-field password prompt instead of downloading
  // and attempting a preview straight away. Same shape as RestoreFromLocalWizard's own prompt.
  const [passwordEntry, setPasswordEntry] = useState<RemoteBackupEntry | null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    rcloneApi
      .getJobs()
      .then((all) => setJobs(all.filter((j) => j.scope !== 'custom')))
      .catch((err) => setJobsError((err as Error).message))
      .finally(() => setLoadingJobs(false));
  }, []);

  const pickJob = (picked: SyncJobWithRuntime) => {
    setJob(picked);
    setLoadingArchives(true);
    setArchivesError(null);
    rcloneApi
      .listJobBackups(picked.id)
      .then(setArchives)
      .catch((err) => setArchivesError((err as Error).message))
      .finally(() => setLoadingArchives(false));
  };

  const previewFor = async (name: string, password?: string) => {
    if (!job) return;
    setPreviewingName(name);
    setPreviewError(null);
    setPasswordError(null);
    try {
      const result = await rcloneApi.previewJobBackupRestore(job.id, name, password);
      setPreview(result);
      setPickedName(name);
      setPasswordEntry(null);
    } catch (err) {
      const message = (err as Error).message;
      if (passwordEntry) setPasswordError(message);
      else setPreviewError(message);
    } finally {
      setPreviewingName(null);
    }
  };

  const pickArchive = (archive: RemoteBackupEntry) => {
    if (archive.encrypted) {
      setPasswordEntry(archive);
      setPasswordDraft('');
      setPasswordError(null);
      return;
    }
    void previewFor(archive.name);
  };

  if (preview && pickedName) {
    return (
      <ConfigRestoreWizard
        onClose={onClose}
        onRestored={onRestored}
        title={focusCategory === 'array' ? 'Recover the array from a remote backup' : 'Restore from a remote backup'}
        initialPreview={preview}
        sourceLabel={pickedName}
        focusCategory={focusCategory}
        onChooseDifferentSource={() => {
          setPreview(null);
          setPickedName(null);
        }}
      />
    );
  }

  const title = focusCategory === 'array' ? 'Recover the array from a remote backup' : 'Restore from a remote backup';

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog import-array-wizard">
        <div className="dialog__head">
          <div className="dialog__title">{title}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {!job && (
            <>
              <div className="toggle-row__desc">
                Pick a Remote Backup sync job to pull an archive down from. Only jobs that upload config backups (not a live folder mirror) have
                anything here to restore from.
              </div>

              {loadingJobs && <div className="status-note">Loading…</div>}
              {jobsError && <div className="status-note status-note--error">{jobsError}</div>}
              {!loadingJobs && !jobsError && jobs.length === 0 && (
                <div className="status-note">No config-backup sync jobs configured yet - set one up in Settings → Remote Backup first.</div>
              )}
              {!loadingJobs && jobs.length > 0 && (
                <div className="import-browser__list">
                  {jobs.map((j) => (
                    <button type="button" key={j.id} className="import-browser__row" onClick={() => pickJob(j)}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</span>
                      <span style={{ flexShrink: 0, color: 'var(--color-text-dim)' }}>
                        {SCOPE_LABEL[j.scope] ?? j.scope} · {j.remoteName}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {job && passwordEntry && (
            <>
              <div className="toggle-row__desc">
                <strong>{passwordEntry.name}</strong> is password-encrypted. Enter its password to read what's inside.
              </div>
              <input
                className="history-input"
                type="password"
                autoFocus
                value={passwordDraft}
                onChange={(e) => setPasswordDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && passwordDraft) void previewFor(passwordEntry.name, passwordDraft);
                }}
                placeholder="Password"
              />
              {previewingName && <div className="status-note">Downloading and reading {previewingName}…</div>}
              {passwordError && <div className="status-note status-note--error">{passwordError}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setPasswordEntry(null)} disabled={previewingName !== null}>
                  Back
                </button>
                <button type="button" className="btn btn--primary-sm" disabled={!passwordDraft || previewingName !== null} onClick={() => previewFor(passwordEntry.name, passwordDraft)}>
                  Continue
                </button>
              </div>
            </>
          )}

          {job && !passwordEntry && (
            <>
              <div className="toggle-row__desc">
                Archives already uploaded by <strong>{job.name}</strong> ({job.remoteName}:{job.remotePath || '/'}).
              </div>

              {loadingArchives && <div className="status-note">Loading…</div>}
              {archivesError && <div className="status-note status-note--error">{archivesError}</div>}
              {!loadingArchives && !archivesError && archives.length === 0 && <div className="status-note">This job hasn't uploaded any backups yet.</div>}

              {!loadingArchives && archives.length > 0 && (
                <div className="import-browser__list">
                  {archives.map((a) => (
                    <button type="button" key={a.name} className="import-browser__row" onClick={() => pickArchive(a)} disabled={previewingName !== null}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                      {a.encrypted && (
                        <span className="job-badge job-badge--encrypted" style={{ flexShrink: 0 }}>
                          Encrypted
                        </span>
                      )}
                      <span style={{ flexShrink: 0, color: 'var(--color-text-dim)' }}>
                        {formatFileSize(a.sizeBytes)} · {formatRelativeTime(new Date(a.modTime).getTime())}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {previewingName && <div className="status-note">Downloading and reading {previewingName}…</div>}
              {previewError && <div className="status-note status-note--error">{previewError}</div>}

              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setJob(null);
                    setArchives([]);
                    setArchivesError(null);
                  }}
                >
                  Back
                </button>
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
