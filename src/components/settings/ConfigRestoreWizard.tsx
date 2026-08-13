import { useRef, useState } from 'react';
import { systemApi } from '../../api/systemApi';
import { ProgressBar } from '../shared/ProgressBar';
import type { RestartServicesResult, RestoreCommitResult, RestorePreview } from '../../types/systemApi';

// getStats() polled every POLL_INTERVAL_MS after triggering a restart, up to POLL_MAX_ATTEMPTS
// times, to detect nonraid-webui actually coming back — a generous ceiling (2 minutes) since a
// slow reboot-adjacent host shouldn't get told to give up while it's still genuinely coming back.
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 80;

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

  // The result step's own single follow-up action — restart SMB/NFS, reload the driver, and
  // restart nonraid-webui itself, so what was just restored actually takes effect, instead of
  // just a text hint left for the user to go act on manually elsewhere. `restarting` covers the
  // whole span from click through nonraid-webui actually coming back — the request itself only
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
      const result = await systemApi.restartServices();
      setRestartSteps(result);
    } catch {
      // The connection can drop mid-response if nonraid-webui's own restart lands before this
      // fetch's response finishes flushing — expected, not a real failure. Polling below is what
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
        // Still restarting — keep polling.
      }
    }
    setRestartTimedOut(true);
    setRestarting(false);
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
                Samba/NFS, the driver, and nonraid-webui itself all need to restart to fully pick up what was just
                restored — one button below does all of it.
              </div>

              {commitResult.superblockReloadError && !backOnline && (
                <div className="status-note status-note--error">
                  The restored array superblock is on disk, but reloading the driver to pick it up failed:{' '}
                  {commitResult.superblockReloadError} Restart services below to retry it.
                </div>
              )}

              <div className="toggle-row--bordered" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {!restarting ? (
                  <div className="dialog__actions" style={{ justifyContent: 'flex-start' }}>
                    <button type="button" className="btn btn--primary" onClick={handleRestartServices}>
                      {backOnline ? 'Restart Services Again' : 'Restart Services'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="toggle-row__desc">
                      Restarting SMB, NFS, and the driver, then nonraid-webui itself — this page will reconnect
                      automatically once it's back.
                    </div>
                    <ProgressBar indeterminate color="var(--color-blue)" height={6} />
                  </>
                )}

                {restartSteps && (
                  <ul className="browse-bulk-failures">
                    <li style={restartSteps.smb.ok ? undefined : { color: 'var(--color-red)' }}>SMB: {restartSteps.smb.message}</li>
                    <li style={restartSteps.nfs.ok ? undefined : { color: 'var(--color-red)' }}>NFS: {restartSteps.nfs.message}</li>
                    <li style={restartSteps.driverReload.ok ? undefined : { color: 'var(--color-red)' }}>
                      Driver: {restartSteps.driverReload.message}
                    </li>
                  </ul>
                )}
                {backOnline && <div className="status-note">nonraid-webui is back online.</div>}
                {restartTimedOut && (
                  <div className="status-note status-note--error">
                    nonraid-webui didn't come back within 2 minutes — check `systemctl status nonraid-webui` on the
                    host, or just reload this page in a bit.
                  </div>
                )}
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
