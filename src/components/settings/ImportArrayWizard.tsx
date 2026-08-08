import { useRef, useState } from 'react';
import { nmdApi } from '../../api/nmdApi';
import type { DiskMatchStatus, ImportCommitResponse, ImportPreview } from '../../types/nmdApi';
import { formatBytesHuman } from '../../utils/format';

interface ImportArrayWizardProps {
  onClose: () => void;
}

type Step = 'upload' | 'review' | 'confirm' | 'result';

const STATUS_LABEL: Record<DiskMatchStatus, string> = {
  ok: 'OK',
  'size-mismatch': 'SIZE MISMATCH',
  missing: 'NOT FOUND',
};

const ROLE_LABEL = { parity: 'Parity (P)', parity2: 'Parity 2 (Q)', data: 'Data' } as const;

/**
 * Guided flow for bringing in an existing Unraid array: pick the .dat
 * superblock file, see exactly what it expects and how that lines up
 * against what's physically connected, then explicitly commit. The preview
 * step (uploading and parsing the file) never touches nmdctl or the kernel
 * module — see backend/src/nmd/superblock.ts — so nothing real happens
 * until Confirm. Size mismatches hard-block with no override: starting the
 * array with one can corrupt filesystems and lose data (see the migration
 * guide linked below), so this app doesn't offer a way around it.
 */
export function ImportArrayWizard({ onClose }: ImportArrayWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [acknowledged, setAcknowledged] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = async (file: File) => {
    setFileName(file.name);
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await nmdApi.previewImport(file);
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
      const result = await nmdApi.commitImport(preview.token);
      setCommitResult(result);
      setStep('result');
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
    setShowRawOutput(false);
    setFileName(null);
    setStep('upload');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog import-array-wizard">
        <div className="dialog__head">
          <div className="dialog__title">Import Unraid array</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {step === 'upload' && (
            <>
              <div className="toggle-row__desc">
                Migrating an existing Unraid array? Follow{' '}
                <a href="https://github.com/qvr/nonraid#migrating-an-existing-unraid-array" target="_blank" rel="noreferrer">
                  the migration guide
                </a>{' '}
                first — move the disks over, then pick the original superblock file (usually{' '}
                <code>config/super.dat</code> on the Unraid flash drive) below. This only reads the file to show what
                it expects; nothing on this host changes until you confirm on the last step.
              </div>
              <input
                ref={fileInputRef}
                type="file"
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
              <div className="toggle-row__desc">
                <strong>{preview.label || 'Unlabeled array'}</strong> — {preview.slots.length} disk(s) recorded in this
                superblock.
              </div>

              {preview.currentArrayActive && (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">This will replace the currently active array</div>
                  <div className="import-warning__desc">
                    Continuing stops the array, unloads the driver, and reloads it with this superblock instead. The
                    array's current configuration is not deleted — the existing superblock file is backed up first.
                  </div>
                </div>
              )}

              {preview.parityTooSmall && (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">Parity is smaller than the largest data disk</div>
                  <div className="import-warning__desc">
                    The driver refuses to start an array like this (ERROR:PARITY_NOT_BIGGEST). You can still review
                    and import, but starting the array afterward will fail until this is corrected.
                  </div>
                </div>
              )}

              {preview.hasSizeMismatch && (
                <div className="import-warning import-warning--danger">
                  <div className="import-warning__title">Size mismatch — import is blocked</div>
                  <div className="import-warning__desc">
                    One or more disks below don't match the size recorded in the superblock. Importing anyway can
                    corrupt filesystems and lose data (see the migration guide), so this app won't do it. Reconnect
                    the correct disk, or unassign the affected slot in Unraid and regenerate the superblock, then try
                    again.
                  </div>
                </div>
              )}

              <div className="unassigned-devices">
                {preview.slots.map((slot) => (
                  <div key={slot.slot} className="unassigned-device-row">
                    <div>
                      <div className="unassigned-device-row__name">
                        Slot {slot.slot} · {ROLE_LABEL[slot.role]}
                      </div>
                      <div className="unassigned-device-row__meta">
                        Expects {formatBytesHuman(slot.sizeKb * 1024)}
                        {slot.matchedDevice
                          ? ` · ${slot.matchedDevice.model ?? slot.matchedDevice.device}${
                              slot.matchedDevice.sizeKb != null ? ` (${formatBytesHuman(slot.matchedDevice.sizeKb * 1024)})` : ''
                            }`
                          : ' · no matching disk connected'}
                      </div>
                    </div>
                    <span className={`import-status-pill import-status-pill--${slot.status}`}>{STATUS_LABEL[slot.status]}</span>
                  </div>
                ))}
              </div>

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={startOver}>
                  Start over
                </button>
                <button type="button" className="btn--primary" onClick={() => setStep('confirm')}>
                  Continue
                </button>
              </div>
            </>
          )}

          {step === 'confirm' && preview && (
            <>
              <div className="status-note status-note--error">
                {preview.currentArrayActive
                  ? 'This stops the currently running array, backs up its superblock, and loads this one instead.'
                  : 'This loads this superblock and imports the disks that match it.'}{' '}
                The array is not started automatically — review its status afterward and start it from the Dashboard
                when ready.
              </div>

              <label className="container-form-row__checkbox">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                I understand this changes the array's configuration and want to proceed.
              </label>

              {preview.hasSizeMismatch && (
                <div className="status-note status-note--error">
                  Import is blocked — see the size mismatch above. Go back and resolve it before continuing.
                </div>
              )}

              {commitError && <div className="status-note status-note--error">{commitError}</div>}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setStep('review')}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={!acknowledged || preview.hasSizeMismatch || committing}
                  onClick={handleCommit}
                >
                  {committing ? 'Importing…' : 'Import array'}
                </button>
              </div>
            </>
          )}

          {step === 'result' && commitResult && (
            <div className="import-result">
              {commitResult.importResult.errors.length > 0 || commitResult.status.array.state.startsWith('ERROR:') ? (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">Completed with issues</div>
                  <div className="import-warning__desc">
                    Array state is now <strong>{commitResult.status.array.state}</strong>. Check the raw output below
                    and the array status before starting.
                  </div>
                </div>
              ) : (
                <div className="status-note">
                  Imported {commitResult.importResult.importedCount} disk(s). Review the array status, then start the
                  array from the Dashboard when you're ready. Afterward, run a non-correcting parity check (Parity
                  Check card) to verify everything lines up before trusting parity.
                </div>
              )}
              {commitResult.backedUpTo && (
                <div className="status-note">Previous superblock backed up at {commitResult.backedUpTo}</div>
              )}

              <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setShowRawOutput((v) => !v)}>
                {showRawOutput ? 'Hide' : 'Show'} raw output
              </button>
              {showRawOutput && <pre className="import-raw-output">{commitResult.importResult.output}</pre>}

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
