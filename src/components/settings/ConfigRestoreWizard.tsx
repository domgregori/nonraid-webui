import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi } from '../../api/systemApi';
import { CodedError } from '../../api/request';
import { ProgressBar } from '../shared/ProgressBar';
import type { BackupCategoryId, RestartServicesResult, RestoreCommitResult, RestorePreview } from '../../types/systemApi';

const PASSWORD_REQUIRED_CODE = 'PASSWORD_REQUIRED';

// getStats() polled every POLL_INTERVAL_MS after triggering a restart, up to POLL_MAX_ATTEMPTS
// times, to detect nonraid-webui actually coming back - a generous ceiling (2 minutes) since a
// slow reboot-adjacent host shouldn't get told to give up while it's still genuinely coming back.
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 80;

interface ConfigRestoreWizardProps {
  onClose: () => void;
  // Same "fires once, right when a commit succeeds" contract as ImportArrayWizard's onImported -
  // the onboarding wizard uses this to know its own step actually finished, not just closed.
  onRestored?: () => void;
  // Dialog heading - defaults to this component's own original standalone use (Settings ->
  // Recovery's "from an uploaded file" entry). The local/remote-backup picker wizards below pass
  // their own, since the "upload" framing doesn't fit a backup that was never uploaded through a
  // browser in the first place.
  title?: string;
  // Skips the upload step entirely, starting straight at 'review' with a preview already fetched
  // by a caller-owned source picker (a local-backup or remote-backup list) instead of a browser
  // file upload. `sourceLabel` replaces "Reading {fileName}…"'s filename in the review step's own
  // header line - e.g. the archive's own name for a local/remote pick, since there's no upload
  // File object to read a name off of here.
  initialPreview?: RestorePreview;
  sourceLabel?: string;
  // When set, only this one category is offered on the review step (everything else in the
  // archive is still there, just not shown as pickable) - Settings -> Recovery's "recover just
  // the array" entry points thread this through as 'array', reusing this exact same
  // upload/local/remote source flow rather than a sixth, parallel restore path. See
  // ConfigRestoreWizardProps' own callers in SettingsPage.tsx.
  focusCategory?: BackupCategoryId;
  // Present only when this wizard was opened from a caller-owned source picker (RestoreFromLocal/
  // RemoteWizard) - swaps the review step's "Start over" for "Choose a different backup", going
  // back to that picker's own list instead of an 'upload' step this instance never has.
  onChooseDifferentSource?: () => void;
}

type Step = 'upload' | 'review' | 'confirm' | 'result';

function defaultSelectedCategories(preview: RestorePreview, focusCategory?: BackupCategoryId): Set<BackupCategoryId> {
  const eligible = preview.categories.filter((c) => c.entries.length > 0 && (c.id !== 'array' || preview.arrayIsBlank));
  if (!focusCategory) return new Set(eligible.map((c) => c.id));
  return new Set(eligible.filter((c) => c.id === focusCategory).map((c) => c.id));
}

/**
 * Restores a config backup archive (same tar.gz ImportArrayWizard's sibling feature,
 * Settings -> Backups' "Back up now"/"Download a copy", produces) - Samba/NFS config, this app's
 * own settings/shares/users, and the activity log, back onto their original absolute paths.
 *
 * The array superblock is a special case: it's only ever actually restored when this array
 * currently has nothing assigned (see backend/src/system/configRestore.ts's isArrayBlank) - an
 * already-configured array's superblock needs the disk-matching/size-mismatch safety checks
 * ImportArrayWizard already has, which a raw file restore doesn't get. The preview step always
 * shows whether the archive's superblock member is present and whether it'll actually be
 * restored, so that's never a surprise sprung at the confirm step.
 */
