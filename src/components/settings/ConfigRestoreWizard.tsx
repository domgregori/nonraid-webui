import { useRef, useState } from 'react';
import { servicesApi } from '../../api/servicesApi';
import { systemApi } from '../../api/systemApi';
import type { RestoreCommitResult, RestorePreview } from '../../types/systemApi';

type PostActionId = 'smb' | 'nfs' | 'webui' | 'reload';

interface ConfigRestoreWizardProps {
  onClose: () => void;
  // Same "fires once, right when a commit succeeds" contract as ImportArrayWizard's onImported —
  // the onboarding wizard uses this to know its own step actually finished, not just closed.
  onRestored?: () => void;
}

type Step = 'upload' | 'review' | 'confirm' | 'result';

/**
 * Restores a config backup archive (same tar.gz ImportArrayWizard's sibling feature,
 * Settings -> Backups' "Back up now"/"Download a copy", produces) — Samba/NFS config, this app's
 * own settings/shares/users, and the activity log, back onto their original absolute paths.
 *
 * The array superblock is a special case: it's only ever actually restored when this array
 * currently has nothing assigned (see backend/src/system/configRestore.ts's isArrayBlank) — an
 * already-configured array's superblock needs the disk-matching/size-mismatch safety checks
 * ImportArrayWizard already has, which a raw file restore doesn't get. The preview step always
 * shows whether the archive's superblock member is present and whether it'll actually be
 * restored, so that's never a surprise sprung at the confirm step.
 */
