import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nmdApi } from '../../api/nmdApi';
import type { DiskMatchStatus, ImportBrowseResult, ImportCommitResponse, ImportDefaultPath, ImportPreview } from '../../types/nmdApi';
import { formatBytesHuman } from '../../utils/format';

interface ImportArrayWizardProps {
  onClose: () => void;
  // Fires once, right when a commit succeeds - before the result screen renders and before
  // onClose. The onboarding wizard uses this to know its "Import" step actually finished (vs.
  // the dialog being cancelled or backdrop-closed before ever committing), without changing
  // what onClose itself means for this component's original standalone use in Settings.
  onImported?: () => void;
}

type Step = 'upload' | 'review' | 'confirm' | 'result';
// Where the .dat came from: a browser upload, or a path located directly on this host's own
// root filesystem (see backend/src/routes/array.ts's /array/import/browse-root - this rig, like
// most nonraid installs, has no separate boot flash drive the way Unraid does; the boot/OS disk
// is the same filesystem the backend itself runs on and already reads /nonraid.dat from).
type Source = 'upload' | 'locate';

const STATUS_LABEL_KEYS: Record<DiskMatchStatus, string> = {
  ok: 'ImportArrayWizard.statusOk',
  'size-mismatch': 'ImportArrayWizard.statusSizeMismatch',
  missing: 'ImportArrayWizard.statusNotFound',
};

const ROLE_LABEL_KEYS = {
  parity: 'ImportArrayWizard.roleParity',
  parity2: 'ImportArrayWizard.roleParity2',
  data: 'ImportArrayWizard.roleData',
} as const;

/**
 * Guided flow for bringing in an existing Unraid array: pick the .dat
 * superblock file, see exactly what it expects and how that lines up
 * against what's physically connected, then explicitly commit. The preview
 * step (uploading and parsing the file) never touches nmdctl or the kernel
 * module - see backend/src/nmd/superblock.ts - so nothing real happens
 * until Confirm. Size mismatches hard-block with no override: starting the
 * array with one can corrupt filesystems and lose data (see the migration
 * guide linked below), so this app doesn't offer a way around it.
 */
