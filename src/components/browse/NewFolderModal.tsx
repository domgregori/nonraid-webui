import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface NewFolderModalProps {
  onCancel: () => void;
  onSubmit: (name: string) => Promise<boolean>;
}

export function NewFolderModal({ onCancel, onSubmit }: NewFolderModalProps) {
  const { t } = useTranslation('browse');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      setError(t('NewFolderModal.invalidName'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(name);
    setSubmitting(false);
    if (!ok) setError(t('NewFolderModal.requestFailed'));
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('NewFolderModal.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label={t('NewFolderModal.close')}>
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">{t('NewFolderModal.folderNameLabel')}</span>
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('NewFolderModal.folderNamePlaceholder')}
              autoFocus
            />
          </label>

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              {t('NewFolderModal.cancel')}
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? t('NewFolderModal.creating') : t('NewFolderModal.create')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