export function ConfigRestoreWizard({ onClose, onRestored }: ConfigRestoreWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [acknowledged, setAcknowledged] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<RestoreCommitResult | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The result step's own follow-up actions (restart SMB/NFS/nonraid-webui to actually pick up
  // what was just restored, retry the driver reload if the automatic one failed) — buttons, not
  // just the text hints this screen used to leave the user to go act on manually elsewhere.
  const [postActionPending, setPostActionPending] = useState<PostActionId | null>(null);
  const [postActionMessage, setPostActionMessage] = useState<string | null>(null);
  const [postActionError, setPostActionError] = useState<string | null>(null);
  const [reloadRetrySucceeded, setReloadRetrySucceeded] = useState(false);

  const runPostAction = async (id: PostActionId, action: () => Promise<{ message?: string }>) => {
    setPostActionPending(id);
    setPostActionMessage(null);
    setPostActionError(null);
    try {
      const result = await action();
      setPostActionMessage(result.message ?? 'Done.');
      if (id === 'reload') setReloadRetrySucceeded(true);
    } catch (err) {
      setPostActionError((err as Error).message);
    } finally {
      setPostActionPending(null);
    }
  };

  const handleFileSelected = async (file: File) => {
    setFileName(file.name);
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await systemApi.previewConfigRestore(file);
      setPreview(result);
      setStep('review');
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPreviewing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await systemApi.commitConfigRestore(preview.token);
      setCommitResult(result);
      setStep('result');
      onRestored?.();
    } catch (err) {
      setCommitError((err as Error).message);
    } finally {
      setCommitting(false);
    }
  };

  const startOver = () => {
    setPreview(null);
    setPreviewError(null);
    setAcknowledged(false);
    setCommitResult(null);
    setCommitError(null);
    setFileName(null);
    setStep('upload');
  };

  const hasSuperblock = preview?.entries.some((e) => e.isSuperblock) ?? false;
  const superblockWillRestore = hasSuperblock && preview!.arrayIsBlank;

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog import-array-wizard">
        <div className="dialog__head">
          <div className="dialog__title">Import config</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {step === 'upload' && (
            <>
              <div className="toggle-row__desc">
                Pick a config backup archive — from "Back up now" or "Download a copy" in Settings → Backups, or
                the automatic schedule. This only reads the archive to show what's in it; nothing on this host
                changes until you confirm on the last step.
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".gz,.tar.gz"
                className="file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelected(file);
                }}
                disabled={previewing}
              />

              {previewing && <div className="status-note">Reading {fileName}…</div>}
              {previewError && <div className="status-note status-note--error">{previewError}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {step === 'review' && preview && (
            <>
              <div className="toggle-row__desc">{preview.entries.length} item(s) recorded in this archive.</div>

              {!preview.arrayStopped && (
                <div className="import-warning import-warning--danger">
                  <div className="import-warning__title">Stop the array first</div>
                  <div className="import-warning__desc">
                    Restoring config while the array is running risks inconsistent Samba/NFS/share state until
                    services catch up. Stop the array from the Dashboard, then come back and try again.
                  </div>
                </div>
              )}

              {hasSuperblock && (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">
                    Array superblock {superblockWillRestore ? 'will be restored' : 'will be skipped'}
                  </div>
                  <div className="import-warning__desc">
                    {superblockWillRestore
                      ? "This array has nothing assigned yet, so the archive's own superblock will be restored too, reconstructing the array itself along with the rest of the config."
                      : "This array already has disks assigned, so the archive's superblock is skipped for safety — restoring it here would bypass the disk-matching checks Settings → Import From Unraid has. Use that instead if you specifically need to restore the array itself."}
                  </div>
                </div>
              )}

              <ul className="browse-bulk-failures" style={{ maxHeight: 240 }}>
                {preview.entries.map((entry) => (
                  <li key={entry.path}>
                    {entry.path}
                    {entry.isSuperblock ? ' — array superblock' : ''}
                  </li>
                ))}
              </ul>

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={startOver}>
                  Start over
                </button>
                <button type="button" className="btn--primary" disabled={!preview.arrayStopped} onClick={() => setStep('confirm')}>
                  Continue
                </button>
              </div>
            </>
          )}

          {step === 'confirm' && preview && (
            <>
              <div className="status-note status-note--error">
                This overwrites {preview.entries.length - (hasSuperblock && !superblockWillRestore ? 1 : 0)} file(s) at
                their original locations on this host — Samba/NFS config, this app's own settings/shares/users, and
                the activity log. There's no undo beyond restoring a different (or older) backup afterward.
              </div>

              <label className="container-form-row__checkbox">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                I understand this overwrites live config files and want to proceed.
              </label>

              {commitError && <div className="status-note status-note--error">{commitError}</div>}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setStep('review')}>
                  Back
                </button>
                <button type="button" className="btn btn--danger" disabled={!acknowledged || committing} onClick={handleCommit}>
                  {committing ? 'Restoring…' : 'Restore config'}
                </button>
              </div>
            </>
          )}

          {step === 'result' && commitResult && (
            <div className="import-result">
              <div className="status-note">
                Restored {commitResult.restoredCount} item(s)
                {commitResult.skippedSuperblock ? ' — array superblock skipped, array already has disks assigned' : ''}.
                Samba/NFS may need a service restart to pick up the restored config, and nonraid-webui itself may
                need a restart to fully apply restored settings — both available below.
              </div>

              {commitResult.superblockReloadError && !reloadRetrySucceeded && (
                <div className="status-note status-note--error">
                  The restored array superblock is on disk, but reloading the driver to pick it up failed:{' '}
                  {commitResult.superblockReloadError} The array will keep showing as unconfigured until this is
                  retried below or the host is rebooted.
                </div>
              )}

              <div className="toggle-row--bordered" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                <div className="dialog__actions" style={{ justifyContent: 'flex-start' }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={postActionPending !== null}
                    onClick={() => runPostAction('smb', () => servicesApi.restart('smb'))}
                  >
                    {postActionPending === 'smb' ? 'Restarting…' : 'Restart SMB'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={postActionPending !== null}
                    onClick={() => runPostAction('nfs', () => servicesApi.restart('nfs'))}
                  >
                    {postActionPending === 'nfs' ? 'Restarting…' : 'Restart NFS'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={postActionPending !== null}
                    onClick={() => runPostAction('webui', () => servicesApi.restart('webui'))}
                  >
                    {postActionPending === 'webui' ? 'Restarting…' : 'Restart nonraid-webui'}
                  </button>
                  {commitResult.superblockReloadError && !reloadRetrySucceeded && (
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={postActionPending !== null}
                      onClick={() =>
                        runPostAction('reload', async () => {
                          const { result } = await systemApi.reloadDriver();
                          return { message: `Driver reloaded, ${result.importedCount} disk(s) re-imported.` };
                        })
                      }
                    >
                      {postActionPending === 'reload' ? 'Reloading…' : 'Retry driver reload'}
                    </button>
                  )}
                </div>
                {postActionMessage && <div className="status-note">{postActionMessage}</div>}
                {postActionError && <div className="status-note status-note--error">{postActionError}</div>}
              </div>

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