export function ImportArrayWizard({ onClose, onImported }: ImportArrayWizardProps) {
  const { t } = useTranslation('settings');
  const [step, setStep] = useState<Step>('upload');
  const [source, setSource] = useState<Source>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [defaultPath, setDefaultPath] = useState<ImportDefaultPath | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [browseResult, setBrowseResult] = useState<ImportBrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const [acknowledged, setAcknowledged] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<ImportCommitResponse | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Checked once up front so the default path can be offered as a one-click option before the
  // user even looks at upload vs. browse - best-effort, a failure here just means that shortcut
  // doesn't show and the user falls back to upload/browse normally.
  useEffect(() => {
    nmdApi
      .getImportDefaultPath()
      .then(setDefaultPath)
      .catch(() => {});
  }, []);

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

  const handlePathSelected = async (path: string) => {
    setFileName(path);
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await nmdApi.previewImportFromPath(path);
      setPreview(result);
      setStep('review');
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  const openBrowser = (startPath?: string) => {
    setBrowsing(true);
    loadBrowsePath(startPath ?? (defaultPath?.path ? defaultPath.path.split('/').slice(0, -1).join('/') || '/' : '/'));
  };

  const loadBrowsePath = async (path: string) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      setBrowseResult(await nmdApi.browseImportRoot(path));
    } catch (err) {
      setBrowseError((err as Error).message);
    } finally {
      setBrowseLoading(false);
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
      onImported?.();
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
    setSource('upload');
    setBrowsing(false);
    setStep('upload');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog import-array-wizard">
        <div className="dialog__head">
          <div className="dialog__title">{t('ImportArrayWizard.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('ImportArrayWizard.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {step === 'upload' && (
            <>
              <div className="toggle-row__desc">
                {t('ImportArrayWizard.migratingDesc1')}{' '}
                <a href="https://github.com/qvr/nonraid#migrating-an-existing-unraid-array" target="_blank" rel="noreferrer">
                  {t('ImportArrayWizard.migrationGuideLink')}
                </a>{' '}
                {t('ImportArrayWizard.migratingDesc2')} <code>super.dat</code> {t('ImportArrayWizard.migratingDesc3')} <code>nonraid.dat</code>{' '}
                {t('ImportArrayWizard.migratingDesc4')}
              </div>

              {defaultPath?.exists && source === 'upload' && !browsing && (
                <button type="button" className="import-source-pick" onClick={() => handlePathSelected(defaultPath.path)} disabled={previewing}>
                  <span className="import-source-pick__body">
                    <span className="import-source-pick__title">{t('ImportArrayWizard.useDefaultPath', { path: defaultPath.path })}</span>
                    <span className="import-source-pick__desc">{t('ImportArrayWizard.foundOnBootDisk')}</span>
                  </span>
                  <span className="import-source-pick__action">{t('ImportArrayWizard.useThisFile')}</span>
                </button>
              )}

              <div className="import-source-tabs">
                <button
                  type="button"
                  className={`import-source-tab${source === 'upload' ? ' import-source-tab--active' : ''}`}
                  onClick={() => {
                    setSource('upload');
                    setBrowsing(false);
                  }}
                >
                  {t('ImportArrayWizard.uploadAFile')}
                </button>
                <button
                  type="button"
                  className={`import-source-tab${source === 'locate' ? ' import-source-tab--active' : ''}`}
                  onClick={() => {
                    setSource('locate');
                    if (!browsing) openBrowser();
                  }}
                >
                  {t('ImportArrayWizard.locateOnThisSystem')}
                </button>
              </div>

              {source === 'upload' && (
                <input
                  ref={fileInputRef}
                  type="file"
                  className="file-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelected(file);
                  }}
                  disabled={previewing}
                />
              )}

              {source === 'locate' && (
                <div className="import-browser">
                  <div className="toggle-row__desc">
                    {t('ImportArrayWizard.browsingDesc1')} <code>.dat</code> {t('ImportArrayWizard.browsingDesc2')}
                  </div>
                  {browseLoading && <div className="status-note">{t('ImportArrayWizard.readingDirectory')}</div>}
                  {browseError && <div className="status-note status-note--error">{browseError}</div>}
                  {browseResult && !browseLoading && (
                    <>
                      <div className="import-browser__path">{browseResult.path}</div>
                      <div className="import-browser__list">
                        {browseResult.parent !== null && (
                          <button type="button" className="import-browser__row" onClick={() => loadBrowsePath(browseResult.parent!)}>
                            <span>..</span>
                          </button>
                        )}
                        {browseResult.entries.length === 0 && browseResult.parent === null && (
                          <div className="status-note">{t('ImportArrayWizard.noSubdirsOrDatFiles')}</div>
                        )}
                        {browseResult.entries.map((entry) => (
                          <button
                            type="button"
                            key={entry.path}
                            className="import-browser__row"
                            onClick={() => (entry.type === 'dir' ? loadBrowsePath(entry.path) : handlePathSelected(entry.path))}
                            disabled={previewing}
                          >
                            <span>
                              {entry.name}
                              {entry.type === 'dir' ? '/' : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {previewing && <div className="status-note">{t('ImportArrayWizard.reading', { fileName })}</div>}
              {previewError && <div className="status-note status-note--error">{previewError}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  {t('ImportArrayWizard.cancel')}
                </button>
              </div>
            </>
          )}

          {step === 'review' && preview && (
            <>
              <div className="toggle-row__desc">
                <strong>{preview.label || t('ImportArrayWizard.unlabeledArray')}</strong> -{' '}
                {t('ImportArrayWizard.diskCount', { count: preview.slots.length })}
                {preview.sourcePath ? <> {t('ImportArrayWizard.fromPath', { path: preview.sourcePath })}</> : null}.
              </div>

              {preview.currentArrayActive && (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">{t('ImportArrayWizard.replaceActiveArrayTitle')}</div>
                  <div className="import-warning__desc">{t('ImportArrayWizard.replaceActiveArrayDesc')}</div>
                </div>
              )}

              {preview.parityTooSmall && (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">{t('ImportArrayWizard.parityTooSmallTitle')}</div>
                  <div className="import-warning__desc">{t('ImportArrayWizard.parityTooSmallDesc')}</div>
                </div>
              )}

              {preview.hasSizeMismatch && (
                <div className="import-warning import-warning--danger">
                  <div className="import-warning__title">{t('ImportArrayWizard.sizeMismatchTitle')}</div>
                  <div className="import-warning__desc">{t('ImportArrayWizard.sizeMismatchDesc')}</div>
                </div>
              )}

              <div className="unassigned-devices">
                {preview.slots.map((slot) => (
                  <div key={slot.slot} className="unassigned-device-row">
                    <div>
                      <div className="unassigned-device-row__name">
                        {t('ImportArrayWizard.slotLabel', { slot: slot.slot })} · {t(ROLE_LABEL_KEYS[slot.role])}
                      </div>
                      <div className="unassigned-device-row__meta">
                        {t('ImportArrayWizard.expects', { size: formatBytesHuman(slot.sizeKb * 1024) })}
                        {slot.matchedDevice
                          ? ` · ${slot.matchedDevice.model ?? slot.matchedDevice.device}${
                              slot.matchedDevice.sizeKb != null ? ` (${formatBytesHuman(slot.matchedDevice.sizeKb * 1024)})` : ''
                            }`
                          : ` · ${t('ImportArrayWizard.noMatchingDisk')}`}
                      </div>
                    </div>
                    <span className={`import-status-pill import-status-pill--${slot.status}`}>{t(STATUS_LABEL_KEYS[slot.status])}</span>
                  </div>
                ))}
              </div>

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={startOver}>
                  {t('ImportArrayWizard.startOver')}
                </button>
                <button type="button" className="btn--primary" onClick={() => setStep('confirm')}>
                  {t('ImportArrayWizard.continue')}
                </button>
              </div>
            </>
          )}

          {step === 'confirm' && preview && (
            <>
              <div className="status-note status-note--error">
                {preview.currentArrayActive ? t('ImportArrayWizard.confirmStopsCurrentArray') : t('ImportArrayWizard.confirmLoadsSuperblock')}{' '}
                {t('ImportArrayWizard.arrayNotStartedAutomatically')}
              </div>

              <label className="container-form-row__checkbox">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                {t('ImportArrayWizard.acknowledgeConfigChange')}
              </label>

              {preview.hasSizeMismatch && <div className="status-note status-note--error">{t('ImportArrayWizard.importBlocked')}</div>}

              {commitError && <div className="status-note status-note--error">{commitError}</div>}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setStep('review')}>
                  {t('ImportArrayWizard.back')}
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={!acknowledged || preview.hasSizeMismatch || committing}
                  onClick={handleCommit}
                >
                  {committing ? t('ImportArrayWizard.importing') : t('ImportArrayWizard.importArray')}
                </button>
              </div>
            </>
          )}

          {step === 'result' && commitResult && (
            <div className="import-result">
              {commitResult.importResult.errors.length > 0 || commitResult.status.array.state.startsWith('ERROR:') ? (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">{t('ImportArrayWizard.completedWithIssuesTitle')}</div>
                  <div className="import-warning__desc">
                    {t('ImportArrayWizard.arrayStateIsNow')} <strong>{commitResult.status.array.state}</strong>. {t('ImportArrayWizard.checkRawOutput')}
                  </div>
                </div>
              ) : (
                <div className="status-note">{t('ImportArrayWizard.importedDisksDesc', { count: commitResult.importResult.importedCount })}</div>
              )}
              {commitResult.backedUpTo && (
                <div className="status-note">{t('ImportArrayWizard.previousSuperblockBackedUp', { path: commitResult.backedUpTo })}</div>
              )}

              <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setShowRawOutput((v) => !v)}>
                {showRawOutput ? t('ImportArrayWizard.hide') : t('ImportArrayWizard.show')} {t('ImportArrayWizard.rawOutput')}
              </button>
              {showRawOutput && <pre className="import-raw-output">{commitResult.importResult.output}</pre>}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  {t('ImportArrayWizard.close')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
