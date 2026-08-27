import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi } from '../../api/systemApi';
import type { BackupCategoryId, LocalBackupEntry, RestorePreview } from '../../types/systemApi';
import { formatFileSize, formatRelativeTime } from '../../utils/format';
import { ConfigRestoreWizard } from './ConfigRestoreWizard';

interface RestoreFromLocalWizardProps {
  onClose: () => void;
  onRestored?: () => void;
  // Threaded straight through to ConfigRestoreWizard - see its own doc comment on this prop.
  // Only changes this picker's own dialog title/description, not which backups are listed (every
  // config backup, whatever its scope was made with, records the array superblock the same way).
  focusCategory?: BackupCategoryId;
}

/**
 * "Recover from a local backup" - picks one of what's already sitting at Settings -> Local
 * Backups' own configured destination, instead of making the admin manually re-locate and
 * re-upload a file their browser never had a copy of in the first place. Once a backup's picked
 * and its preview comes back, everything from there on (review categories, confirm, restart
 * services) is the exact same ConfigRestoreWizard the upload flow uses - this component only owns
 * the "which archive" step, plus (new) a password step for an entry the list already knows is
 * encrypted (its own `.meta.json` sidecar - see systemApi.listLocalBackups()) before ever calling
 * preview, so a wrong password fails cleanly right here instead of surfacing through
 * ConfigRestoreWizard as a confusing "not a valid config backup" error.
 */
export function RestoreFromLocalWizard({ onClose, onRestored, focusCategory }: RestoreFromLocalWizardProps) {
  const { t } = useTranslation('settings');
  const [loading, setLoading] = useState(true);
  const [destDir, setDestDir] = useState<string | null>(null);
  const [backups, setBackups] = useState<LocalBackupEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const [previewingName, setPreviewingName] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);

  // Set when the picked entry's own sidecar says it's encrypted - the picker list swaps for a
  // one-field password prompt instead of calling preview straight away. `passwordError` is scoped
  // to this prompt specifically (a wrong password re-prompts in place, distinct from `previewError`
  // which covers every other kind of preview failure for an unencrypted pick).
  const [passwordEntry, setPasswordEntry] = useState<LocalBackupEntry | null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const loadList = () => {
    setLoading(true);
    setListError(null);
    systemApi
      .listLocalBackups()
      .then((result) => {
        setDestDir(result.destDir);
        setBackups(result.backups);
      })
      .catch((err) => setListError((err as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(loadList, []);

  const previewFor = async (name: string, password?: string) => {
    setPreviewingName(name);
    setPreviewError(null);
    setPasswordError(null);
    try {
      const result = await systemApi.previewLocalBackupRestore(name, password);
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

  const pick = (entry: LocalBackupEntry) => {
    if (entry.encrypted) {
      setPasswordEntry(entry);
      setPasswordDraft('');
      setPasswordError(null);
      return;
    }
    void previewFor(entry.name);
  };

  const title = focusCategory === 'array' ? t('RestoreFromLocalWizard.recoverArrayTitle') : t('RestoreFromLocalWizard.restoreTitle');

  if (preview && pickedName) {
    return (
      <ConfigRestoreWizard
        onClose={onClose}
        onRestored={onRestored}
        title={title}
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

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog import-array-wizard">
        <div className="dialog__head">
          <div className="dialog__title">{title}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('RestoreFromLocalWizard.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {passwordEntry ? (
            <>
              <div className="toggle-row__desc">
                <strong>{passwordEntry.name}</strong> {t('RestoreFromLocalWizard.passwordEncrypted')}
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
                placeholder={t('RestoreFromLocalWizard.passwordPlaceholder')}
              />
              {previewingName && <div className="status-note">{t('RestoreFromLocalWizard.reading', { name: previewingName })}</div>}
              {passwordError && <div className="status-note status-note--error">{passwordError}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setPasswordEntry(null)} disabled={previewingName !== null}>
                  {t('RestoreFromLocalWizard.back')}
                </button>
                <button
                  type="button"
                  className="btn btn--primary-sm"
                  disabled={!passwordDraft || previewingName !== null}
                  onClick={() => previewFor(passwordEntry.name, passwordDraft)}
                >
                  {t('RestoreFromLocalWizard.continue')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="toggle-row__desc">
                {t('RestoreFromLocalWizard.pickBackupDesc1')}
                {destDir ? (
                  <>
                    {' '}
                    (<code>{destDir}</code>)
                  </>
                ) : null}
                . {t('RestoreFromLocalWizard.pickBackupDesc2')}
              </div>

              {loading && <div className="status-note">{t('RestoreFromLocalWizard.loading')}</div>}
              {listError && <div className="status-note status-note--error">{listError}</div>}

              {!loading && !listError && destDir === null && (
                <div className="status-note status-note--error">{t('RestoreFromLocalWizard.noDestinationConfigured')}</div>
              )}
              {!loading && !listError && destDir !== null && backups.length === 0 && (
                <div className="status-note">{t('RestoreFromLocalWizard.noBackupsFound')}</div>
              )}

              {!loading && backups.length > 0 && (
                <div className="import-browser__list">
                  {backups.map((b) => (
                    <button type="button" key={b.name} className="import-browser__row" onClick={() => pick(b)} disabled={previewingName !== null}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                      {b.encrypted && (
                        <span className="job-badge job-badge--encrypted" style={{ flexShrink: 0 }}>
                          {t('RestoreFromLocalWizard.encrypted')}
                        </span>
                      )}
                      <span style={{ flexShrink: 0, color: 'var(--color-text-dim)' }}>
                        {formatFileSize(b.sizeBytes)} · {formatRelativeTime(b.modifiedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {previewingName && <div className="status-note">{t('RestoreFromLocalWizard.reading', { name: previewingName })}</div>}
              {previewError && <div className="status-note status-note--error">{previewError}</div>}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  {t('RestoreFromLocalWizard.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
