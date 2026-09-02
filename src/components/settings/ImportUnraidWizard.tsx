import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { unraidImportApi } from '../../api/unraidImportApi';
import { useInstallProgress } from '../../hooks/useInstallProgress';
import { InstallProgress } from '../docker/InstallProgress';
import { ProgressBar } from '../shared/ProgressBar';
import { isRelevantConfigPath, type UnraidImportPreview } from '../../types/unraidImportApi';

interface ImportUnraidWizardProps {
  onClose: () => void;
  onImported?: () => void;
}

type Step = 'upload' | 'review' | 'result';
type Source = 'archive' | 'folder';

/** One tick of either commit stream, tagged with which one it came from so the single progress
 *  line below the "Import Selected" button can say "Creating share…" vs. "Installing
 *  container…" - the two streams never run concurrently (see handleCommit), so one shared slot
 *  is enough. */
interface CommitProgress {
  phase: 'share' | 'container';
  name: string;
  index: number;
  total: number;
}

interface CommitResult {
  createdShares: string[];
  failedShares: { name: string; error: string }[];
  usersQueued: number;
  createdContainers: string[];
  skippedContainers: string[];
  failedContainers: { name: string; error: string }[];
}

/**
 * Guided flow for bringing in shares, docker containers (and, separately, user accounts) from an
 * existing Unraid install's config/ directory - either a single archive (tar/tar.gz/tgz/zip) or a
 * whole folder picked from the browser. Only the rows left checked are ever created, and shares
 * always span all current data disks - see backend/src/routes/unraidImport.ts's own doc comments
 * for why (the same file covers why docker containers needing elevated host access are skipped
 * rather than silently granted it).
 *
 * Users are deliberately NOT created here: a share or a container needs no secret, but a real
 * account does, so every user this parses is queued instead (see PendingImportUsersStore) for
 * review on the Users page, where a fresh password is required per account before it actually
 * gets created.
 */