export function ConfigRestoreWizard({ onClose, onRestored, title, initialPreview, sourceLabel, focusCategory, onChooseDifferentSource }: ConfigRestoreWizardProps) {
  const { t } = useTranslation('settings');
  const dialogTitle = title ?? t('ConfigRestoreWizard.importConfig');
  const [step, setStep] = useState<Step>(initialPreview ? 'review' : 'upload');
  const [fileName, setFileName] = useState<string | null>(sourceLabel ?? null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<RestorePreview | null>(initialPreview ?? null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // A raw browser upload has no `.meta.json` sidecar of its own to check ahead of time (unlike
  // the local/remote pickers, which already know before ever calling preview) - the first attempt
  // is always password-less, and a PASSWORD_REQUIRED-coded error is what tells this step to keep
  // the selected file around and ask, rather than making the admin re-pick it from their own disk.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState('');

  const [selectedCategories, setSelectedCategories] = useState<Set<BackupCategoryId>>(initialPreview ? defaultSelectedCategories(initialPreview, focusCategory) : new Set());

  const [acknowledged, setAcknowledged] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<RestoreCommitResult | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The result step's own single follow-up action - restart SMB/NFS, reload the driver, and
  // restart nonraid-webui itself, so what was just restored actually takes effect, instead of
  // just a text hint left for the user to go act on manually elsewhere. `restarting` covers the
  // whole span from click through nonraid-webui actually coming back - the request itself only
  // resolves the SMB/NFS/driver-reload part, since nonraid-webui's own restart drops the
  // connection; `backOnline` flips once polling confirms that happened.
  const [restarting, setRestarting] = useState(false);
  const [restartSteps, setRestartSteps] = useState<RestartServicesResult | null>(null);
  const [backOnline, setBackOnline] = useState(false);
  const [restartTimedOut, setRestartTimedOut] = useState(false);

  const handleRestartServices = async () => {
    setRestarting(true);
    setRestartSteps(null);
    setBackOnline(false);
    setRestartTimedOut(false);
    try {
      const result = await systemApi.restartServices(commitResult?.dockerConfigRestored ?? false);
      setRestartSteps(result);
    } catch {
      // The connection can drop mid-response if nonraid-webui's own restart lands before this
      // fetch's response finishes flushing - expected, not a real failure. Polling below is what
      // actually decides success, not this request settling cleanly.
    }
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        await systemApi.getStats();
        setBackOnline(true);
        setRestarting(false);
        return;
      } catch {
        // Still restarting - keep polling.
      }
    }
    setRestartTimedOut(true);
    setRestarting(false);
  };

  const handleFileSelected = async (file: File, password?: string) => {
    setFileName(file.name);
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await systemApi.previewConfigRestore(file, password);
      setPreview(result);
      setPendingFile(null);
      setNeedsPassword(false);
      // Default to everything selected, except the array category when it can't actually be
      // restored (array already has disks assigned) - leaving it checked-but-disabled would read
      // as "this will happen" when it won't. Narrowed to just focusCategory when set (see this
      // component's own doc comment on that prop).
      setSelectedCategories(defaultSelectedCategories(result, focusCategory));
      setStep('review');
    } catch (err) {
      if (err instanceof CodedError && err.code === PASSWORD_REQUIRED_CODE) {
        setPendingFile(file);
        setNeedsPassword(true);
        setPreviewError(password ? err.message : null); // only show as an error once a (wrong) password was actually tried
      } else {
        setPreviewError((err as Error).message);
      }
    } finally {
      setPreviewing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const submitPassword = () => {
    if (pendingFile && passwordDraft) void handleFileSelected(pendingFile, passwordDraft);
  };

  const handleCommit = async () => {
    if (!preview) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await systemApi.commitConfigRestore(preview.token, Array.from(selectedCategories));
      setCommitResult(result);
      setStep('result');
      onRestored?.();
    } catch (err) {
      setCommitError((err as Error).message);
    } finally {
      setCommitting(false);
    }
  };

  const toggleCategory = (id: BackupCategoryId) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startOver = () => {
    setPreview(null);
    setPreviewError(null);
    setSelectedCategories(new Set());
    setAcknowledged(false);
    setCommitResult(null);
    setCommitError(null);
    setFileName(null);
    setPendingFile(null);
    setNeedsPassword(false);
    setPasswordDraft('');
    setStep('upload');
  };

  const hasSuperblock = preview?.entries.some((e) => e.isSuperblock) ?? false;
  const superblockWillRestore = hasSuperblock && preview!.arrayIsBlank;
  const selectedEntryCount = preview?.categories.filter((c) => selectedCategories.has(c.id)).reduce((sum, c) => sum + c.entries.length, 0) ?? 0;

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog import-array-wizard">
        <div className="dialog__head">
          <div className="dialog__title">{dialogTitle}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('ConfigRestoreWizard.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {step === 'upload' && !needsPassword && (
            <>
              <div className="toggle-row__desc">{t('ConfigRestoreWizard.pickArchiveDesc')}</div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".nrb,.gz,.tar.gz,.enc"
                className="file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelected(file);
                }}
                disabled={previewing}
              />

              {previewing && <div className="status-note">{t('ConfigRestoreWizard.reading', { fileName })}</div>}
              {previewError && <div className="status-note status-note--error">{previewError}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  {t('ConfigRestoreWizard.cancel')}
                </button>
              </div>
            </>
          )}

          {step === 'upload' && needsPassword && pendingFile && (
            <>
              <div className="toggle-row__desc">
                <strong>{pendingFile.name}</strong> {t('ConfigRestoreWizard.passwordEncrypted')}
              </div>
              <input
                className="history-input"
                type="password"
                autoFocus
                value={passwordDraft}
                onChange={(e) => setPasswordDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitPassword();
                }}
                placeholder={t('ConfigRestoreWizard.passwordPlaceholder')}
                disabled={previewing}
              />
              {previewing && <div className="status-note">{t('ConfigRestoreWizard.reading', { fileName })}</div>}
              {previewError && <div className="status-note status-note--error">{previewError}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={startOver} disabled={previewing}>
                  {t('ConfigRestoreWizard.chooseDifferentFile')}
                </button>
                <button type="button" className="btn btn--primary-sm" disabled={!passwordDraft || previewing} onClick={submitPassword}>
                  {t('ConfigRestoreWizard.continue')}
                </button>
              </div>
            </>
          )}

          {step === 'review' && preview && (
            <>
              <div className="toggle-row__desc">{t('ConfigRestoreWizard.itemsRecorded', { count: preview.entries.length })}</div>

              {!preview.arrayStopped && (
                <div className="import-warning import-warning--danger">
                  <div className="import-warning__title">{t('ConfigRestoreWizard.stopArrayFirst')}</div>
                  <div className="import-warning__desc">{t('ConfigRestoreWizard.stopArrayFirstDesc')}</div>
                </div>
              )}

              {hasSuperblock && (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">
                    {superblockWillRestore ? t('ConfigRestoreWizard.superblockWillBeRestored') : t('ConfigRestoreWizard.superblockWillBeSkipped')}
                  </div>
                  <div className="import-warning__desc">
                    {superblockWillRestore ? t('ConfigRestoreWizard.superblockRestoredDesc') : t('ConfigRestoreWizard.superblockSkippedDesc')}
                  </div>
                </div>
              )}

              {focusCategory === 'array' && !hasSuperblock && (
                <div className="status-note status-note--error">{t('ConfigRestoreWizard.noSuperblockRecorded')}</div>
              )}

              <div className="toggle-row__desc">{t('ConfigRestoreWizard.selectWhatToRestore')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {preview.categories
                  .filter((cat) => cat.entries.length > 0)
                  .filter((cat) => !focusCategory || cat.id === focusCategory)
                  .map((cat) => {
                    const disabled = cat.id === 'array' && !preview.arrayIsBlank;
                    return (
                      <label
                        key={cat.id}
                        className="container-form-row__checkbox"
                        style={disabled ? { opacity: 0.6 } : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCategories.has(cat.id)}
                          disabled={disabled}
                          onChange={() => toggleCategory(cat.id)}
                        />
                        <span>
                          <strong>{cat.label}</strong> - {cat.description} ({t('ConfigRestoreWizard.fileCount', { count: cat.entries.length })})
                        </span>
                      </label>
                    );
                  })}
              </div>

              <details>
                <summary className="toggle-row__desc" style={{ cursor: 'pointer' }}>
                  {t('ConfigRestoreWizard.showAllFiles', { count: preview.entries.length })}
                </summary>
                <ul className="browse-bulk-failures" style={{ maxHeight: 240 }}>
                  {preview.entries.map((entry) => (
                    <li key={entry.path}>
                      {entry.path}
                      {entry.isSuperblock ? ` - ${t('ConfigRestoreWizard.arraySuperblock')}` : ''}
                    </li>
                  ))}
                </ul>
              </details>

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={initialPreview ? (onChooseDifferentSource ?? onClose) : startOver}>
                  {initialPreview
                    ? onChooseDifferentSource
                      ? t('ConfigRestoreWizard.chooseDifferentBackup')
                      : t('ConfigRestoreWizard.cancel')
                    : t('ConfigRestoreWizard.startOver')}
                </button>
                <button type="button" className="btn--primary" disabled={!preview.arrayStopped} onClick={() => setStep('confirm')}>
                  {t('ConfigRestoreWizard.continue')}
                </button>
              </div>
            </>
          )}

          {step === 'confirm' && preview && (
            <>
              <div className="status-note status-note--error">{t('ConfigRestoreWizard.overwriteWarning', { count: selectedEntryCount })}</div>

              <label className="container-form-row__checkbox">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                {t('ConfigRestoreWizard.acknowledgeOverwrite')}
              </label>

              {commitError && <div className="status-note status-note--error">{commitError}</div>}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setStep('review')}>
                  {t('ConfigRestoreWizard.back')}
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={!acknowledged || committing || selectedEntryCount === 0}
                  onClick={handleCommit}
                >
                  {committing ? t('ConfigRestoreWizard.restoring') : t('ConfigRestoreWizard.restoreConfig')}
                </button>
              </div>
            </>
          )}

          {step === 'result' && commitResult && (
            <div className="import-result">
              <div className="status-note">
                {t('ConfigRestoreWizard.restoredItems', { count: commitResult.restoredCount })}
                {commitResult.skippedSuperblock ? ` - ${t('ConfigRestoreWizard.superblockSkippedNote')}` : ''}.{' '}
                {t('ConfigRestoreWizard.restartNeeded', { docker: commitResult.dockerConfigRestored ? `${t('ConfigRestoreWizard.dockerWord')} ` : '' })}
                {commitResult.dockerConfigRestored ? ` ${t('ConfigRestoreWizard.dockerRestartWarning')}` : ''}
              </div>

              {commitResult.superblockReloadError && !backOnline && (
                <div className="status-note status-note--error">
                  {t('ConfigRestoreWizard.superblockReloadFailed')} {commitResult.superblockReloadError} {t('ConfigRestoreWizard.retryBelow')}
                </div>
              )}

              <div className="toggle-row--bordered" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {!restarting ? (
                  <div className="dialog__actions" style={{ justifyContent: 'flex-start' }}>
                    <button type="button" className="btn btn--primary" onClick={handleRestartServices}>
                      {backOnline ? t('ConfigRestoreWizard.restartServicesAgain') : t('ConfigRestoreWizard.restartServices')}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="toggle-row__desc">{t('ConfigRestoreWizard.restartingServicesDesc')}</div>
                    <ProgressBar indeterminate color="var(--color-blue)" height={6} />
                  </>
                )}

                {restartSteps && (
                  <ul className="browse-bulk-failures">
                    <li style={restartSteps.smb.ok ? undefined : { color: 'var(--color-red)' }}>
                      {t('ConfigRestoreWizard.smb')} {restartSteps.smb.message}
                    </li>
                    <li style={restartSteps.nfs.ok ? undefined : { color: 'var(--color-red)' }}>
                      {t('ConfigRestoreWizard.nfs')} {restartSteps.nfs.message}
                    </li>
                    <li style={restartSteps.driverReload.ok ? undefined : { color: 'var(--color-red)' }}>
                      {t('ConfigRestoreWizard.driver')} {restartSteps.driverReload.message}
                    </li>
                    <li style={restartSteps.rcloneRcd.ok ? undefined : { color: 'var(--color-red)' }}>
                      {t('ConfigRestoreWizard.remoteBackup')} {restartSteps.rcloneRcd.message}
                    </li>
                    {restartSteps.docker && (
                      <li style={restartSteps.docker.ok ? undefined : { color: 'var(--color-red)' }}>
                        {t('ConfigRestoreWizard.docker')} {restartSteps.docker.message}
                      </li>
                    )}
                  </ul>
                )}
                {backOnline && <div className="status-note">{t('ConfigRestoreWizard.backOnline')}</div>}
                {restartTimedOut && <div className="status-note status-note--error">{t('ConfigRestoreWizard.restartTimedOut')}</div>}
              </div>

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  {t('ConfigRestoreWizard.closeButton')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