export function ImportUnraidWizard({ onClose, onImported }: ImportUnraidWizardProps) {
  const { t } = useTranslation('settings');
  const [step, setStep] = useState<Step>('upload');
  const [source, setSource] = useState<Source>('archive');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<UnraidImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedShares, setSelectedShares] = useState<Set<string>>(new Set());
  const [selectedContainers, setSelectedContainers] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState<CommitProgress | null>(null);
  // Real per-layer pull/create/start status for whichever container is currently being installed -
  // same hook the Apps/Docker single-container install dialogs already use, so a slow image pull
  // shows real progress here too instead of the wizard looking stalled the whole time (see
  // routes/unraidImport.ts's own doc comment on why the coarse per-container tick alone wasn't
  // enough). Reset between containers, not shared with the shares-import phase.
  const dockerInstall = useInstallProgress();
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const applyPreview = (result: UnraidImportPreview) => {
    setPreview(result);
    // A share Unraid's own config flags as engine storage (see ParsedShare.specialReason) starts
    // unchecked rather than hidden - still importable if someone genuinely repurposed it, just not
    // assumed to be wanted the way a normal data share is.
    setSelectedShares(new Set(result.shares.filter((s) => !s.specialReason).map((s) => s.name)));
    setSelectedContainers(new Set(result.dockerContainers.map((c) => c.name)));
    setStep('review');
  };

  const handleArchiveSelected = async (file: File) => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      applyPreview(await unraidImportApi.previewArchive(file));
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPreviewing(false);
      if (archiveInputRef.current) archiveInputRef.current.value = '';
    }
  };

  const handleFolderSelected = async (files: File[]) => {
    // Filtered here, before any of it is even read off disk - a real config/ folder's plugin
    // package cache alone can run into the hundreds of MB (see isRelevantConfigPath's doc
    // comment), none of it anything this importer reads. Archive-mode uploads can't get this same
    // treatment - there's no cheap way to filter inside an already-built archive client-side.
    const relevant = files.filter((f) => isRelevantConfigPath(f.webkitRelativePath || f.name));
    if (relevant.length === 0) {
      setPreviewError(t('ImportUnraidWizard.noRelevantFiles'));
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      applyPreview(await unraidImportApi.previewFolder(relevant));
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPreviewing(false);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const toggleIn = (set: Set<string>, setter: (next: Set<string>) => void, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setter(next);
  };

  // Same "all selected -> clear, else -> select all" toggle BrowsePage's own bulk-select checkbox
  // uses - one control instead of two separate "Select all"/"Deselect all" buttons.
  const toggleAll = (allNames: string[], selected: Set<string>, setter: (next: Set<string>) => void) => {
    setter(selected.size === allNames.length ? new Set() : new Set(allNames));
  };

  const handleCommit = async () => {
    if (!preview) return;
    setCommitting(true);
    setCommitError(null);
    setCommitProgress(null);
    dockerInstall.reset();
    try {
      const shareResult =
        selectedShares.size > 0
          ? await unraidImportApi.commitShares(preview.token, [...selectedShares], (p) => setCommitProgress({ phase: 'share', ...p }))
          : { created: [], failed: [], usersQueued: 0 };
      const containerResult =
        selectedContainers.size > 0
          ? await unraidImportApi.commitDockerContainers(preview.token, [...selectedContainers], (p) => {
              if (p.phase) {
                // Docker's own real progress for the container currently being worked on -
                // forwarded on top of the coarse tick below, not a replacement for it.
                dockerInstall.onProgress({ phase: p.phase, message: p.message ?? '', percent: p.percent ?? null, layerId: p.layerId, layerStatus: p.layerStatus });
              } else {
                // The coarse "starting container N/M" tick - a new container, so the previous
                // one's log doesn't carry over onto it.
                dockerInstall.reset();
                setCommitProgress({ phase: 'container', name: p.name, index: p.index, total: p.total });
              }
            })
          : { created: [], skipped: [], failed: [] };
      setCommitResult({
        createdShares: shareResult.created,
        failedShares: shareResult.failed,
        usersQueued: shareResult.usersQueued,
        createdContainers: containerResult.created,
        skippedContainers: containerResult.skipped,
        failedContainers: containerResult.failed,
      });
      setStep('result');
      onImported?.();
    } catch (err) {
      setCommitError((err as Error).message);
    } finally {
      setCommitting(false);
      setCommitProgress(null);
      dockerInstall.reset();
    }
  };

  const startOver = () => {
    setPreview(null);
    setPreviewError(null);
    setSelectedShares(new Set());
    setSelectedContainers(new Set());
    setCommitResult(null);
    setCommitError(null);
    setCommitProgress(null);
    setStep('upload');
  };

  const selectedTotal = selectedShares.size + selectedContainers.size;

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog import-array-wizard">
        <div className="dialog__head">
          <div className="dialog__title">{t('ImportUnraidWizard.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('ImportUnraidWizard.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {step === 'upload' && (
            <>
              <div className="toggle-row__desc">{t('ImportUnraidWizard.uploadDesc')}</div>

              <div className="import-source-tabs">
                <button
                  type="button"
                  className={`import-source-tab${source === 'archive' ? ' import-source-tab--active' : ''}`}
                  onClick={() => setSource('archive')}
                >
                  {t('ImportUnraidWizard.archiveTab')}
                </button>
                <button
                  type="button"
                  className={`import-source-tab${source === 'folder' ? ' import-source-tab--active' : ''}`}
                  onClick={() => setSource('folder')}
                >
                  {t('ImportUnraidWizard.folderTab')}
                </button>
              </div>

              {source === 'archive' && (
                <input
                  ref={archiveInputRef}
                  type="file"
                  className="file-input"
                  accept=".tar,.tar.gz,.tgz,.zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleArchiveSelected(file);
                  }}
                  disabled={previewing}
                />
              )}

              {source === 'folder' && (
                <input
                  ref={folderInputRef}
                  type="file"
                  className="file-input"
                  // Non-standard but universally supported attributes for a folder picker - no
                  // official React typing for them, hence the cast.
                  {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                  multiple
                  onChange={(e) => {
                    const files = e.target.files ? [...e.target.files] : [];
                    if (files.length > 0) handleFolderSelected(files);
                  }}
                  disabled={previewing}
                />
              )}

              {previewing && <div className="status-note">{t('ImportUnraidWizard.reading')}</div>}
              {previewError && <div className="status-note status-note--error">{previewError}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  {t('ImportUnraidWizard.cancel')}
                </button>
              </div>
            </>
          )}

          {step === 'review' && preview && (
            <>
              <div className="toggle-row__desc">
                {t('ImportUnraidWizard.foundShares', { count: preview.shares.length })}
                {preview.dockerContainers.length > 0 && <> {t('ImportUnraidWizard.foundContainers', { count: preview.dockerContainers.length })}</>}
                {preview.users.length > 0 && <> {t('ImportUnraidWizard.foundUsers', { count: preview.users.length })}</>}
              </div>

              {preview.warnings.length > 0 && (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">{t('ImportUnraidWizard.warningsTitle')}</div>
                  <div className="import-warning__desc">
                    {preview.warnings.map((w) => (
                      <div key={w.message}>{w.message}</div>
                    ))}
                  </div>
                </div>
              )}

              {preview.shares.length > 0 && (
                <>
                  <div className="toggle-row__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {t('ImportUnraidWizard.sharesHeading')}
                    <button
                      type="button"
                      className="btn"
                      disabled={committing}
                      onClick={() => toggleAll(preview.shares.map((s) => s.name), selectedShares, setSelectedShares)}
                    >
                      {selectedShares.size === preview.shares.length ? t('ImportUnraidWizard.deselectAll') : t('ImportUnraidWizard.selectAll')}
                    </button>
                  </div>
                  <div className="unassigned-devices">
                    {preview.shares.map((s) => (
                      <label key={s.name} className="unassigned-device-row">
                        <div>
                          <div className="unassigned-device-row__name">
                            <input
                              type="checkbox"
                              checked={selectedShares.has(s.name)}
                              onChange={() => toggleIn(selectedShares, setSelectedShares, s.name)}
                            />{' '}
                            {s.name}
                          </div>
                          <div className="unassigned-device-row__meta">
                            {t('ImportUnraidWizard.allocationLabel', { method: s.allocationMethod })}
                            {s.comment ? ` · ${s.comment}` : ''}
                          </div>
                          {s.specialReason && (
                            <div className="unassigned-device-row__meta">{t('ImportUnraidWizard.specialShareNote', { reason: s.specialReason })}</div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {preview.dockerContainers.length > 0 && (
                <>
                  <div className="toggle-row__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {t('ImportUnraidWizard.containersHeading')}
                    <button
                      type="button"
                      className="btn"
                      disabled={committing}
                      onClick={() => toggleAll(preview.dockerContainers.map((c) => c.name), selectedContainers, setSelectedContainers)}
                    >
                      {selectedContainers.size === preview.dockerContainers.length ? t('ImportUnraidWizard.deselectAll') : t('ImportUnraidWizard.selectAll')}
                    </button>
                  </div>
                  <div className="unassigned-devices">
                    {preview.dockerContainers.map((c) => (
                      <label key={c.name} className="unassigned-device-row">
                        <div>
                          <div className="unassigned-device-row__name">
                            <input
                              type="checkbox"
                              checked={selectedContainers.has(c.name)}
                              onChange={() => toggleIn(selectedContainers, setSelectedContainers, c.name)}
                            />{' '}
                            {c.name}
                          </div>
                          <div className="unassigned-device-row__meta">
                            {t('ImportUnraidWizard.containerMeta', { image: c.image, ports: c.ports.length, volumes: c.binds.length })}
                            {c.unsupportedFields.length > 0 && ` · ${t('ImportUnraidWizard.unsupportedFieldsNote', { fields: c.unsupportedFields.join(', ') })}`}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {preview.users.length > 0 && (
                <div className="status-note">{t('ImportUnraidWizard.usersQueuedNote', { count: preview.users.length })}</div>
              )}

              {commitError && <div className="status-note status-note--error">{commitError}</div>}
              {committing && (
                <>
                  {commitProgress && (
                    <div className="status-note">
                      {t(commitProgress.phase === 'share' ? 'ImportUnraidWizard.committingShare' : 'ImportUnraidWizard.committingContainer', {
                        name: commitProgress.name,
                        current: commitProgress.index + 1,
                        total: commitProgress.total,
                      })}
                    </div>
                  )}
                  {commitProgress?.phase === 'container' && dockerInstall.progress ? (
                    <InstallProgress progress={dockerInstall.progress} log={dockerInstall.log} logRef={dockerInstall.logRef} />
                  ) : (
                    <ProgressBar indeterminate color="var(--color-blue)" height={6} />
                  )}
                </>
              )}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={startOver} disabled={committing}>
                  {t('ImportUnraidWizard.startOver')}
                </button>
                <button type="button" className="btn--primary" disabled={selectedTotal === 0 || committing} onClick={handleCommit}>
                  {committing ? t('ImportUnraidWizard.importing') : t('ImportUnraidWizard.importSelected', { count: selectedTotal })}
                </button>
              </div>
            </>
          )}

          {step === 'result' && commitResult && (
            <div className="import-result">
              <div className="status-note">{t('ImportUnraidWizard.createdCount', { count: commitResult.createdShares.length })}</div>
              {commitResult.failedShares.length > 0 && (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">{t('ImportUnraidWizard.someFailedTitle')}</div>
                  <div className="import-warning__desc">
                    {commitResult.failedShares.map((f) => (
                      <div key={f.name}>
                        {f.name}: {f.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(commitResult.createdContainers.length > 0 || commitResult.skippedContainers.length > 0 || commitResult.failedContainers.length > 0) && (
                <div className="status-note">{t('ImportUnraidWizard.createdContainersCount', { count: commitResult.createdContainers.length })}</div>
              )}
              {commitResult.skippedContainers.length > 0 && (
                <div className="status-note">{t('ImportUnraidWizard.skippedContainersCount', { count: commitResult.skippedContainers.length })}</div>
              )}
              {commitResult.failedContainers.length > 0 && (
                <div className="import-warning import-warning--amber">
                  <div className="import-warning__title">{t('ImportUnraidWizard.someContainersFailedTitle')}</div>
                  <div className="import-warning__desc">
                    {commitResult.failedContainers.map((f) => (
                      <div key={f.name}>
                        {f.name}: {f.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {commitResult.usersQueued > 0 && (
                <div className="status-note">{t('ImportUnraidWizard.usersQueuedResult', { count: commitResult.usersQueued })}</div>
              )}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  {t('ImportUnraidWizard.close')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
